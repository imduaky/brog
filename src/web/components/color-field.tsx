import { HEX_RE, THEME_PRESETS, textOn, type ColorPair, type Hex } from '@shared/color'
import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** One color: swatch picker plus the hex value, which can also be typed. */
export function ColorField({ id, label, value, onChange }: { id: string; label: string; value: Hex; onChange: (v: Hex) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label}取色`}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-sm border bg-transparent p-0.5"
        />
        <Input
          className="w-28 font-mono text-xs"
          value={text}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value)
            if (HEX_RE.test(e.target.value)) onChange(e.target.value.toLowerCase())
          }}
          onBlur={() => setText(value)}
          aria-invalid={!HEX_RE.test(text)}
        />
      </div>
    </div>
  )
}

/** A light and a dark color side by side, with optional presets (each preset is a light/dark pair). */
export function ColorPairField({
  label,
  value,
  onChange,
  presets,
  idPrefix,
}: {
  label: string
  value: ColorPair
  onChange: (v: ColorPair) => void
  presets?: { name: string; pair: ColorPair }[]
  idPrefix: string
}) {
  return (
    <div className="grid gap-3">
      <span className="text-sm font-medium">{label}</span>
      {presets && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={`${label}预设`}>
          {presets.map((p) => {
            const active = p.pair.light === value.light && p.pair.dark === value.dark
            return (
              <button
                key={p.name}
                type="button"
                aria-pressed={active}
                aria-label={`${p.name}（亮色与暗色）`}
                title={p.name}
                onClick={() => onChange(p.pair)}
                className={cn('chip h-8 w-12 border', active && 'ring-2 ring-ring ring-offset-1 ring-offset-background')}
                style={{ background: `linear-gradient(135deg, ${p.pair.light} 50%, ${p.pair.dark} 50%)` }}
              />
            )
          })}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <ColorField id={`${idPrefix}-light`} label="亮色" value={value.light} onChange={(light) => onChange({ ...value, light })} />
        <ColorField id={`${idPrefix}-dark`} label="暗色" value={value.dark} onChange={(dark) => onChange({ ...value, dark })} />
      </div>
      <div
        className="flex h-10 items-center rounded-md border px-3 text-sm"
        style={{ backgroundColor: value.light, color: textOn(value.light) }}
        aria-hidden
      >
        <span className="mr-auto">亮色预览</span>
      </div>
      <div
        className="flex h-10 items-center rounded-md border px-3 text-sm"
        style={{ backgroundColor: value.dark, color: textOn(value.dark) }}
        aria-hidden
      >
        <span className="mr-auto">暗色预览</span>
      </div>
    </div>
  )
}

export { THEME_PRESETS }
