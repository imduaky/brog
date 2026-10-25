/** Colors are stored as #rrggbb. Everything else (tints, text contrast) is derived from these. */

export type Hex = string

export interface ColorPair {
  light: Hex
  dark: Hex
}

export const HEX_RE = /^#[0-9a-fA-F]{6}$/

export const PAPER_LIGHT: Hex = '#f4ecd8'
export const PAPER_DARK: Hex = '#1f1c17'

export function isHex(v: unknown): v is Hex {
  return typeof v === 'string' && HEX_RE.test(v)
}

export function toRgb(hex: Hex): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function fromRgb(r: number, g: number, b: number): Hex {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** Linear mix in sRGB. t = 0 returns a, t = 1 returns b. */
export function mix(a: Hex, b: Hex, t: number): Hex {
  const [ar, ag, ab] = toRgb(a)
  const [br, bg, bb] = toRgb(b)
  return fromRgb(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: Hex): number {
  const lin = toRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!
}

/** Text color that reads well on the given background. */
export function textOn(bg: Hex): Hex {
  return luminance(bg) > 0.42 ? '#2b261e' : '#ebe3d0'
}

/**
 * Dark-mode counterpart of a light theme color: keep the hue, sink it toward the
 * dark paper so it reads as a tint on dark cards rather than a bright patch.
 */
export function autoDark(light: Hex): Hex {
  return mix(light, PAPER_DARK, 0.72)
}

/** Preset theme colors, each with its dark counterpart. */
export const THEME_PRESETS: { name: string; pair: ColorPair }[] = [
  { name: '米色', pair: { light: '#ece1c6', dark: '#3a3326' } },
  { name: '鼠尾草', pair: { light: '#cbd8c0', dark: '#334030' } },
  { name: '雾蓝', pair: { light: '#c8d8e6', dark: '#2d3d4d' } },
  { name: '赭石', pair: { light: '#e8c8ae', dark: '#4d3a2b' } },
  { name: '藕粉', pair: { light: '#ecd0d4', dark: '#4a3237' } },
  { name: '杏黄', pair: { light: '#f3dca8', dark: '#4c3f20' } },
  { name: '灰紫', pair: { light: '#d7d0e6', dark: '#3a354d' } },
  { name: '墨绿', pair: { light: '#bcd3c7', dark: '#263930' } },
]
