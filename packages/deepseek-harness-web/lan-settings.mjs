import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'

const METHODS = [
  'settings.describe',
  'settings.update',
  'settings.replace',
  'settings.mutate',
  'credentials.describe',
  'credentials.set',
  'credentials.unset',
  'llm.discoverModels',
]
const MAX_BODY_BYTES = 4 * 1024 * 1024

export const name = 'lan-settings'
export const inject = ['apiProxy', 'webRuntime', 'webServer']

export const REMOTE_SETTINGS_BOOTSTRAP = 'globalThis.__DSH_REMOTE_SETTINGS__=true'

export function injectRemoteSettingsCapability(html) {
  return html.replace('<head>', `<head><script data-remote-settings-capability>${REMOTE_SETTINGS_BOOTSTRAP}</script>`)
}

function parseAuthority(value) {
  try {
    return new URL(`http://${value}`)
  } catch {
    return undefined
  }
}

function isLoopback(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function matchesAuthority(host, entry) {
  const allowed = parseAuthority(entry)
  if (allowed === undefined) return false
  return allowed.port ? allowed.host === host.host : allowed.hostname === host.hostname
}

export function isSameOriginRequest(headers) {
  const hostValue = headers instanceof Headers ? headers.get('host') : headers.host
  if (typeof hostValue !== 'string') return false
  const host = parseAuthority(hostValue)
  if (host === undefined) return false
  const site = headers instanceof Headers ? headers.get('sec-fetch-site') : headers['sec-fetch-site']
  if (site === 'cross-site') return false
  const origin = headers instanceof Headers ? headers.get('origin') : headers.origin
  if (origin === undefined || origin === null) return true
  try {
    return new URL(origin).host === host.host
  } catch {
    return false
  }
}

export function isTrustedLanRequest(headers, trustedHosts) {
  const hostValue = headers instanceof Headers ? headers.get('host') : headers.host
  if (typeof hostValue !== 'string') return false
  const host = parseAuthority(hostValue)
  return host !== undefined
    && (isLoopback(host.hostname) || trustedHosts.some(entry => matchesAuthority(host, entry)))
    && isSameOriginRequest(headers)
}

function requestHeaders(raw) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(raw)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item)
    else if (value !== undefined) headers.set(name, value)
  }
  return headers
}

async function readBody(req) {
  const declared = Number(req.headers['content-length'] ?? NaN)
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new BodyTooLarge()
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) throw new BodyTooLarge()
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, total)
}

class BodyTooLarge extends Error {}

async function bridge(req, res, fetchHandler) {
  if (req.method !== 'POST') {
    res.writeHead(404).end()
    return
  }
  let body
  try {
    body = await readBody(req)
  } catch (error) {
    if (error instanceof BodyTooLarge) {
      res.writeHead(413).end('request too large')
      return
    }
    throw error
  }
  const controller = new AbortController()
  const abort = () => controller.abort('LAN settings client disconnected')
  req.once('aborted', abort)
  try {
    const host = req.headers.host
    const response = await fetchHandler.fetch(new Request(`http://${host}${req.url}`, {
      method: 'POST',
      headers: requestHeaders(req.headers),
      body,
      signal: controller.signal,
    }))
    const headers = Object.fromEntries(response.headers)
    res.writeHead(response.status, headers)
    res.end(response.body === null ? undefined : Buffer.from(await response.arrayBuffer()))
  } finally {
    req.off('aborted', abort)
  }
}

export function apply(ctx, config = {}) {
  if (config.enabled !== true) return
  const trustedHosts = [...ctx.webRuntime.trustedHosts]
  const fetchHandler = toFetchHandler(ctx.apiProxy)
  ctx.effect(() => {
    const disposers = [
      ctx.webServer.tapIndex(injectRemoteSettingsCapability),
      ...METHODS.map(method => ctx.webServer.register({
      kind: 'exact',
      path: `/api/${method}`,
      handler: async (req, res) => {
        if (!isTrustedLanRequest(req.headers, trustedHosts)) {
          res.writeHead(403).end('forbidden')
          return
        }
        await bridge(req, res, fetchHandler)
      },
      })),
    ]
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }, 'trusted LAN settings routes')
}

export default { name, inject, apply }
