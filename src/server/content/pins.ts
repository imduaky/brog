import { z } from 'zod'
import type { Pin } from '../../shared/types.ts'
import type { DB } from '../db.ts'

export const PinSchema = z.object({
  kind: z.enum(['article', 'series', 'tag']),
  key: z.string().min(1).max(200),
})

export const PinsInput = z.object({ pins: z.array(PinSchema).max(50) })

/** Pins in the admin's order. */
export function readPins(db: DB): Pin[] {
  return db.prepare('SELECT kind, key FROM pins ORDER BY sort, created_at').all() as Pin[]
}

/** Replaces the whole list; the array order becomes the display order. Duplicates keep their first position. */
export function writePins(db: DB, pins: Pin[]) {
  const now = Date.now()
  const created = new Map(
    (db.prepare('SELECT kind, key, created_at FROM pins').all() as (Pin & { created_at: number })[]).map((r) => [
      `${r.kind}:${r.key}`,
      r.created_at,
    ]),
  )
  const seen = new Set<string>()
  db.transaction(() => {
    db.prepare('DELETE FROM pins').run()
    const ins = db.prepare('INSERT INTO pins (kind, key, sort, created_at) VALUES (?, ?, ?, ?)')
    pins.forEach((p, i) => {
      const id = `${p.kind}:${p.key}`
      if (seen.has(id)) return
      seen.add(id)
      ins.run(p.kind, p.key, i, created.get(id) ?? now)
    })
  })()
}
