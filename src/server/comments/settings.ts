import { z } from 'zod'
import { type DB, getSetting, setSetting } from '../db.ts'

const KEY = 'comment_settings'

/** owner/name as GitHub allows them. */
export const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/

/** As saved. The token is never stored here: it comes from BROG_GITHUB_TOKEN. */
export interface StoredCommentSettings {
  enabled: boolean
  repo: string
  /** GitHub node id of the repository, looked up when the settings are saved */
  repoId: string
  categoryId: string
  categoryName: string
}

export const DEFAULT_COMMENT_SETTINGS: StoredCommentSettings = {
  enabled: false,
  repo: '',
  repoId: '',
  categoryId: '',
  categoryName: '',
}

export const CommentSettingsInput = z.object({
  enabled: z.boolean(),
  repo: z
    .string()
    .trim()
    .max(201)
    .refine((r) => r === '' || REPO_RE.test(r), 'repo must be owner/name'),
  categoryId: z.string().trim().max(200),
})
export type CommentSettingsInput = z.infer<typeof CommentSettingsInput>

export function readStoredCommentSettings(db: DB): StoredCommentSettings {
  try {
    const raw = getSetting(db, KEY)
    return raw ? { ...DEFAULT_COMMENT_SETTINGS, ...(JSON.parse(raw) as Partial<StoredCommentSettings>) } : { ...DEFAULT_COMMENT_SETTINGS }
  } catch {
    return { ...DEFAULT_COMMENT_SETTINGS }
  }
}

export function writeStoredCommentSettings(db: DB, value: StoredCommentSettings) {
  setSetting(db, KEY, JSON.stringify(value))
}
