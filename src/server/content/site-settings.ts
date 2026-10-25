import { z } from 'zod'
import { HEX_RE, PAPER_DARK, PAPER_LIGHT } from '../../shared/color.ts'
import type { ColorPair, HomeBackground, SiteSettings } from '../../shared/types.ts'
import { type DB, getSetting, setSetting } from '../db.ts'

const KEY = 'site_settings'

/** http(s), mailto, same-site paths and in-page anchors. Rejects javascript: and protocol-relative URLs. */
const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/)|#)/i

const FooterLinkSchema = z.object({
  label: z.string().trim().min(1).max(40),
  url: z
    .string()
    .trim()
    .max(500)
    .refine((u) => SAFE_URL.test(u), 'url must start with http://, https://, mailto:, / or #'),
})

const ColorSchema = z.string().regex(HEX_RE, 'expected #rrggbb')
const PairSchema = z.object({ light: ColorSchema, dark: ColorSchema })

const DEFAULT_HOME: HomeBackground = {
  color: { light: PAPER_LIGHT, dark: PAPER_DARK },
}

export const SiteSettingsSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300),
  footerText: z.string().trim().max(200),
  footerLinks: z.array(FooterLinkSchema).max(12),
  showCloneUrl: z.boolean(),
  listColumns: z.union([z.literal('auto'), z.literal(1), z.literal(2)]),
  paper: PairSchema,
  home: z.object({ color: PairSchema }),
})

/** Used until an admin saves the settings: the `site` section of brog.yaml seeds the title and description. */
export function defaultSiteSettings(seed: { title: string; description: string }): SiteSettings {
  return {
    title: seed.title,
    description: seed.description,
    footerText: '',
    footerLinks: [],
    showCloneUrl: true,
    listColumns: 'auto',
    paper: { light: PAPER_LIGHT, dark: PAPER_DARK },
    home: structuredClone(DEFAULT_HOME),
  }
}

export function readSiteSettings(db: DB, seed: { title: string; description: string }): SiteSettings {
  const base = defaultSiteSettings(seed)
  const raw = getSetting(db, KEY)
  if (!raw) return base
  try {
    const stored = JSON.parse(raw) as Partial<SiteSettings>
    // Settings saved before a field existed keep its default; nested objects merge the same way.
    const merged = { ...base, ...stored, home: { ...base.home, ...stored.home } }
    const parsed = SiteSettingsSchema.safeParse(merged)
    return parsed.success ? parsed.data : base
  } catch {
    return base
  }
}

export function writeSiteSettings(db: DB, value: SiteSettings) {
  setSetting(db, KEY, JSON.stringify(value))
}

export const SiteSettingsInput = SiteSettingsSchema
