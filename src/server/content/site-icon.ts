import type { DB } from '../db.ts'

/** Icons are small: a favicon is shown at 16–64 px. */
export const ICON_MAX_BYTES = 512 * 1024

export interface SiteIconInfo {
  custom: boolean
  /** Unix time in milliseconds; 0 when the default icon is used */
  updatedAt: number
}

/**
 * The type is taken from the file's signature, never from the upload's Content-Type.
 * SVG has no signature, so it is recognised by its root element.
 */
export function sniffIcon(data: Buffer): { mime: string } | null {
  const head = data.subarray(0, 12)
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png' }
  if (head.length >= 4 && head.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00]))) return { mime: 'image/x-icon' }
  if (head.length >= 6 && (head.subarray(0, 6).toString('ascii') === 'GIF87a' || head.subarray(0, 6).toString('ascii') === 'GIF89a')) {
    return { mime: 'image/gif' }
  }
  if (head.length >= 12 && head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mime: 'image/webp' }
  }
  const text = data.subarray(0, 4096).toString('utf8').trimStart()
  if (/^(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text)) return { mime: 'image/svg+xml' }
  return null
}

export function readSiteIcon(db: DB): { mime: string; data: Buffer; updatedAt: number } | null {
  const row = db.prepare('SELECT mime, data, updated_at FROM site_icon WHERE id = 1').get() as
    | { mime: string; data: Buffer; updated_at: number }
    | undefined
  return row ? { mime: row.mime, data: row.data, updatedAt: row.updated_at } : null
}

export function siteIconInfo(db: DB): SiteIconInfo {
  const row = db.prepare('SELECT updated_at FROM site_icon WHERE id = 1').get() as { updated_at: number } | undefined
  return row ? { custom: true, updatedAt: row.updated_at } : { custom: false, updatedAt: 0 }
}

/** Stores an uploaded icon. Throws a message the admin can read when the file is not an allowed icon. */
export function saveSiteIcon(db: DB, data: Buffer): SiteIconInfo {
  if (data.length === 0) throw new Error('图标文件为空')
  if (data.length > ICON_MAX_BYTES) throw new Error('图标不能超过 512 KB')
  const sniffed = sniffIcon(data)
  if (!sniffed) throw new Error('不是支持的图标格式：请上传 PNG、ICO、WebP、GIF 或 SVG')
  const updatedAt = Date.now()
  db.prepare(
    'INSERT INTO site_icon (id, mime, data, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at',
  ).run(sniffed.mime, data, updatedAt)
  return { custom: true, updatedAt }
}

export function deleteSiteIcon(db: DB) {
  db.prepare('DELETE FROM site_icon WHERE id = 1').run()
}
