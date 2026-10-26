import { z } from 'zod'
import type { ServerSettings } from '../shared/types.ts'
import { type DB, getSetting, setSetting } from './db.ts'

const KEY = 'server_settings'

const Origin = z
  .string()
  .trim()
  .regex(/^https?:\/\/[^/\s]+$/, 'expected an origin such as https://example.com (no path)')

export const ServerSettingsSchema = z
  .object({
    baseUrl: z
      .string()
      .trim()
      .max(300)
      .refine((u) => u === '' || /^https?:\/\/[^\s]+$/.test(u), 'baseUrl must be empty or start with http(s)://')
      .transform((u) => u.replace(/\/+$/, '')),
    shareOrigin: z
      .string()
      .trim()
      .max(300)
      .refine((o) => o === '' || /^https?:\/\/[^/\s]+$/.test(o), 'shareOrigin must be empty or an origin such as https://s.example.com'),
    trustProxy: z.boolean(),
    corsOrigins: z.array(Origin).max(20),
    owner: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/, 'owner: letters, digits, . _ - only'),
    language: z.string().trim().regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'language: a tag such as zh-CN'),
    sessionDays: z.number().int().min(1).max(365),
    cookieSecure: z.enum(['auto', 'on', 'off']),
    cookieSameSite: z.enum(['strict', 'lax', 'none']),
    fullText: z.boolean(),
    authorName: z.string().trim().max(100),
    authorEmail: z.string().trim().min(1).max(200),
  })
  .refine((s) => s.cookieSameSite !== 'none' || s.cookieSecure !== 'off', {
    message: 'SameSite=None requires a Secure cookie',
    path: ['cookieSecure'],
  })

export const DEFAULT_SERVER_SETTINGS: ServerSettings = {
  baseUrl: '',
  shareOrigin: '',
  trustProxy: false,
  corsOrigins: [],
  owner: 'owner',
  language: 'zh-CN',
  sessionDays: 7,
  cookieSecure: 'auto',
  cookieSameSite: 'lax',
  fullText: true,
  authorName: '',
  authorEmail: 'brog@localhost',
}

type Listener = (next: ServerSettings, prev: ServerSettings) => void

/**
 * Server settings, kept in memory and in SQLite. Every reader calls get() per
 * request, so a saved change applies without a restart.
 */
export class ServerSettingsStore {
  private value: ServerSettings
  private readonly listeners: Listener[] = []

  constructor(private readonly db: DB) {
    const raw = getSetting(db, KEY)
    let stored: Partial<ServerSettings> | null = null
    try {
      stored = raw ? (JSON.parse(raw) as Partial<ServerSettings>) : null
    } catch {}
    if (stored) {
      // Fields added after the settings were saved keep their defaults.
      const parsed = ServerSettingsSchema.safeParse({ ...DEFAULT_SERVER_SETTINGS, ...stored })
      this.value = parsed.success ? parsed.data : { ...DEFAULT_SERVER_SETTINGS }
    } else {
      this.value = { ...DEFAULT_SERVER_SETTINGS }
      setSetting(db, KEY, JSON.stringify(this.value))
    }
  }

  get(): ServerSettings {
    return this.value
  }

  set(next: ServerSettings) {
    const prev = this.value
    this.value = ServerSettingsSchema.parse(next)
    setSetting(this.db, KEY, JSON.stringify(this.value))
    for (const fn of this.listeners) fn(this.value, prev)
  }

  onChange(fn: Listener) {
    this.listeners.push(fn)
  }
}

/** Forget the saved server settings; the next start uses the defaults. */
export function resetServerSettings(db: DB) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(KEY)
}

export function cookieIsSecure(s: ServerSettings): boolean {
  if (s.cookieSecure !== 'auto') return s.cookieSecure === 'on'
  return s.baseUrl.startsWith('https://')
}

export const authorOf = (s: ServerSettings) => ({ name: s.authorName || s.owner, email: s.authorEmail })
