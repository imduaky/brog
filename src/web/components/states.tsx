import { Loader2 } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'

export function Loading() {
  return (
    <div className="flex justify-center py-20 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  )
}

export function NotFound({ message = '页面不存在' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <p className="text-5xl font-semibold text-muted-foreground">404</p>
      <p className="text-muted-foreground">{message}</p>
      <Button variant="outline" asChild>
        <Link to="/">回到首页</Link>
      </Button>
    </div>
  )
}

export function ErrorState({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.status === 404) return <NotFound message={error.message} />
  return <p className="py-20 text-center text-destructive">{error instanceof Error ? error.message : String(error)}</p>
}
