import { Check, Copy, Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Raw markdown, one row per source line. Read-only. Line numbers are links (#L12):
 * clicking one marks the line, and the address can be shared.
 */
export function SourceView({ text, fileName }: { text: string; fileName: string }) {
  const [copied, setCopied] = useState(false)
  const [line, setLine] = useState(() => lineFromHash())
  const lines = text.replace(/\n$/, '').split('\n')

  useEffect(() => {
    const onHash = () => setLine(lineFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  // Scroll a shared #L<n> into view once the lines are on the page.
  useEffect(() => {
    if (line) document.getElementById(`L${line}`)?.scrollIntoView({ block: 'center' })
    // Only on first render: a clicked line is already in view.
  }, [])

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
        <span className="mr-auto">{lines.length} 行</span>
        <Button variant="ghost" size="xs" onClick={download}>
          <Download /> 下载
        </Button>
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
      <div className="overflow-x-auto rounded-md border bg-card py-1 font-mono text-[13px] leading-6">
        {lines.map((l, i) => (
          <div key={i} id={`L${i + 1}`} className={cn('line-hover flex w-max min-w-full', line === i + 1 && 'bg-warning/15')}>
            <a
              href={`#L${i + 1}`}
              className="w-12 shrink-0 pr-3 text-right text-muted-foreground/70 select-none hover:text-foreground"
              aria-label={`第 ${i + 1} 行`}
            >
              {i + 1}
            </a>
            <span className="pr-4 whitespace-pre">{l || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function lineFromHash(): number | null {
  const m = /^#L(\d+)$/.exec(window.location.hash)
  return m ? Number(m[1]) : null
}
