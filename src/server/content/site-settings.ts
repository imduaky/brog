import { z } from 'zod'
import { HEX_RE, PAPER_DARK, PAPER_LIGHT } from '../../shared/color.ts'
import { isPageSlug } from '../../shared/paths.ts'
import type { HomeBackground, NavItem, SiteSettings } from '../../shared/types.ts'
import { type DB, getSetting, setSetting } from '../db.ts'

const KEY = 'site_settings'

/** http(s), mailto, same-site paths and in-page anchors. Rejects javascript: and protocol-relative URLs. */
const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/)|#)/i
const WEB_URL = /^https?:\/\//i

const safeUrl = z
  .string()
  .trim()
  .max(500)
  .refine((u) => SAFE_URL.test(u), 'url must start with http://, https://, mailto:, / or #')

const FooterLinkSchema = z.object({
  label: z.string().trim().min(1).max(40),
  url: safeUrl,
})

const FriendLinkSchema = z.object({
  name: z.string().trim().min(1).max(40),
  url: z.string().trim().max(500).refine((u) => WEB_URL.test(u), 'url must start with http:// or https://'),
  description: z.string().trim().max(120),
  avatar: z
    .string()
    .trim()
    .max(500)
    .refine((u) => u === '' || WEB_URL.test(u) || /^\/(?!\/)/.test(u), 'avatar must be empty, http(s):// or a /path'),
})

const NavLabel = z.string().trim().min(1).max(20)
const NavItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('builtin'), page: z.enum(['home', 'series', 'tags', 'links']), label: NavLabel }),
  z.object({ type: z.literal('page'), slug: z.string().refine(isPageSlug, 'invalid page name'), label: NavLabel }),
  z.object({
    type: z.literal('link'),
    url: z.string().trim().max(500).refine((u) => WEB_URL.test(u), 'url must start with http:// or https://'),
    label: NavLabel,
  }),
])

const ColorSchema = z.string().regex(HEX_RE, 'expected #rrggbb')
const PairSchema = z.object({ light: ColorSchema, dark: ColorSchema })

const DEFAULT_HOME: HomeBackground = {
  color: { light: PAPER_LIGHT, dark: PAPER_DARK },
}

export const DEFAULT_NAV: NavItem[] = [
  { type: 'builtin', page: 'home', label: '文章' },
  { type: 'builtin', page: 'series', label: '合集' },
  { type: 'builtin', page: 'tags', label: '标签' },
  { type: 'builtin', page: 'links', label: '友链' },
]

export const SiteSettingsSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300),
  footerText: z.string().trim().max(200),
  footerLinks: z.array(FooterLinkSchema).max(12),
  friendLinks: z.array(FriendLinkSchema).max(200),
  nav: z.array(NavItemSchema).max(12),
  showCloneUrl: z.boolean(),
  listColumns: z.union([z.literal('auto'), z.literal(1), z.literal(2)]),
  paper: PairSchema,
  home: z.object({ color: PairSchema }),
})

/** Used until an admin saves the settings. */
export function defaultSiteSettings(): SiteSettings {
  return {
    title: 'My Blog',
    description: '',
    footerText: '',
    footerLinks: [],
    friendLinks: [],
    nav: structuredClone(DEFAULT_NAV),
    showCloneUrl: true,
    listColumns: 'auto',
    paper: { light: PAPER_LIGHT, dark: PAPER_DARK },
    home: structuredClone(DEFAULT_HOME),
  }
}

export function readSiteSettings(db: DB): SiteSettings {
  const base = defaultSiteSettings()
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

/** The admin saves one section at a time; fields left out keep their current value. */
export const SiteSettingsInput = SiteSettingsSchema.partial()
