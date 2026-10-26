import type { NavItem, SiteInfo } from '@shared/types'
import { ArrowUpRight, Search } from 'lucide-react'
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
import { enc } from '@/lib/api'
import { cn } from '@/lib/utils'

const PROJECT_URL = 'https://github.com/imduaky/brog'

const BUILTIN_PATH = { home: '/', series: '/series', tags: '/tags', links: '/links' } as const

type ResolvedNav = { key: string; label: string } & ({ to: string } | { href: string })

/** Navigation entries a reader can follow: unpublished pages and an empty friend links page are left out. */
function resolveNav(site: SiteInfo): ResolvedNav[] {
  const pages = new Set(site.pages.map((p) => p.slug))
  return site.settings.nav.flatMap((item: NavItem, i): ResolvedNav[] => {
    const key = `${i}-${item.label}`
    if (item.type === 'link') return [{ key, label: item.label, href: item.url }]
    if (item.type === 'page') return pages.has(item.slug) ? [{ key, label: item.label, to: `/p/${enc(item.slug)}` }] : []
    if (item.page === 'links' && site.settings.friendLinks.length === 0) return []
    return [{ key, label: item.label, to: BUILTIN_PATH[item.page] }]
  })
}

const NAV_ITEM = 'clickable inline-flex h-9 shrink-0 items-center px-4 text-sm text-muted-foreground'

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
        {/* Wide: the nav sits in the middle column. Narrow: the nav takes the room between title and buttons and scrolls. */}
        <div className="frame mx-auto grid h-14 max-w-[1600px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className="flex min-w-0 max-w-[40vw] justify-start sm:max-w-none">
            <Link to="/" className="clickable h-9 truncate px-3 leading-9 font-semibold">
              {settings?.title ?? ' '}
            </Link>
          </div>
          <nav className="flex min-w-0 items-center justify-start gap-1 overflow-x-auto [scrollbar-width:none] sm:justify-center" aria-label="主导航">
            {site.data &&
              resolveNav(site.data).map((item) =>
                'href' in item ? (
                  <a key={item.key} href={item.href} target="_blank" rel="noopener noreferrer" className={cn(NAV_ITEM, 'gap-0.5')}>
                    {item.label}
                    <ArrowUpRight className="size-3 opacity-60" aria-hidden />
                  </a>
                ) : (
                  <NavLink
                    key={item.key}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) => cn(NAV_ITEM, isActive && 'font-medium text-foreground')}
                  >
                    {item.label}
                  </NavLink>
                ),
              )}
            {session.data?.admin && (
              <NavLink to="/admin" className={({ isActive }) => cn(NAV_ITEM, isActive && 'font-medium text-foreground')}>
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
      <main className="frame mx-auto w-full max-w-[1600px] flex-1 py-8">
        {/* Keyed on the path so every page enters with the same short fade. */}
        <div key={location.pathname} className="motion-fade">
          <Outlet />
        </div>
      </main>
      <footer className="border-t">
        <div className="frame mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 py-6 text-xs text-muted-foreground">
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
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
            {settings?.showCloneUrl && site.data && (
              <code className="rounded-sm bg-muted px-2 py-1 select-all" title="克隆博客内容仓库">
                git clone {site.data.cloneUrl}
              </code>
            )}
            <a
              href={PROJECT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="clickable px-1.5 py-0.5 hover:text-foreground"
            >
              Powered by <span className="font-medium text-foreground">brog</span>
              <span className="ml-2 font-mono text-[11px]">{PROJECT_URL.replace(/^https?:\/\//, '')}</span>
            </a>
          </div>
        </div>
      </footer>
      <AdminGate />
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <SiteThemeSync settings={settings} />
    </div>
  )
}
