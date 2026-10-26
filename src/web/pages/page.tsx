import { useQuery } from '@tanstack/react-query'
import type { PageResponse } from '@shared/types'
import { useParams } from 'react-router'
import { MarkdownView } from '@/components/markdown-view'
import { SandboxFrame } from '@/components/sandbox-frame'
import { ErrorState, Loading } from '@/components/states'
import { api, enc } from '@/lib/api'

/** A custom page from the navigation: Markdown rendered like an article, or a sandboxed web page. */
export default function CustomPage() {
  const { slug = '' } = useParams()
  const page = useQuery({ queryKey: ['page', slug], queryFn: () => api<PageResponse>(`/api/pages/${enc(slug)}`) })
  if (page.isPending) return <Loading />
  if (page.isError) return <ErrorState error={page.error} />
  const p = page.data
  return p.kind === 'html' ? (
    <div className="mx-auto max-w-5xl">
      <title>{p.title}</title>
      <SandboxFrame html={p.html} title={p.title} />
    </div>
  ) : (
    <article className="mx-auto max-w-3xl py-6">
      <title>{p.title}</title>
      <MarkdownView html={p.html} />
    </article>
  )
}
