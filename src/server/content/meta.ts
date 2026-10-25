import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { autoDark, HEX_RE } from '../../shared/color.ts'
import type { ChapterMeta, ColorPair, SeriesMeta } from '../../shared/types.ts'

const SeriesMetaSchema = z.object({
  title: z.string().catch(''),
  description: z.string().catch(''),
  cover: z.string().optional().catch(undefined),
})

/** Dark defaults to a derived tint when only the light color is given. */
const ThemeSchema = z
  .object({ light: z.string().regex(HEX_RE), dark: z.string().regex(HEX_RE).optional() })
  .transform((t): ColorPair => ({ light: t.light.toLowerCase(), dark: (t.dark ?? autoDark(t.light)).toLowerCase() }))

const ChapterMetaSchema = z.object({
  title: z.string().catch(''),
  tags: z
    .array(z.union([z.string(), z.number()]).transform(String))
    .catch([])
    .default([]),
  cover: z.string().optional().catch(undefined),
  summary: z.string().optional().catch(undefined),
  // Shown on the home page cards. Independent of the content, so it can be set by hand.
  preview: z
    .object({
      text: z.string().optional().catch(undefined),
      theme: ThemeSchema.optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
})

function load(text: string | null): unknown {
  if (!text) return {}
  try {
    const v = parse(text)
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

/** Lenient: a broken meta.yaml pushed via git must not break the whole site. */
export function parseSeriesMeta(text: string | null, fallbackTitle: string): SeriesMeta {
  const m = SeriesMetaSchema.parse(load(text))
  return { title: m.title || fallbackTitle, description: m.description, ...(m.cover ? { cover: m.cover } : {}) }
}

export function parseChapterMeta(text: string | null, fallbackTitle: string): ChapterMeta {
  const m = ChapterMetaSchema.parse(load(text))
  return {
    title: m.title || fallbackTitle,
    tags: [...new Set(m.tags.map((t) => t.trim()).filter(Boolean))],
    ...(m.cover ? { cover: m.cover } : {}),
    ...(m.summary ? { summary: m.summary } : {}),
    ...(m.preview && (m.preview.text?.trim() || m.preview.theme)
      ? {
          preview: {
            ...(m.preview.text?.trim() ? { text: m.preview.text.trim() } : {}),
            ...(m.preview.theme ? { theme: m.preview.theme } : {}),
          },
        }
      : {}),
  }
}

export function stringifyMeta(meta: SeriesMeta | ChapterMeta): string {
  const clean = Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined && v !== ''))
  return stringify(clean)
}
