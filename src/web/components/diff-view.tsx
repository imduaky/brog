import { cn } from '@/lib/utils'

/**
 * Unified diff with old/new line numbers. Each line lifts on hover so long
 * diffs stay readable.
 */
export function DiffView({ diff }: { diff: string }) {
  if (!diff.trim()) return <p className="p-4 text-sm text-muted-foreground">没有文本差异</p>
  let oldNo = 0
  let newNo = 0
  const rows = diff.split('\n').map((text, i) => {
    if (text.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(text)
      oldNo = m ? Number(m[1]) - 1 : 0
      newNo = m ? Number(m[2]) - 1 : 0
      return { key: i, kind: 'hunk' as const, old: '', new: '', text }
    }
    if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode)/.test(text)) {
      return { key: i, kind: 'meta' as const, old: '', new: '', text }
    }
    if (text.startsWith('+')) {
      newNo++
      return { key: i, kind: 'add' as const, old: '', new: String(newNo), text }
    }
    if (text.startsWith('-')) {
      oldNo++
      return { key: i, kind: 'del' as const, old: String(oldNo), new: '', text }
    }
    if (text.startsWith('\\')) return { key: i, kind: 'meta' as const, old: '', new: '', text }
    oldNo++
    newNo++
    return { key: i, kind: 'ctx' as const, old: String(oldNo), new: String(newNo), text }
  })
  return (
    <div className="overflow-x-auto rounded-sm border bg-muted/30 py-1 font-mono text-xs leading-5">
      {rows.map((r) => (
        <div
          key={r.key}
          className={cn(
            'line-hover flex min-w-full w-max',
            r.kind === 'add' && 'bg-green-500/15 text-green-800 dark:text-green-300',
            r.kind === 'del' && 'bg-red-500/15 text-red-800 dark:text-red-300',
            r.kind === 'hunk' && 'mt-1 bg-blue-500/10 text-blue-700 dark:text-blue-300',
            r.kind === 'meta' && 'text-muted-foreground',
          )}
        >
          <span className="w-10 shrink-0 select-none pr-2 text-right text-muted-foreground/70">{r.kind === 'hunk' || r.kind === 'meta' ? '' : r.old}</span>
          <span className="w-10 shrink-0 select-none pr-2 text-right text-muted-foreground/70">{r.kind === 'hunk' || r.kind === 'meta' ? '' : r.new}</span>
          <span className="whitespace-pre pr-4">{r.text || ' '}</span>
        </div>
      ))}
    </div>
  )
}
