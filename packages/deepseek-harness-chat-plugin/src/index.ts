/** Host half: cached fuzzy/pinyin session-content search for the browser plugin. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import { pinyin } from 'pinyin-pro'

export const name = 'chat-process-visibility'
export const inject = ['webServer', 'sessionQuery', 'sessions']

const SEARCH_PATH = '/api/chat.session-search'
const MAX_BODY_BYTES = 4096
const MAX_QUERY_LENGTH = 500
const RESULT_LIMIT = 20
const SNIPPET_LENGTH = 240
const HAN_SEQUENCES = /\p{Script=Han}+/gu

type IndexedDocument = {
  text: string
  compact: string
  pinyin: string
  initials: string
}

function compact(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function matches(document: IndexedDocument, term: string): boolean {
  return document.compact.includes(term)
    || document.pinyin.includes(term)
    || document.initials.includes(term)
}

function sendJson(res: import('node:http').ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(value))
}

/** Register the authenticated, same-origin fuzzy search endpoint. */
export function apply(ctx: Context): void {
  const cache = new Map<SessionId, Promise<IndexedDocument[]>>()
  const invalidate = (session: { id: SessionId }): void => { cache.delete(session.id) }
  ctx.on('session/event', invalidate)
  ctx.on('session/disposed', invalidate)

  const documents = (sessionId: SessionId): Promise<IndexedDocument[]> => {
    let pending = cache.get(sessionId)
    if (pending !== undefined) return pending
    pending = ctx.sessionQuery.filterEvents(sessionId, []).then(events => events.flatMap(({ text }) => {
      const normalized = text.replace(/\s+/gu, ' ').trim()
      if (normalized === '') return []
      const chinese = normalized.match(HAN_SEQUENCES)?.join('') ?? ''
      if (chinese === '') {
        return [{ text: normalized, compact: compact(normalized), pinyin: '', initials: '' }]
      }
      return [{
        text: normalized,
        compact: compact(normalized),
        pinyin: compact(pinyin(chinese, { toneType: 'none' })),
        initials: compact(pinyin(chinese, { toneType: 'none', pattern: 'first' })),
      }]
    })).catch((error: unknown) => {
      // One broken historical log must not disable search for every healthy session.
      ctx.logger.warn(`chat fuzzy search skipped session ${sessionId}: ${String(error)}`)
      return []
    })
    cache.set(sessionId, pending)
    return pending
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SEARCH_PATH,
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' }).end()
        return
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') {
        res.writeHead(403).end()
        return
      }
      const origin = req.headers.origin
      try {
        if (typeof origin === 'string' && new URL(origin).host !== req.headers.host) {
          res.writeHead(403).end()
          return
        }
      } catch {
        res.writeHead(403).end()
        return
      }
      if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
        sendJson(res, 415, { error: 'content type must be application/json' })
        return
      }
      const declaredLength = Number(req.headers['content-length'] ?? NaN)
      if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
        sendJson(res, 413, { error: 'request too large' })
        return
      }

      const chunks: Buffer[] = []
      let total = 0
      for await (const chunk of req) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        total += bytes.length
        if (total > MAX_BODY_BYTES) {
          sendJson(res, 413, { error: 'request too large' })
          return
        }
        chunks.push(bytes)
      }

      let query: string
      try {
        const body: unknown = JSON.parse(Buffer.concat(chunks, total).toString('utf8'))
        if (typeof body !== 'object' || body === null || typeof (body as { query?: unknown }).query !== 'string') {
          throw new Error('query must be text')
        }
        query = (body as { query: string }).query.trim()
        if (query === '' || query.length > MAX_QUERY_LENGTH || query.includes('\0')) {
          throw new Error('query must contain 1 to 500 characters')
        }
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
        return
      }

      const phrase = compact(query)
      const terms = query.split(/\s+/u).map(compact).filter(Boolean)
      if (terms.length === 0) {
        sendJson(res, 400, { error: 'query must contain searchable text' })
        return
      }
      const controller = new AbortController()
      req.once('aborted', () => controller.abort())
      let sessions: SessionRecord[]
      try {
        sessions = await ctx.sessionQuery.listSessions(controller.signal)
      } catch (error) {
        ctx.logger.warn(`chat fuzzy search failed to list sessions: ${String(error)}`)
        sendJson(res, 500, { error: '搜索失败' })
        return
      }
      let cursor = 0
      const hits: Array<{ order: number, sessionId: SessionId, snippet: string }> = []

      // ponytail: four workers bound cold-log I/O; add a durable pinyin index only if measured latency needs it.
      await Promise.all(Array.from({ length: Math.min(4, sessions.length) }, async () => {
        for (;;) {
          if (controller.signal.aborted) return
          const order = cursor++
          const session = sessions[order]
          if (session === undefined) return
          const indexed = await documents(session.header.id)
          const matched = new Set<string>()
          let snippet = ''
          let bestMatchCount = 0
          for (const document of indexed) {
            if (matches(document, phrase)) {
              for (const term of terms) matched.add(term)
              snippet = document.text.slice(0, SNIPPET_LENGTH)
              break
            }
            const documentMatches = terms.filter(term => matches(document, term))
            for (const term of documentMatches) matched.add(term)
            if (documentMatches.length > bestMatchCount) {
              bestMatchCount = documentMatches.length
              snippet = document.text.slice(0, SNIPPET_LENGTH)
            }
            if (documentMatches.length === terms.length) break
          }
          if (matched.size === terms.length) hits.push({ order, sessionId: session.header.id, snippet })
        }
      }))

      hits.sort((left, right) => left.order - right.order)
      sendJson(res, 200, {
        items: hits.slice(0, RESULT_LIMIT).map(({ sessionId, snippet }) => ({ sessionId, snippet })),
        hasMore: hits.length > RESULT_LIMIT,
      })
    },
  }), 'chat fuzzy session search route')
}
