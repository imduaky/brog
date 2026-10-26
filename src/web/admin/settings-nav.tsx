import { useQuery } from '@tanstack/react-query'
import type { BuiltinPage, FriendLink, NavItem, PageRef, SiteSettings } from '@shared/types'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { move, RowActions, useSaveSite } from './settings-shared'

const BUILTIN: { page: BuiltinPage; label: string }[] = [
  { page: 'home', label: '文章（首页）' },
  { page: 'series', label: '合集' },
  { page: 'tags', label: '标签' },
  { page: 'links', label: '友链' },
]

const TYPE_LABEL: Record<NavItem['type'], string> = { builtin: '内置页面', page: '自定义页面', link: '外部链接' }

/** Header navigation: built-in pages, custom pages from _pages/, and external links, in order. */
export function NavCard({ settings }: { settings: SiteSettings }) {
  const [nav, setNav] = useState<NavItem[]>(settings.nav)
  const save = useSaveSite('导航已保存')
  const pages = useQuery({ queryKey: ['admin', 'pages'], queryFn: () => api<(PageRef & { dirty: boolean })[]>('/api/admin/pages') })
  const dirty = JSON.stringify(nav) !== JSON.stringify(settings.nav)
  const setItem = (i: number, item: NavItem) => setNav(nav.map((n, j) => (j === i ? item : n)))

  const changeType = (i: number, type: NavItem['type']) => {
    const label = nav[i]!.label
    if (type === 'builtin') setItem(i, { type, page: 'home', label })
    else if (type === 'page') setItem(i, { type, slug: pages.data?.[0]?.slug ?? '', label })
    else setItem(i, { type, url: 'https://', label })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>导航</CardTitle>
        <CardDescription>
          页头中间的导航，按顺序显示。自定义页面在「工作区 → 页面」中编写，发布后才会出现在导航里。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {nav.length === 0 && <p className="text-sm text-muted-foreground">导航为空，页头只显示站点标题。</p>}
        {nav.map((item, i) => (
          <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[7.5rem_minmax(0,1fr)_auto] sm:items-center">
            <Select value={item.type} onValueChange={(v) => changeType(i, v as NavItem['type'])}>
              <SelectTrigger className="w-full" aria-label="类型">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TYPE_LABEL) as NavItem['type'][]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex min-w-0 gap-2">
              <Input
                className="w-28 shrink-0"
                aria-label="显示名称"
                placeholder="名称"
                maxLength={20}
                value={item.label}
                onChange={(e) => setItem(i, { ...item, label: e.target.value })}
              />
              {item.type === 'builtin' ? (
                <Select value={item.page} onValueChange={(v) => setItem(i, { ...item, page: v as BuiltinPage })}>
                  <SelectTrigger className="min-w-0 flex-1" aria-label="页面">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BUILTIN.map((b) => (
                      <SelectItem key={b.page} value={b.page}>
                        {b.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : item.type === 'page' ? (
                <Select value={item.slug || undefined} onValueChange={(v) => setItem(i, { ...item, slug: v })}>
                  <SelectTrigger className="min-w-0 flex-1" aria-label="页面">
                    <SelectValue placeholder={pages.data?.length ? '选择页面' : '还没有自定义页面'} />
                  </SelectTrigger>
                  <SelectContent>
                    {/* A page that was deleted stays selectable, so the entry is not changed silently. */}
                    {item.slug && !pages.data?.some((p) => p.slug === item.slug) && (
                      <SelectItem value={item.slug}>{item.slug}（不存在）</SelectItem>
                    )}
                    {pages.data?.map((p) => (
                      <SelectItem key={p.slug} value={p.slug}>
                        {p.title}（{p.kind === 'html' ? '网页' : 'Markdown'}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className="min-w-0 flex-1 font-mono text-xs"
                  aria-label="地址"
                  placeholder="https://"
                  value={item.url}
                  onChange={(e) => setItem(i, { ...item, url: e.target.value })}
                />
              )}
            </div>
            <RowActions
              index={i}
              count={nav.length}
              label="导航项"
              onMove={(by) => setNav(move(nav, i, by))}
              onRemove={() => setNav(nav.filter((_, j) => j !== i))}
            />
          </div>
        ))}
        <div className="flex items-center gap-2">
          {nav.length < 12 && (
            <Button type="button" variant="outline" size="sm" onClick={() => setNav([...nav, { type: 'link', url: 'https://', label: '' }])}>
              <Plus /> 添加导航项
            </Button>
          )}
          <Button className="ml-auto" disabled={!dirty || save.isPending} onClick={() => save.mutate({ nav })}>
            保存导航
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

const EMPTY_LINK: FriendLink = { name: '', url: 'https://', description: '', avatar: '' }

/** Friend links, shown on their own page (/links). */
export function FriendLinksCard({ settings }: { settings: SiteSettings }) {
  const [links, setLinks] = useState<FriendLink[]>(settings.friendLinks)
  const save = useSaveSite('友链已保存')
  const dirty = JSON.stringify(links) !== JSON.stringify(settings.friendLinks)
  const setLink = (i: number, patch: Partial<FriendLink>) => setLinks(links.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  return (
    <Card>
      <CardHeader>
        <CardTitle>友链</CardTitle>
        <CardDescription>显示在友链页面。没有友链时，导航中的「友链」对读者隐藏。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {links.length === 0 && <p className="text-sm text-muted-foreground">还没有友链</p>}
        {links.map((l, i) => (
          <div key={i} className="grid gap-2 rounded-md border p-2">
            <div className="flex gap-2">
              <Input className="w-32 shrink-0" aria-label="名称" placeholder="名称" maxLength={40} value={l.name} onChange={(e) => setLink(i, { name: e.target.value })} />
              <Input className="min-w-0 flex-1 font-mono text-xs" aria-label="地址" placeholder="https://" value={l.url} onChange={(e) => setLink(i, { url: e.target.value })} />
              <RowActions
                index={i}
                count={links.length}
                label="友链"
                onMove={(by) => setLinks(move(links, i, by))}
                onRemove={() => setLinks(links.filter((_, j) => j !== i))}
              />
            </div>
            <div className="flex gap-2">
              <Input className="min-w-0 flex-1" aria-label="简介" placeholder="简介（可选）" maxLength={120} value={l.description} onChange={(e) => setLink(i, { description: e.target.value })} />
              <Input className="min-w-0 flex-1 font-mono text-xs" aria-label="头像地址" placeholder="头像图片地址（可选）" value={l.avatar} onChange={(e) => setLink(i, { avatar: e.target.value })} />
            </div>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setLinks([...links, { ...EMPTY_LINK }])}>
            <Plus /> 添加友链
          </Button>
          <Button className="ml-auto" disabled={!dirty || save.isPending} onClick={() => save.mutate({ friendLinks: links })}>
            保存友链
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
