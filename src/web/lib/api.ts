/**
 * API client. VITE_API_BASE points a separately deployed frontend at the backend
 * (leave empty when the backend serves the frontend itself).
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

type Init = Omit<RequestInit, 'body'> & { json?: unknown; body?: BodyInit }

export async function api<T>(path: string, init: Init = {}): Promise<T> {
  const headers = new Headers(init.headers)
  // Required by the server on every mutation (CSRF protection).
  headers.set('x-brog-request', '1')
  let body = init.body
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(init.json)
  }
  const res = await fetch(API_BASE + path, { ...init, headers, body, credentials: 'include' })
  if (!res.ok) {
    let message = res.statusText
    try {
      message = ((await res.json()) as { error?: string }).error ?? message
    } catch {}
    throw new ApiError(message, res.status)
  }
  return (await res.json()) as T
}

/** Image URLs from the API are root-relative; prefix them for a separate frontend. */
export const assetUrl = (url: string | null | undefined) => (url && url.startsWith('/') ? API_BASE + url : url ?? undefined)

/**
 * Password digest for login and password changes. Plain JavaScript on purpose:
 * crypto.subtle is missing on plain-HTTP origins, where the login would otherwise crash.
 */
export { sha256Hex } from '@shared/sha256'

export const enc = encodeURIComponent

export function articlePath(series: string, chapter: number) {
  return `/s/${enc(series)}/${chapter}`
}

export function formatDate(ms: number) {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatDateTime(ms: number) {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
