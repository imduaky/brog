import { afterEach, describe, expect, it } from 'vitest'
import { ICON_MAX_BYTES, sniffIcon } from '../src/server/content/site-icon.ts'
import type { SiteIconInfo } from '../src/shared/types.ts'
import { startServer, type TestServer } from './helpers.ts'

let t: TestServer | null = null
afterEach(async () => {
  await t?.close()
  t = null
})

/** A valid 1×1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const ICO = Buffer.concat([Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]), Buffer.alloc(16)])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>')

const putIcon = (s: TestServer, body: Buffer, type = 'application/octet-stream') =>
  s.api("/api/admin/site-icon", { method: "PUT", body: new Uint8Array(body), headers: { 'content-type': type } })

describe('site icon', () => {
  it('is the built-in default until an admin uploads one', async () => {
    t = await startServer()
    expect((await fetch(`${t.url}/favicon.ico`)).status).toBe(404)
    await t.login()
    expect(await (await t.api('/api/admin/site-icon')).json()).toEqual({ custom: false, updatedAt: 0 })
  })

  it('an admin upload is served at /favicon.ico; the versioned URL is immutable', async () => {
    t = await startServer()
    await t.login()
    const r = await putIcon(t, PNG, 'image/png')
    expect(r.status).toBe(200)
    const info = (await r.json()) as SiteIconInfo
    expect(info.custom).toBe(true)
    const bare = await fetch(`${t.url}/favicon.ico`)
    expect(bare.headers.get('content-type')).toBe('image/png')
    expect(bare.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(Buffer.from(await bare.arrayBuffer()).equals(PNG)).toBe(true)
    const versioned = await fetch(`${t.url}/favicon.ico?v=${info.updatedAt}`)
    expect(versioned.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  it('the type comes from the file, not from the Content-Type the client sends', async () => {
    t = await startServer()
    await t.login()
    await putIcon(t, PNG, 'text/plain')
    expect((await fetch(`${t.url}/favicon.ico`)).headers.get('content-type')).toBe('image/png')
  })

  it('accepts ICO and SVG; SVG is served sandboxed so it cannot run script on this origin', async () => {
    t = await startServer()
    await t.login()
    await putIcon(t, ICO)
    expect((await fetch(`${t.url}/favicon.ico`)).headers.get('content-type')).toBe('image/x-icon')
    await putIcon(t, Buffer.from(SVG.toString().replace('<rect', '<script>alert(1)</script><rect')))
    const svg = await fetch(`${t.url}/favicon.ico`)
    expect(svg.headers.get('content-type')).toBe('image/svg+xml')
    expect(svg.headers.get('content-security-policy')).toContain('sandbox')
  })

  it('rejects files that are not icons, empty files, and files over 512 KB', async () => {
    t = await startServer()
    await t.login()
    expect((await putIcon(t, Buffer.from('hello world'))).status).toBe(400)
    expect((await putIcon(t, Buffer.alloc(0))).status).toBe(400)
    const big = Buffer.concat([PNG, Buffer.alloc(ICON_MAX_BYTES)])
    const r = await putIcon(t, big)
    expect(r.status).toBe(400)
    expect(((await r.json()) as { error: string }).error).toContain('512 KB')
  })

  it('only the admin can change the icon', async () => {
    t = await startServer()
    const r = await fetch(`${t.url}/api/admin/site-icon`, { method: 'PUT', body: PNG, headers: { 'x-brog-request': '1' } })
    expect(r.status).toBe(401)
  })

  it('reset returns to the default icon', async () => {
    t = await startServer()
    await t.login()
    await putIcon(t, PNG)
    const r = await t.api('/api/admin/site-icon', { method: 'DELETE' })
    expect(await r.json()).toEqual({ custom: false, updatedAt: 0 })
    expect((await fetch(`${t.url}/favicon.ico`)).status).toBe(404)
  })

  it('sniffIcon recognises each allowed format by its signature', () => {
    expect(sniffIcon(PNG)?.mime).toBe('image/png')
    expect(sniffIcon(ICO)?.mime).toBe('image/x-icon')
    expect(sniffIcon(Buffer.from('GIF89a' + '\0'.repeat(10)))?.mime).toBe('image/gif')
    expect(sniffIcon(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))?.mime).toBe('image/webp')
    expect(sniffIcon(Buffer.from('<?xml version="1.0"?>\n<!-- c -->\n<svg xmlns="x"/>'))?.mime).toBe('image/svg+xml')
    expect(sniffIcon(Buffer.from('<html><svg/></html>'))).toBeNull()
  })
})
