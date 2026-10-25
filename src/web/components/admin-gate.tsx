import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useKeySequence } from '@/hooks/use-key-sequence'
import { useSession } from '@/hooks/use-session'
import { ApiError, api, sha256Hex } from '@/lib/api'

/**
 * Hidden admin entry: type "www" anywhere outside an input. There is no visible
 * link for visitors; the password never leaves the browser in plain text.
 */
export function AdminGate() {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const session = useSession()
  const navigate = useNavigate()
  const qc = useQueryClient()

  useKeySequence('www', () => {
    if (session.data?.admin) navigate('/admin')
    else setOpen(true)
  })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api<{ passwordChanged: boolean }>('/api/auth/login', {
        method: 'POST',
        json: { password: await sha256Hex(password) },
      })
      await qc.invalidateQueries({ queryKey: ['session'] })
      setOpen(false)
      setPassword('')
      if (!r.passwordChanged) toast.warning('正在使用启动时生成的临时密码，请在「设置」中修改密码。')
      navigate('/admin')
    } catch (err) {
      // Server answers (wrong password, rate limit) carry their own message; anything else is a connection problem.
      setError(err instanceof ApiError ? err.message : '无法连接到服务器，请检查网络后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>管理员登录</DialogTitle>
            <DialogDescription>输入管理密码进入管理模式。</DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!error}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={busy || !password}>
              登录
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
