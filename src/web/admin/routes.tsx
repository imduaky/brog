import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink, LogOut } from 'lucide-react'
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router'
import { NotFound } from '@/components/states'
import { SiteThemeSync } from '@/components/site-theme'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { useSite } from '@/hooks/use-site'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import ComparePage from '@/pages/compare'
import DashboardPage from './dashboard'
import EditorPage from './editor'
import HistoryPage from './history'
import SettingsPage from './settings'
import TokensPage from './tokens'

function Tab({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === '/admin'}
      className={({ isActive }) => cn('clickable px-3 py-1.5 text-sm text-muted-foreground', isActive && 'bg-accent font-medium text-foreground')}
    >
      {children}
    </NavLink>
  )
}

export function AdminRoot() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const site = useSite()

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' })
    qc.clear()
    navigate('/')
  }

  return (
    <div className="flex h-svh flex-col">
      <title>管理</title>
      <SiteThemeSync settings={site.data?.settings} />
      <header className="shrink-0 border-b">
        <div className="flex h-12 items-center gap-1 px-3">
          <span className="mr-3 px-2 text-sm font-semibold">管理</span>
          <Tab to="/admin">工作区</Tab>
          <Tab to="/admin/history">历史</Tab>
          <Tab to="/admin/tokens">Git Token</Tab>
          <Tab to="/admin/settings">设置</Tab>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/">
                <ExternalLink /> 查看站点
              </Link>
            </Button>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut /> 退出
            </Button>
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <Routes>
          <Route index element={<DashboardPage />} />
          <Route path="edit/:series/:chapter" element={<EditorPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="compare/:range" element={<ComparePage admin />} />
          <Route path="tokens" element={<TokensPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
    </div>
  )
}
