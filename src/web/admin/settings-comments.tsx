import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CommentCategories, CommentSettings, CommentTestStep } from '@shared/types'
import { Check, Minus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ErrorState, Loading } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, enc } from '@/lib/api'

const KEY = ['admin', 'comments', 'settings'] as const

/** Comments: GitHub Discussions behind the server. Off until configured and switched on. */
export function CommentsCard() {
  const settings = useQuery({ queryKey: KEY, queryFn: () => api<CommentSettings>('/api/admin/comments/settings') })
  return (
    <Card>
      <CardHeader>
        <CardTitle>评论</CardTitle>
        <CardDescription>
          评论存放在 GitHub Discussions，每篇文章对应一个讨论（按文章路径创建）。读者通过博客发表，无需 GitHub 账号。默认关闭。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {settings.isPending ? (
          <Loading />
        ) : settings.isError ? (
          <ErrorState error={settings.error} />
        ) : (
          <CommentsForm key={JSON.stringify(settings.data)} initial={settings.data} />
        )}
      </CardContent>
    </Card>
  )
}

function CommentsForm({ initial }: { initial: CommentSettings }) {
  const qc = useQueryClient()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [repo, setRepo] = useState(initial.repo)
  const [categoryId, setCategoryId] = useState(initial.categoryId)
  const [categories, setCategories] = useState<CommentCategories['categories'] | null>(null)
  const [steps, setSteps] = useState<CommentTestStep[] | null>(null)
  const dirty = enabled !== initial.enabled || repo.trim() !== initial.repo || categoryId !== initial.categoryId

  const readCategories = useMutation({
    mutationFn: () => api<CommentCategories>(`/api/admin/comments/categories?repo=${enc(repo.trim())}`),
    onSuccess: (r) => {
      setCategories(r.categories)
      if (!r.categories.some((c) => c.id === categoryId)) setCategoryId('')
      if (r.categories.length === 0) toast.error('这个仓库还没有讨论分类')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })

  const save = useMutation({
    mutationFn: () => api<CommentSettings>('/api/admin/comments/settings', { method: 'PUT', json: { enabled, repo: repo.trim(), categoryId } }),
    onSuccess: (s) => {
      qc.setQueryData(KEY, s)
      setSteps(null)
      toast.success(s.active ? '评论已开启' : '评论设置已保存')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })

  const test = useMutation({
    mutationFn: () => api<{ steps: CommentTestStep[] }>('/api/admin/comments/test', { method: 'POST' }),
    onSuccess: (r) => setSteps(r.steps),
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })

  const categoryName =
    categories?.find((c) => c.id === categoryId)?.name ?? (categoryId && categoryId === initial.categoryId ? initial.categoryName : '')

  return (
    <div className="grid gap-5">
      <div className="grid gap-1 text-sm">
        <p>
          令牌：
          {initial.tokenConfigured ? (
            <span className="text-success">已设置（环境变量 BROG_GITHUB_TOKEN）</span>
          ) : (
            <span className="text-destructive">未设置。在服务器的环境变量中设置 BROG_GITHUB_TOKEN，然后重启服务。</span>
          )}
        </p>
        <p>
          状态：
          {initial.active ? (
            <span>读者可以看到并发表评论</span>
          ) : initial.enabled ? (
            <span className="text-warning">已保存为开启，但配置未完整，读者看不到评论</span>
          ) : (
            <span className="text-muted-foreground">关闭</span>
          )}
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="cm-repo">仓库（owner/name）</Label>
        <div className="flex gap-2">
          <Input
            id="cm-repo"
            className="min-w-0 flex-1 font-mono text-xs"
            placeholder="例如 yourname/blog-comments"
            value={repo}
            onChange={(e) => {
              setRepo(e.target.value)
              setCategories(null)
            }}
          />
          <Button variant="outline" disabled={!repo.trim() || !initial.tokenConfigured || readCategories.isPending} onClick={() => readCategories.mutate(undefined)}>
            读取分类
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">仓库需要开启 Discussions（仓库设置 → General → Features）。可以是私有仓库。</p>
      </div>

      <div className="grid gap-2">
        <Label>讨论分类</Label>
        <Select value={categoryId || undefined} onValueChange={setCategoryId}>
          <SelectTrigger className="w-full" aria-label="讨论分类">
            <SelectValue placeholder={categories ? '选择分类' : '先读取分类'}>{categoryName}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(categories ?? (categoryId ? [{ id: categoryId, name: categoryName || categoryId }] : [])).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">建议单独建一个分类（例如 Comments），并选择「仅允许维护者发起讨论」。</p>
      </div>

      <Label className="font-normal">
        <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
        在文章下显示并允许发表评论
      </Label>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate(undefined)}>
          {test.isPending ? '测试中…' : '测试'}
        </Button>
        <span className="text-xs text-muted-foreground">
          {dirty ? '测试检查的是已保存的配置，请先保存。' : '检查令牌、仓库、分类与连接。不会在 GitHub 上创建或修改任何内容。'}
        </span>
        <Button className="ml-auto" disabled={!dirty || save.isPending} onClick={() => save.mutate(undefined)}>
          保存评论设置
        </Button>
      </div>

      {steps && (
        <ul className="grid gap-2" aria-label="测试结果">
          {steps.map((s) => (
            <li key={s.key} className="flex gap-3 rounded-md border p-3 text-sm">
              <span className="mt-0.5 shrink-0">
                {s.ok === true ? (
                  <Check className="size-4 text-success" aria-label="通过" />
                ) : s.ok === false ? (
                  <X className="size-4 text-destructive" aria-label="失败" />
                ) : (
                  <Minus className="size-4 text-muted-foreground" aria-label="未执行" />
                )}
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span className="font-medium">{s.label}</span>
                <span className="text-xs break-words text-muted-foreground">{s.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
