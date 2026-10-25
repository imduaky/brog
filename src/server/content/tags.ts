import { randomBytes } from 'node:crypto'
import type { TagRef } from '../../shared/types.ts'
import { type DB } from '../db.ts'
import { RepoError } from '../git/repo.ts'

export const TAG_NAME_MAX = 30

/** Trims and checks a tag name. Commas are reserved for the URL filter list. */
export function normalizeTagName(input: string): string {
  const name = input.trim().replace(/\s+/g, ' ')
  if (!name) throw new RepoError('tag name is required')
  if (name.length > TAG_NAME_MAX) throw new RepoError(`tag name must be at most ${TAG_NAME_MAX} characters`)
  if (/[,，]/.test(name)) throw new RepoError('tag name cannot contain commas')
  return name
}

const newKey = () => randomBytes(6).toString('base64url')

/** Adds names the catalog does not know yet (for example tags that came in through a git push). */
export function ensureTags(db: DB, names: string[], now = Date.now()): void {
  const insert = db.prepare('INSERT OR IGNORE INTO tags (key, name, created_at) VALUES (?, ?, ?)')
  db.transaction(() => {
    for (const name of new Set(names)) if (name) insert.run(newKey(), name, now)
  })()
}

export function catalog(db: DB): TagRef[] {
  return db.prepare('SELECT key, name FROM tags ORDER BY name COLLATE NOCASE').all() as TagRef[]
}

/** name -> ref, for turning the names stored in meta.yaml into catalog references. */
export function refsByName(db: DB): Map<string, TagRef> {
  return new Map(catalog(db).map((t) => [t.name, t]))
}

export function createTag(db: DB, input: string): TagRef {
  const name = normalizeTagName(input)
  if (db.prepare('SELECT 1 FROM tags WHERE name = ?').get(name)) throw new RepoError('tag already exists', 409)
  const ref = { key: newKey(), name }
  db.prepare('INSERT INTO tags (key, name, created_at) VALUES (?, ?, ?)').run(ref.key, ref.name, Date.now())
  return ref
}

/** Renames the catalog entry. The key is unchanged, so links keep working. Meta files are the caller's job. */
export function renameTag(db: DB, key: string, input: string): { before: TagRef; after: TagRef } {
  const name = normalizeTagName(input)
  const before = db.prepare('SELECT key, name FROM tags WHERE key = ?').get(key) as TagRef | undefined
  if (!before) throw new RepoError('tag not found', 404)
  if (before.name === name) return { before, after: before }
  const clash = db.prepare('SELECT key FROM tags WHERE name = ? AND key != ?').get(name, key)
  if (clash) throw new RepoError('tag already exists', 409)
  db.prepare('UPDATE tags SET name = ? WHERE key = ?').run(name, key)
  return { before, after: { key, name } }
}
