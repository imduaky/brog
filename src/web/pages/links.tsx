import { ArrowUpRight } from 'lucide-react'
import { useSite } from '@/hooks/use-site'
import { assetUrl } from '@/lib/api'
import { Loading } from '@/components/states'

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Friend links, set in the admin panel. */
export default function LinksPage() {
  const site = useSite()
  if (site.isPending) return <Loading />
  const links = site.data?.settings.friendLinks ?? []
  const label = site.data?.settings.nav.find((n) => n.type === 'builtin' && n.page === 'links')?.label ?? '友链'
  return (
    <div className="mx-auto max-w-5xl">
      <title>{label}</title>
      <h1 className="mb-6 text-2xl font-semibold">{label}</h1>
      {links.length === 0 ? (
        <p className="py-20 text-center text-muted-foreground">还没有友链</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {links.map((l, i) => (
            <a
              key={`${l.name}-${l.url}`}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="motion-rise group flex items-start gap-3 rounded-lg border bg-card p-4 transition-[border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-px hover:border-foreground/25 hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
            >
              {l.avatar ? (
                <img src={assetUrl(l.avatar)} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-10 shrink-0 rounded-md border object-cover" />
              ) : (
                <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted font-semibold text-muted-foreground">
                  {[...l.name][0]}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 font-medium group-hover:underline group-hover:underline-offset-4">
                  <span className="truncate">{l.name}</span>
                  <ArrowUpRight className="size-3.5 shrink-0 opacity-60" aria-hidden />
                </span>
                {l.description && <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{l.description}</span>}
                <span className="mt-1 block truncate text-xs text-muted-foreground">{hostOf(l.url)}</span>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
