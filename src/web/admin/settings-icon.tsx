import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SiteIconInfo } from '@shared/types'
import { Upload, Undo2 } from 'lucide-react'
import { useRef } from 'react'
import { toast } from 'sonner'
import { ErrorState, Loading } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'

const MAX_BYTES = 512 * 1024
const KEY = ['admin', 'site-icon'] as const

/** The browser-tab icon of the whole site. Uploaded files are checked on the server by their content. */
export function IconCard() {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const info = useQuery({ queryKey: KEY, queryFn: () => api<SiteIconInfo>('/api/admin/site-icon') })
  const fail = (err: unknown) => toast.error(err instanceof Error ? err.message : String(err))

  const upload = useMutation({
    mutationFn: (file: File) =>
      api<SiteIconInfo>('/api/admin/site-icon', {
        method: 'PUT',
        body: file,
        headers: { 'content-type': file.type || 'application/octet-stream' },
      }),
    onSuccess: (r) => {
      qc.setQueryData(KEY, r)
      toast.success('网站图标已更新')
    },
    onError: fail,
  })

  const reset = useMutation({
    mutationFn: () => api<SiteIconInfo>('/api/admin/site-icon', { method: 'DELETE' }),
    onSuccess: (r) => {
      qc.setQueryData(KEY, r)
      toast.success('已恢复默认图标')
    },
    onError: fail,
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>网站图标</CardTitle>
        <CardDescription>浏览器标签页上的图标。支持 PNG、ICO、WebP、GIF、SVG，不超过 512 KB，建议正方形、64×64 或更大。</CardDescription>
      </CardHeader>
      <CardContent>
        {info.isPending ? (
          <Loading />
        ) : info.isError ? (
          <ErrorState error={info.error} />
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex size-16 shrink-0 items-center justify-center rounded-md border bg-card">
              {info.data.custom ? (
                <img src={`/favicon.ico?v=${info.data.updatedAt}`} alt="当前网站图标" className="size-10 object-contain" />
              ) : (
                <span className="text-xs text-muted-foreground">默认</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={input}
                type="file"
                className="hidden"
                accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/webp,image/gif,image/svg+xml,.png,.ico,.webp,.gif,.svg"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  if (file.size > MAX_BYTES) return toast.error('图标不能超过 512 KB')
                  upload.mutate(file)
                }}
              />
              <Button variant="outline" disabled={upload.isPending} onClick={() => input.current?.click()}>
                <Upload /> {upload.isPending ? '上传中…' : '上传图标'}
              </Button>
              {info.data.custom && (
                <Button variant="ghost" disabled={reset.isPending} onClick={() => reset.mutate(undefined)}>
                  <Undo2 /> 恢复默认
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
