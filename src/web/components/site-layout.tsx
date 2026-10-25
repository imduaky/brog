import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { AdminGate } from '@/components/admin-gate'
import { SearchDialog } from '@/components/search-dialog'
import { SiteThemeSync } from '@/components/site-theme'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { useHeaderAutoHide } from '@/hooks/use-header-autohide'
import { useSession } from '@/hooks/use-session'
import { useSite } from '@/hooks/use-site'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/', label: '文章' },
  { to: '/series', label: '系列' },
  { to: '/tags', label: '标签' },
]

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || !!el.closest('.cm-editor'))
}

export function SiteLayout() {
  const site = useSite()
  const session = useSession()
  const location = useLocation()
  const [searchOpen, setSearchOpen] = useState(false)
  const autoHidden = useHeaderAutoHide(true)
  // The header stays put while search is open, so the dialog's context does not move.
  const hidden = autoHidden && !searchOpen
  const settings = site.data?.settings

  // "/" or Ctrl/Cmd+K opens search from anywhere outside text fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !e.ctrlKey && !e.metaKey && !isTyping(e.target))) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex min-h-svh flex-col">
      <header className="site-header sticky top-0 z-30 border-b bg-background/90 backdrop-blur" data-hidden={hidden}>
        <div className="mx-auto grid h-14 max-w-[1600px] grid-cols-[1fr_auto_1fr] items-center gap-2 px-4">
          <div className="flex min-w-0 justify-start">
            <Link to="/" className="clickable h-9 truncate px-3 leading-9 font-semibold">
              {settings?.title ?? ' '}
            </Link>
          </div>
          <nav className="flex items-center gap-1" aria-label="主导航">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'clickable inline-flex h-9 items-center px-4 text-sm text-muted-foreground',
                    isActive && 'text-foreground font-medium',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
            {session.data?.admin && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  cn('clickable inline-flex h-9 items-center px-4 text-sm text-muted-foreground', isActive && 'text-foreground font-medium')
                }
              >
                管理
              </NavLink>
            )}
          </nav>
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="default"
              onClick={() => setSearchOpen(true)}
              aria-label="搜索"
              title="搜索（/）"
              className="h-9 px-3"
            >
              <Search />
              <span className="hidden sm:inline">搜索</span>
              <kbd className="hidden rounded-sm border px-1 font-mono text-[11px] text-muted-foreground sm:inline">/</kbd>
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8">
        {/* Keyed on the path so every page enters with the same short fade. */}
        <div key={location.pathname} className="motion-fade">
          <Outlet />
        </div>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-xs text-muted-foreground">
          {settings?.footerText && <span>{settings.footerText}</span>}
          {settings?.footerLinks.map((l) => (
            <a
              key={`${l.label}-${l.url}`}
              href={l.url}
              target={/^https?:/i.test(l.url) ? '_blank' : undefined}
              rel={/^https?:/i.test(l.url) ? 'noopener noreferrer' : undefined}
              className="clickable px-1.5 py-0.5 hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
          {settings?.showCloneUrl && site.data && (
            <code className="ml-auto rounded-sm bg-muted px-2 py-1 select-all" title="克隆博客内容仓库">
              git clone {site.data.cloneUrl}
            </code>
          )}
        </div>
      </footer>
      <AdminGate />
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <SiteThemeSync settings={settings} />
    </div>
  )
}
