import type { PinKind } from '@shared/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAdminPins } from '@/hooks/use-pins'
import { move, RowActions } from './settings-shared'

const KIND_LABEL: Record<PinKind, string> = { article: '文章', series: '合集', tag: '标签' }

/** Order and remove pinned items. Pinning itself happens on the article, series and tag pages. */
export function PinsCard() {
  const { pins, save } = useAdminPins()
  return (
    <Card>
      <CardHeader>
        <CardTitle>置顶</CardTitle>
        <CardDescription>按顺序显示在首页列表顶部，立即生效。在文章页、合集页或标签页（选中一个标签）点「置顶」添加。</CardDescription>
      </CardHeader>
      <CardContent>
        {pins.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有置顶内容</p>
        ) : (
          <ul className="rounded-md border">
            {pins.map((p, i) => (
              <li key={`${p.kind}:${p.key}`} className="flex items-center gap-2 border-b py-1 pr-1 pl-3 last:border-b-0 hover:bg-accent/50">
                <span className="w-8 shrink-0 text-xs text-muted-foreground">{KIND_LABEL[p.kind]}</span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {p.title ?? <span className="text-muted-foreground">{p.key}（未发布或不存在，读者看不到）</span>}
                </span>
                <RowActions
                  index={i}
                  count={pins.length}
                  label="置顶项"
                  onMove={(by) => save.mutate(move(pins, i, by))}
                  onRemove={() => save.mutate(pins.filter((_, j) => j !== i))}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
