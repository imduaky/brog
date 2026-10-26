import { useQuery } from '@tanstack/react-query'
import type { GitTokenInfo } from '@shared/types'
import { Copy, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ErrorState, Loading } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useSite } from '@/hooks/use-site'
import { api, formatDateTime } from '@/lib/api'
import { useAdminMutation } from './hooks'

export default function TokensPage() {
  const site = useSite()
  const [name, setName] = useState('')
  const [created, setCreated] = useState<string | null>(null)
  const tokens = useQuery({ queryKey: ['admin', 'tokens'], queryFn: () => api<GitTokenInfo[]>('/api/admin/tokens') })
  const create = useAdminMutation((n: string) => api<{ token: string }>('/api/admin/tokens', { method: 'POST', json: { name: n } }))
  const revoke = useAdminMutation((id: number) => api(`/api/admin/tokens/${id}`, { method: 'DELETE' }), '已吊销')

  const owner = site.data?.owner ?? 'owner'
  const url = site.data?.fullCloneUrl ?? ''

  return (
    <div className="relative h-full overflow-y-auto">
      <div className="mx-auto grid max-w-3xl gap-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Git 访问</CardTitle>
            <CardDescription>
              匿名克隆只能拿到已发布版本。推送或获取包含草稿的完整 main，请用下面的地址，用户名为 <code>{owner}</code>，密码为 token。
              推送上来的提交需要在工作区点击 Push 才会发布。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <code className="rounded-md bg-muted px-3 py-2 select-all">git clone {site.data?.cloneUrl}</code>
            <code className="rounded-md bg-muted px-3 py-2 select-all">git clone {url}</code>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Token</CardTitle>
            <CardDescription>token 只在创建时显示一次。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault()
                const r = await create.mutateAsync(name.trim())
                setCreated(r.token)
                setName('')
              }}
            >
              <Input placeholder="用途，例如 laptop / CI" value={name} onChange={(e) => setName(e.target.value)} />
              <Button type="submit" disabled={!name.trim() || create.isPending}>
                创建
              </Button>
            </form>
            {created && (
              <div className="grid gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
                <p>请立即复制，关闭后无法再次查看：</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 select-all">{created}</code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void navigator.clipboard.writeText(created).then(() => toast.success('已复制'))}
                  >
                    <Copy /> 复制
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  例如：<code>git clone {url.replace('://', `://${owner}:<token>@`)}</code>
                </p>
              </div>
            )}
            {tokens.isPending ? (
              <Loading />
            ) : tokens.isError ? (
              <ErrorState error={tokens.error} />
            ) : tokens.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">还没有 token</p>
            ) : (
              <ul className="rounded-md border">
                {tokens.data.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent/50">
                    <span className="flex-1 font-medium">{t.name}</span>
                    <span className="text-xs text-muted-foreground">
                      创建 {formatDateTime(t.createdAt)} · {t.lastUsedAt ? `最近使用 ${formatDateTime(t.lastUsedAt)}` : '未使用'}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="吊销"
                      onClick={() => confirm(`吊销 token「${t.name}」？`) && revoke.mutate(t.id)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
