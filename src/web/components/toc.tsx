import type { TocItem } from '@shared/types'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

export function Toc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState<string | null>(null)
  const minLevel = Math.min(...items.map((i) => i.level))
  const visible = useMemo(() => items.filter((i) => i.level <= minLevel + 2), [items, minLevel])

  useEffect(() => {
    const headings = visible.map((i) => document.getElementById(i.id)).filter((el): el is HTMLElement => !!el)
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (hit) setActive(hit.target.id)
      },
      { rootMargin: '-64px 0px -70% 0px' },
    )
    for (const h of headings) observer.observe(h)
    return () => observer.disconnect()
  }, [visible])

  if (!visible.length) return <p className="px-2 text-sm text-muted-foreground">没有目录</p>
  return (
    <nav aria-label="目录">
      <ul className="space-y-0.5 text-sm">
        {visible.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={cn(
                'clickable block truncate py-1 pr-2 text-muted-foreground',
                active === item.id && 'bg-accent font-medium text-foreground',
              )}
              style={{ paddingLeft: `${(item.level - minLevel) * 12 + 8}px` }}
              title={item.text}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
