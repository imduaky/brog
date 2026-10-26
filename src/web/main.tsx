import './styles.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { SiteLayout } from '@/components/site-layout'
import { NotFound } from '@/components/states'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { SessionInfo } from '@shared/types'
import { ApiError, api } from '@/lib/api'
import { observeScrollbar } from '@/lib/scrollbar'
import ArticlePage from '@/pages/article'
import ComparePage from '@/pages/compare'
import HomePage from '@/pages/home'
import LinksPage from '@/pages/links'
import CustomPage from '@/pages/page'
import SeriesPage from '@/pages/series'
import SeriesListPage from '@/pages/series-list'
import SourcePage from '@/pages/source'
import TagsPage from '@/pages/tags'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
})

function AdminNotFound() {
  return <NotFound />
}

const router = createBrowserRouter([
  {
    element: <SiteLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/series', element: <SeriesListPage /> },
      { path: '/tags', element: <TagsPage /> },
      { path: '/s/:series', element: <SeriesPage /> },
      { path: '/s/:series/:chapter', element: <ArticlePage /> },
      { path: '/s/:series/:chapter/source', element: <SourcePage /> },
      { path: '/links', element: <LinksPage /> },
      { path: '/p/:slug', element: <CustomPage /> },
      { path: '/compare/:range', element: <ComparePage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
  {
    path: '/admin/*',
    // Visitors without a session get a 404 and never download the admin bundle.
    lazy: async () => {
      const session = await queryClient.fetchQuery({
        queryKey: ['session'],
        queryFn: () => api<SessionInfo>('/api/auth/session'),
      })
      if (!session.admin) return { Component: AdminNotFound }
      const m = await import('@/admin/routes')
      return { Component: m.AdminRoot }
    },
  },
])

observeScrollbar()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
