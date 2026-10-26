/**
 * GitHub GraphQL client for the comment feature. It covers only the operations
 * comments need. The token is sent on each request and is never logged or returned.
 */

export const GITHUB_GRAPHQL = 'https://api.github.com/graphql'
const TIMEOUT_MS = 10_000

export type FetchFn = typeof fetch

export class GitHubError extends Error {
  constructor(
    message: string,
    /** Status reported to brog's own clients */
    readonly status: 401 | 403 | 502,
    /** GitHub's error type (for example NOT_FOUND), when it gave one */
    readonly type?: string,
  ) {
    super(message)
  }
}

export interface RepositoryInfo {
  id: string
  isPrivate: boolean
  discussionsEnabled: boolean
  categories: { id: string; name: string }[]
}

export interface RawComment {
  id: string
  body: string
  createdAt: string
  url: string
  author: { login: string; avatarUrl: string } | null
}

export interface DiscussionRef {
  id: string
  number: number
  url: string
}

interface GraphQLResponse<T> {
  data?: T | null
  errors?: { message: string; type?: string }[]
  message?: string
}

export const QUERIES = {
  viewer: `query { viewer { login } }`,
  repository: `query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      id
      isPrivate
      hasDiscussionsEnabled
      discussionCategories(first: 100) { nodes { id name } }
    }
  }`,
  createDiscussion: `mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
    createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
      discussion { id number url }
    }
  }`,
  discussionComments: `query($id: ID!) {
    node(id: $id) {
      ... on Discussion {
        comments(first: 100) {
          totalCount
          nodes { id body createdAt url author { login avatarUrl } }
        }
      }
    }
  }`,
  discussionCommentCount: `query($id: ID!) {
    node(id: $id) {
      ... on Discussion { comments(first: 1) { totalCount } }
    }
  }`,
  addComment: `mutation($discussionId: ID!, $body: String!) {
    addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
      comment { id body createdAt url author { login avatarUrl } }
    }
  }`,
  deleteComment: `mutation($id: ID!) {
    deleteDiscussionComment(input: { id: $id }) { clientMutationId }
  }`,
} as const

export class GitHub {
  constructor(
    private readonly opts: { token: string; endpoint: string; fetch: FetchFn },
  ) {}

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let res: Response
    try {
      res = await this.opts.fetch(this.opts.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.opts.token}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': 'brog',
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      throw new GitHubError(`无法连接 GitHub：${err instanceof Error ? err.message : String(err)}`, 502)
    }
    const body = (await res.json().catch(() => null)) as GraphQLResponse<T> | null
    if (res.status === 401) throw new GitHubError('令牌无效或已过期', 401)
    if (!res.ok) {
      throw new GitHubError(`GitHub 返回 ${res.status}${body?.message ? `：${body.message}` : ''}`, res.status === 403 ? 403 : 502)
    }
    if (body?.errors?.length) {
      throw new GitHubError(
        body.errors.map((e) => e.message).join('；'),
        502,
        body.errors[0]!.type,
      )
    }
    if (!body?.data) throw new GitHubError('GitHub 返回了空数据', 502)
    return body.data
  }

  async viewerLogin(): Promise<string> {
    return (await this.graphql<{ viewer: { login: string } }>(QUERIES.viewer)).viewer.login
  }

  /** Null when the repository does not exist or the token cannot see it. */
  async repository(owner: string, name: string): Promise<RepositoryInfo | null> {
    try {
      const { repository } = await this.graphql<{
        repository: {
          id: string
          isPrivate: boolean
          hasDiscussionsEnabled: boolean
          discussionCategories: { nodes: { id: string; name: string }[] }
        } | null
      }>(QUERIES.repository, { owner, name })
      if (!repository) return null
      return {
        id: repository.id,
        isPrivate: repository.isPrivate,
        discussionsEnabled: repository.hasDiscussionsEnabled,
        categories: repository.discussionCategories.nodes,
      }
    } catch (err) {
      if (err instanceof GitHubError && err.type === 'NOT_FOUND') return null
      throw err
    }
  }

  async createDiscussion(repositoryId: string, categoryId: string, title: string, body: string): Promise<DiscussionRef> {
    const r = await this.graphql<{ createDiscussion: { discussion: DiscussionRef } }>(QUERIES.createDiscussion, {
      repositoryId,
      categoryId,
      title,
      body,
    })
    return r.createDiscussion.discussion
  }

  async discussionComments(id: string): Promise<{ total: number; comments: RawComment[] }> {
    const r = await this.graphql<{ node: { comments: { totalCount: number; nodes: RawComment[] } } | null }>(
      QUERIES.discussionComments,
      { id },
    )
    if (!r.node) throw new GitHubError('找不到讨论', 502, 'NOT_FOUND')
    return { total: r.node.comments.totalCount, comments: r.node.comments.nodes }
  }

  async discussionCommentCount(id: string): Promise<number> {
    const r = await this.graphql<{ node: { comments: { totalCount: number } } | null }>(QUERIES.discussionCommentCount, { id })
    if (!r.node) throw new GitHubError('找不到讨论', 502, 'NOT_FOUND')
    return r.node.comments.totalCount
  }

  async addComment(discussionId: string, body: string): Promise<RawComment> {
    const r = await this.graphql<{ addDiscussionComment: { comment: RawComment } }>(QUERIES.addComment, { discussionId, body })
    return r.addDiscussionComment.comment
  }

  async deleteComment(id: string): Promise<void> {
    await this.graphql(QUERIES.deleteComment, { id })
  }
}
