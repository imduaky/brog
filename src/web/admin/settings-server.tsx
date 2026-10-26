import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ServerSettings } from '@shared/types'
import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ErrorState, Loading } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'

/** Server behaviour: saved values apply without a restart. */
export function ServerCard() {
  const settings = useQuery({ queryKey: ['admin', 'server-settings'], queryFn: () => api<ServerSettings>('/api/admin/server-settings') })
  return (
    <Card>
      <CardHeader>
        <CardTitle>服务</CardTitle>
        <CardDescription>
          保存后立即生效。监听地址、端口和数据目录是启动参数（<code>--port</code> 等），不在这里修改。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {settings.isPending ? (
          <Loading />
        ) : settings.isError ? (
          <ErrorState error={settings.error} />
        ) : (
          <ServerForm key={JSON.stringify(settings.data)} initial={settings.data} />
        )}
      </CardContent>
    </Card>
  )
}

function ServerForm({ initial }: { initial: ServerSettings }) {
  const qc = useQueryClient()
  const [form, setForm] = useState(initial)
  const [origins, setOrigins] = useState(initial.corsOrigins.join('\n'))
  const set = <K extends keyof ServerSettings>(k: K, v: ServerSettings[K]) => setForm((f) => ({ ...f, [k]: v }))
  const next: ServerSettings = { ...form, corsOrigins: origins.split(/\s+/).filter(Boolean) }
  const dirty = JSON.stringify(next) !== JSON.stringify(initial)

  const save = useMutation({
    mutationFn: () => api<ServerSettings>('/api/admin/server-settings', { method: 'PUT', json: next }),
    onSuccess: (data) => {
      toast.success('服务设置已保存')
      qc.setQueryData(['admin', 'server-settings'], data)
      void qc.invalidateQueries({ queryKey: ['site'] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })

  // A Secure cookie is never sent back over plain HTTP: the next login would not stick.
  const secure = next.cookieSecure === 'on' || next.cookieSameSite === 'none' || (next.cookieSecure === 'auto' && next.baseUrl.startsWith('https://'))
  const lockout = secure && window.location.protocol !== 'https:'

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (lockout && !confirm('当前页面不是 HTTPS，启用 Secure Cookie 后将无法在这里重新登录。仍要保存？')) return
        save.mutate()
      }}
    >
      <fieldset className="grid gap-4">
        <legend className="mb-2 text-sm font-semibold">站点地址与 Git</legend>
        <div className="grid gap-2">
          <Label htmlFor="srv-base">对外地址</Label>
          <Input id="srv-base" className="font-mono text-xs" placeholder="https://blog.example.com" value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} />
          <p className="text-xs text-muted-foreground">用于克隆地址和分享卡片。留空时使用访问时的地址。</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="srv-share">分享链接域名</Label>
          <Input
            id="srv-share"
            className="font-mono text-xs"
            placeholder="留空则使用主站域名，例如 https://s.example.com"
            value={form.shareOrigin}
            onChange={(e) => set('shareOrigin', e.target.value)}
          />
          <p className="text-xs text-muted-foreground">文章的分享链接形如 域名/sh/xxxx。短域名需要指向这台服务器，并且不要带路径。</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="srv-owner">Git 用户名</Label>
            <Input id="srv-owner" className="font-mono text-xs" value={form.owner} onChange={(e) => set('owner', e.target.value)} />
            <p className="text-xs text-muted-foreground">带 Token 克隆和推送时使用。</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="srv-lang">页面语言</Label>
            <Input id="srv-lang" className="font-mono text-xs" placeholder="zh-CN" value={form.language} onChange={(e) => set('language', e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="srv-author">提交作者</Label>
            <Input id="srv-author" placeholder={`留空使用 ${form.owner}`} value={form.authorName} onChange={(e) => set('authorName', e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="srv-email">提交邮箱</Label>
            <Input id="srv-email" className="font-mono text-xs" value={form.authorEmail} onChange={(e) => set('authorEmail', e.target.value)} />
          </div>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 border-t pt-4">
        <legend className="mb-2 text-sm font-semibold">登录</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="srv-days">登录有效期（天）</Label>
            <Input
              id="srv-days"
              type="number"
              min={1}
              max={365}
              value={form.sessionDays}
              onChange={(e) => set('sessionDays', Number(e.target.value))}
            />
          </div>
          <div className="grid gap-2">
            <Label>Secure Cookie</Label>
            <Select value={form.cookieSecure} onValueChange={(v) => set('cookieSecure', v as ServerSettings['cookieSecure'])}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">自动（地址为 https 时）</SelectItem>
                <SelectItem value="on">开启</SelectItem>
                <SelectItem value="off">关闭</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>SameSite</Label>
            <Select value={form.cookieSameSite} onValueChange={(v) => set('cookieSameSite', v as ServerSettings['cookieSameSite'])}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lax">Lax（默认）</SelectItem>
                <SelectItem value="strict">Strict</SelectItem>
                <SelectItem value="none">None（前端在其它站点）</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {lockout && (
          <div className="flex gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            当前页面不是 HTTPS。启用 Secure Cookie 后浏览器不会保存登录状态。改错时可以在服务器上运行 <code>reset-settings</code> 恢复默认。
          </div>
        )}
      </fieldset>

      <fieldset className="grid gap-4 border-t pt-4">
        <legend className="mb-2 text-sm font-semibold">部署</legend>
        <Label className="font-normal">
          <Checkbox checked={form.trustProxy} onCheckedChange={(v) => set('trustProxy', v === true)} />
          在反向代理之后（按 X-Forwarded-For 识别访客 IP）
        </Label>
        <div className="grid gap-2">
          <Label htmlFor="srv-cors">独立部署的前端地址</Label>
          <Textarea
            id="srv-cors"
            rows={2}
            className="font-mono text-xs"
            placeholder="https://www.example.com（每行一个，只写协议和域名）"
            value={origins}
            onChange={(e) => setOrigins(e.target.value)}
          />
        </div>
      </fieldset>

      <fieldset className="grid gap-2 border-t pt-4">
        <legend className="mb-2 text-sm font-semibold">搜索</legend>
        <Label className="font-normal">
          <Checkbox checked={form.fullText} onCheckedChange={(v) => set('fullText', v === true)} />
          搜索文章正文
        </Label>
        <p className="text-xs text-muted-foreground">关闭后只搜索标题、标签和摘要。切换后自动重建搜索。</p>
      </fieldset>

      <Button type="submit" className="justify-self-start" disabled={!dirty || save.isPending}>
        保存服务设置
      </Button>
    </form>
  )
}
