import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SiteSettings } from '@shared/types'
import { Plus, Trash2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useSession } from '@/hooks/use-session'
import { useSite } from '@/hooks/use-site'
import { AppearanceCard } from './appearance'
import { api, formatDateTime, sha256Hex } from '@/lib/api'
import { ErrorState, Loading } from '@/components/states'
import { useAdminMutation } from './hooks'

export default function SettingsPage() {
  const site = useSite()
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-2xl gap-6 p-6">
        {site.isPending ? (
          <Loading />
        ) : site.isError ? (
          <ErrorState error={site.error} />
        ) : (
          <>
            <SiteCard key={JSON.stringify(site.data.settings)} settings={site.data.settings} />
            <AppearanceCard settings={site.data.settings} />
          </>
        )}
        <PasswordCard />
      </div>
    </div>
  )
}

function SiteCard({ settings }: { settings: SiteSettings }) {
  const qc = useQueryClient()
  const [form, setForm] = useState<SiteSettings>(settings)
  const save = useMutation({
    mutationFn: () => api<SiteSettings>('/api/admin/site-settings', { method: 'PUT', json: form }),
    onSuccess: () => {
      toast.success('站点设置已保存')
      void qc.invalidateQueries({ queryKey: ['site'] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })
  const set = <K extends keyof SiteSettings>(k: K, v: SiteSettings[K]) => setForm((f) => ({ ...f, [k]: v }))
  const setLink = (i: number, patch: Partial<SiteSettings['footerLinks'][number]>) =>
    set('footerLinks', form.footerLinks.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  return (
    <Card>
      <CardHeader>
        <CardTitle>站点</CardTitle>
        <CardDescription>页面上的标题、简介、页脚和列表布局。修改立即生效。</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate(undefined)
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="site-title">站点标题</Label>
            <Input id="site-title" value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={80} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="site-desc">站点简介</Label>
            <Textarea id="site-desc" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={300} />
          </div>
          <div className="grid gap-2">
            <Label>文章列表布局</Label>
            <Select
              value={String(form.listColumns)}
              onValueChange={(v) => set('listColumns', v === 'auto' ? 'auto' : v === '2' ? 2 : 1)}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">自动（宽屏双列）</SelectItem>
                <SelectItem value="1">单列</SelectItem>
                <SelectItem value="2">双列</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="site-footer">页脚文字</Label>
            <Input id="site-footer" value={form.footerText} onChange={(e) => set('footerText', e.target.value)} maxLength={200} placeholder="例如：© 2026 你的名字" />
          </div>
          <div className="grid gap-2">
            <Label>页脚链接</Label>
            <div className="grid gap-2">
              {form.footerLinks.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input className="w-32" aria-label="链接名称" value={l.label} onChange={(e) => setLink(i, { label: e.target.value })} placeholder="名称" />
                  <Input className="min-w-0 flex-1 font-mono text-xs" aria-label="链接地址" value={l.url} onChange={(e) => setLink(i, { url: e.target.value })} placeholder="https://" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="删除链接"
                    onClick={() => set('footerLinks', form.footerLinks.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              {form.footerLinks.length < 12 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  onClick={() => set('footerLinks', [...form.footerLinks, { label: '', url: 'https://' }])}
                >
                  <Plus /> 添加链接
                </Button>
              )}
            </div>
          </div>
          <Label className="font-normal">
            <Checkbox checked={form.showCloneUrl} onCheckedChange={(v) => set('showCloneUrl', v === true)} />
            在页脚显示克隆地址
          </Label>
          <Button type="submit" className="justify-self-start" disabled={save.isPending || !form.title.trim()}>
            保存站点设置
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function PasswordCard() {
  const session = useSession()
  const pw = useQuery({ queryKey: ['admin', 'password-status'], queryFn: () => api<{ changed: boolean }>('/api/auth/password-status') })
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const change = useAdminMutation(
    async () =>
      api('/api/auth/password', {
        method: 'POST',
        json: { current: await sha256Hex(form.current), next: await sha256Hex(form.next) },
      }),
    '密码已修改，其它设备需要重新登录',
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>修改密码</CardTitle>
        <CardDescription>
          {session.data?.expiresAt && `当前登录有效至 ${formatDateTime(session.data.expiresAt)}，访问时自动续期。`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {pw.data && !pw.data.changed && (
          <div className="mb-4 flex gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            正在使用启动时随机生成的密码，每次重启都会变化。请设置自己的密码。
          </div>
        )}
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (form.next !== form.confirm) return toast.error('两次输入的新密码不一致')
            if (form.next.length < 8) return toast.error('新密码至少 8 位')
            await change.mutateAsync(undefined)
            setForm({ current: '', next: '', confirm: '' })
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="pw-current">当前密码</Label>
            <Input id="pw-current" type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pw-next">新密码</Label>
            <Input id="pw-next" type="password" autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pw-confirm">确认新密码</Label>
            <Input id="pw-confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
          </div>
          <Button type="submit" className="justify-self-start" disabled={change.isPending || !form.current || !form.next}>
            修改密码
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
