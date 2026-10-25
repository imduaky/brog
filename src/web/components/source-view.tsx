import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

/** Raw markdown of a chapter, one row per source line. Read-only. */
export function SourceView({ text, loading }: { text?: string; loading: boolean }) {
  const [copied, setCopied] = useState(false)
  if (loading || text === undefined) return <p className="py-6 text-center text-sm text-muted-foreground">加载中…</p>
  const lines = text.replace(/\n$/, '').split('\n')
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{lines.length} 行</span>
        <Button
          variant="ghost"
          size="xs"
          onClick={() =>
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            })
          }
        >
          {copied ? <Check /> : <Copy />} {copied ? '已复制' : '复制原文'}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-sm border bg-muted/30 py-1 font-mono text-[12.5px] leading-6">
        {lines.map((line, i) => (
          <div key={i} className="line-hover flex min-w-full w-max">
            <span className="w-10 shrink-0 select-none pr-3 text-right text-muted-foreground/70">{i + 1}</span>
            <span className="whitespace-pre pr-4">{line || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
