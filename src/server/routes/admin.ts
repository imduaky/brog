import { Hono } from 'hono'
import { z } from 'zod'
import { META_FILE } from '../../shared/paths.ts'
import type { WorkspaceStatus } from '../../shared/types.ts'
import { parseChapterMeta, parseSeriesMeta, stringifyMeta } from '../content/meta.ts'
import { SiteSettingsInput, writeSiteSettings } from '../content/site-settings.ts'
import { ensureTags } from '../content/tags.ts'
import { HEX_RE } from '../../shared/color.ts'
import { imageMime } from '../content/service.ts'
import { type AppContext, ChapterParams, type Env, parseJson } from '../context.ts'
import { getSetting, setSetting } from '../db.ts'
import { RepoError } from '../git/repo.ts'
import { requireAdmin } from './auth.ts'

const MAX_TEXT_FILE = 2 * 1024 * 1024
const MAX_IMAGE = 20 * 1024 * 1024

const Paths = z.object({ paths: z.array(z.string()).min(1) })

export function adminRoutes(ctx: AppContext) {
  const { repo, content } = ctx
  const app = new Hono<Env>()
  app.use('*', requireAdmin(ctx))
  app.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })
  const locked = <T>(fn: () => Promise<T>) => repo.lock.run(fn)

  // ------------------------------------------------------------ status & tree

  app.get('/status', async (c) => {
    const published = content.published()
    const status = await locked(async (): Promise<WorkspaceStatus> => {
      const head = await repo.headOid()
      const range = published && published !== head ? `${published}..${head}` : head
      return {
        head,
        published,
        unpublished: published === head ? [] : await repo.log({ rev: range, limit: 100 }),
        changes: await repo.status(),
        warning: getSetting(ctx.db, 'workspace_warning') ?? null,
      }
    })
    return c.json(status)
  })

  app.post('/status/dismiss-warning', (c) => {
    ctx.db.prepare("DELETE FROM settings WHERE key = 'workspace_warning'").run()
    return c.json({ ok: true })
  })

  app.get('/tree', async (c) => c.json(await locked(() => content.workspaceTree())))

  app.get('/files', async (c) => c.json(await repo.listWorking(c.req.query('prefix') ?? '')))

  // ------------------------------------------------------------ files

  app.get('/file', async (c) => {
    const path = c.req.query('path') ?? ''
    const buf = await repo.readWorking(path)
    return c.json({ path, exists: buf !== null, content: buf?.toString('utf8') ?? '' })
  })

  /** Autosave target of the editor. */
  app.put('/file', async (c) => {
    const body = await parseJson(c, z.object({ path: z.string(), content: z.string().max(MAX_TEXT_FILE) }))
    await locked(() => repo.writeWorking(body.path, body.content))
    return c.json({ ok: true, savedAt: Date.now() })
  })

  app.delete('/file', async (c) => {
    await locked(() => repo.deleteWorking(c.req.query('path') ?? ''))
    return c.json({ ok: true })
  })

  app.get('/workspace/raw', async (c) => {
    const path = c.req.query('path') ?? ''
    const buf = await repo.readWorking(path)
    if (!buf) return c.json({ error: 'not found' }, 404)
    c.header('Content-Type', imageMime(path) ?? 'application/octet-stream')
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
    return c.body(new Uint8Array(buf))
  })

  /** File content at a revision (history viewer). */
  app.get('/file-at', async (c) => {
    const rev = await repo.resolveCommit(c.req.query('rev') ?? '')
    if (!rev) throw new RepoError('revision not found', 404)
    const buf = await repo.readAt(rev, c.req.query('path') ?? '')
    if (!buf) throw new RepoError('file not found at revision', 404)
    return c.json({ content: buf.toString('utf8') })
  })

  // ------------------------------------------------------------ articles

  app.post('/chapters', async (c) => {
    const body = await parseJson(
      c,
      z.object({
        series: z.string().min(1),
        seriesTitle: z.string().optional(),
        title: z.string().min(1),
        tags: z.array(z.string()).optional(),
      }),
    )
    return c.json(await content.createChapter(body))
  })

  app.get('/meta/:series/:chapter', async (c) => {
    const p = ChapterParams.parse(c.req.param())
    const text = (await repo.readWorking(`${p.series}/${p.chapter}/${META_FILE}`))?.toString('utf8') ?? null
    return c.json(parseChapterMeta(text, ''))
  })

  app.get('/series-meta/:series', async (c) => {
    const series = c.req.param('series')
    const text = (await repo.readWorking(`${series}/${META_FILE}`))?.toString('utf8') ?? null
    return c.json(parseSeriesMeta(text, series))
  })

  app.put('/meta/:series/:chapter', async (c) => {
    const p = ChapterParams.parse(c.req.param())
    const meta = await parseJson(
      c,
      z.object({
        title: z.string().min(1),
        tags: z.array(z.string()),
        cover: z.string().optional(),
        summary: z.string().optional(),
        preview: z
          .object({
            text: z.string().max(300).optional(),
            theme: z.object({ light: z.string().regex(HEX_RE), dark: z.string().regex(HEX_RE) }).optional(),
          })
          .optional(),
      }),
    )
    // An empty preview is not written, so meta.yaml stays free of empty blocks.
    const preview = meta.preview && (meta.preview.text?.trim() || meta.preview.theme) ? meta.preview : undefined
    await locked(() => repo.writeWorking(`${p.series}/${p.chapter}/${META_FILE}`, stringifyMeta({ ...meta, preview })))
    ensureTags(ctx.db, meta.tags)
    return c.json({ ok: true })
  })

  app.put('/series-meta/:series', async (c) => {
    const series = c.req.param('series')
    const meta = await parseJson(
      c,
      z.object({ title: z.string().min(1), description: z.string(), cover: z.string().optional() }),
    )
    await locked(() => repo.writeWorking(`${series}/${META_FILE}`, stringifyMeta(meta)))
    return c.json({ ok: true })
  })

  app.post('/preview', async (c) => {
    const body = await parseJson(
      c,
      z.object({ series: z.string(), chapter: z.number().int().min(1), content: z.string().max(MAX_TEXT_FILE) }),
    )
    const r = await content.preview(body.series, body.chapter, body.content)
    return c.json({ html: r.html, toc: r.toc })
  })

  app.post('/images', async (c) => {
    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) throw new RepoError('file is required')
    if (file.size > MAX_IMAGE) throw new RepoError('image too large (max 20 MB)')
    const p = ChapterParams.parse({ series: form.get('series'), chapter: form.get('chapter') })
    const result = await content.uploadImage({
      ...p,
      data: Buffer.from(await file.arrayBuffer()),
      // multipart turns \n into \r\n; the editor's offset is based on \n
      markdown: String(form.get('markdown') ?? '').replace(/\r\n/g, '\n'),
      offset: Number(form.get('offset') ?? 0),
    })
    return c.json(result)
  })

  // ------------------------------------------------------------ git workflow

  app.post('/stage', async (c) => {
    const { paths } = await parseJson(c, Paths)
    await locked(() => repo.stage(paths))
    return c.json({ ok: true })
  })

  app.post('/unstage', async (c) => {
    const { paths } = await parseJson(c, Paths)
    await locked(() => repo.unstage(paths))
    return c.json({ ok: true })
  })

  app.post('/discard', async (c) => {
    const { paths } = await parseJson(c, Paths)
    await locked(() => repo.discard(paths))
    return c.json({ ok: true })
  })

  app.get('/diff', async (c) => {
    const diff = await repo.diff({ path: c.req.query('path') || undefined, staged: c.req.query('staged') === '1' })
    return c.json({ diff })
  })

  app.post('/commit', async (c) => {
    const body = await parseJson(c, z.object({ message: z.string().min(1).max(10_000), all: z.boolean().optional() }))
    const oid = await locked(async () => {
      if (body.all) await repo.git(['add', '-A'])
      return repo.commit(body.message)
    })
    return c.json({ oid })
  })

  app.get('/log', async (c) => {
    const limit = Math.min(Number(c.req.query('limit')) || 50, 500)
    const skip = Number(c.req.query('skip')) || 0
    return c.json(await repo.log({ path: c.req.query('path') || undefined, limit, skip }))
  })

  app.get('/commits/:oid', async (c) => c.json(await repo.show(c.req.param('oid'))))

  app.post('/reset', async (c) => {
    const body = await parseJson(
      c,
      z.object({ rev: z.string().min(4), mode: z.enum(['soft', 'mixed', 'hard']).default('soft') }),
    )
    await locked(() => repo.reset(body.rev, body.mode))
    return c.json({ ok: true, head: await repo.headOid() })
  })

  app.post('/revert', async (c) => {
    const { rev } = await parseJson(c, z.object({ rev: z.string().min(4) }))
    const oid = await locked(() => repo.revert(rev))
    return c.json({ oid })
  })

  /** The web "Push": move the published pointer to HEAD. */
  app.post('/publish', async (c) => {
    const oid = await content.publish()
    setSetting(ctx.db, 'last_publish_at', String(Date.now()))
    return c.json({ published: oid })
  })

  // ------------------------------------------------------------ tags

  /** Full catalog with usage counts (published articles), including unused tags. */
  app.get('/tags', (c) => c.json(content.listTags(true)))

  app.post('/tags', async (c) => {
    const { name } = await parseJson(c, z.object({ name: z.string() }))
    return c.json(content.addTag(name))
  })

  /** Renames a tag and rewrites it in the workspace meta files that use it. */
  app.put('/tags/:key', async (c) => {
    const { name } = await parseJson(c, z.object({ name: z.string() }))
    return c.json(await content.renameTag(c.req.param('key'), name))
  })

  // ------------------------------------------------------------ site settings

  app.put('/site-settings', async (c) => {
    const body = await parseJson(c, SiteSettingsInput)
    writeSiteSettings(ctx.db, body)
    return c.json(body)
  })

  // ------------------------------------------------------------ git tokens

  app.get('/tokens', (c) => c.json(ctx.tokens.list()))

  app.post('/tokens', async (c) => {
    const { name } = await parseJson(c, z.object({ name: z.string().min(1).max(100) }))
    return c.json(ctx.tokens.create(name))
  })

  app.delete('/tokens/:id', (c) => {
    const ok = ctx.tokens.revoke(Number(c.req.param('id')))
    return ok ? c.json({ ok }) : c.json({ error: 'token not found' }, 404)
  })

  return app
}
