import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveLanTrust } from '@deepseek-ai/dsh-web-app'
import { isSameOriginRequest, isTrustedLanRequest } from '../lan-settings.mjs'

const PASSWORD_REF = credentialRef('DSH_LAN_PASSWORD')
const COOKIE_NAME = 'dsh_lan_session'
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
const MAX_PASSWORD_BYTES = 1024
const MAX_BODY_BYTES = 4096
const MAX_FAILURES = 5
const FAILURE_WINDOW_MS = 60_000
const WEB_TERMINAL_PATH = '/web-terminal'

export const name = 'lan-auth'
export const inject = ['credentials', 'webServer', 'webStartup']

export function isLoopbackAddress(address) {
  return address === '::1' || address?.startsWith('127.') === true || address?.startsWith('::ffff:127.') === true
}

function isLoopbackHost(host) {
  try {
    const hostname = new URL(`http://${host}`).hostname
    return hostname === 'localhost' || hostname === '[::1]' || hostname.startsWith('127.')
  } catch {
    return false
  }
}

export function isLoopbackRequest(req) {
  return isLoopbackAddress(req.socket?.remoteAddress) && typeof req.headers.host === 'string' && isLoopbackHost(req.headers.host)
}

export function isSafeCrossSiteNavigation(req) {
  return req.method === 'GET'
    && req.headers.origin === undefined
    && req.headers['sec-fetch-site'] === 'cross-site'
    && req.headers['sec-fetch-mode'] === 'navigate'
    && req.headers['sec-fetch-dest'] === 'document'
}

export function validatePassword(password) {
  return typeof password === 'string' && password.length >= 8 && Buffer.byteLength(password) <= MAX_PASSWORD_BYTES
}

function passwordsMatch(input, expected) {
  const digest = value => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(input), digest(expected))
}

function cookie(req) {
  const header = req.headers.cookie
  if (typeof header !== 'string') return
  for (const item of header.split(';')) {
    const [key, ...value] = item.trim().split('=')
    if (key === COOKIE_NAME) return value.join('=')
  }
}

function secureRequest(req) {
  return req.socket?.encrypted === true || req.headers['x-forwarded-proto'] === 'https'
}

function send(res, status, body = '', headers = {}) {
  res.writeHead(status, {
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(body)
}

function sendJson(res, status, value, headers) {
  send(res, status, JSON.stringify(value), {
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  })
}

async function readJson(req) {
  if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw Object.assign(new Error('content type must be application/json'), { status: 415 })
  }
  const declared = Number(req.headers['content-length'] ?? NaN)
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw Object.assign(new Error('request too large'), { status: 413 })
  }
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) throw Object.assign(new Error('request too large'), { status: 413 })
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8'))
  } catch {
    throw Object.assign(new Error('body is not JSON'), { status: 400 })
  }
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function loginPage(configured, localUrl, productTitle) {
  const setup = configured ? '' : `<p class="notice">尚未设置局域网密码。请先在本机打开 <a href="${localUrl}">${localUrl}</a>，进入“设置 → 通用设置”完成配置。</p>`
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>登录 · ${escapeHtml(productTitle)}</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;background:#f5f7fb;color:#15171a}.card{width:min(400px,calc(100% - 32px));padding:32px;border:1px solid #dde2ea;border-radius:18px;background:#fff;box-shadow:0 16px 48px #1f293714}h1{margin:0 0 8px;font-size:24px}p{margin:0 0 24px;color:#606771;line-height:1.6}.notice{padding:12px;border-radius:10px;background:#fff5d8;color:#765800;font-size:14px}a{color:inherit}label{display:block;margin-bottom:8px;font-size:14px}input,button{width:100%;height:44px;border-radius:10px;font:inherit}input{padding:0 12px;border:1px solid #cfd5df;background:transparent;color:inherit}button{margin-top:16px;border:0;background:#3964fe;color:#fff;cursor:pointer}button:disabled{opacity:.6;cursor:wait}.error{min-height:22px;margin:12px 0 0;color:#c62828;font-size:14px}@media(prefers-color-scheme:dark){body{background:#111318;color:#f1f3f5}.card{background:#1b1e24;border-color:#303641}p{color:#b7bec8}.notice{background:#3b321b;color:#f4d77a}input{border-color:#454c59}}
</style>
</head>
<body>
<main class="card">
<h1>局域网登录</h1>
<p>请输入访问密码。</p>
${setup}
<form id="login">
<label for="password">密码</label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus maxlength="1024" ${configured ? '' : 'disabled'}>
<button type="submit" ${configured ? '' : 'disabled'}>登录</button>
<p id="error" class="error" role="alert"></p>
</form>
</main>
<script>
const form=document.querySelector('#login'),error=document.querySelector('#error'),button=form.querySelector('button');
form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;error.textContent='';try{const response=await fetch('/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:form.password.value})});if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||'登录失败')}location.reload()}catch(reason){error.textContent=reason instanceof Error?reason.message:String(reason);button.disabled=false;form.password.select()}});
</script>
</body>
</html>`
}

function rejectUpgrade(socket, status, message) {
  socket.end([
    `HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : 'Unauthorized'}`,
    'Connection: close',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(message)}`,
    '',
    message,
  ].join('\r\n'))
}

export function apply(ctx) {
  const server = ctx.webServer
  const proxyAuthority = `${ctx.webStartup.authProxyHost}:${server.port}`
  const trustedHosts = resolveLanTrust(server.host, [...ctx.webStartup.trustedHosts, ctx.webStartup.authProxyHost]).trustedHosts
  const sessions = new Map()
  const failures = new Map()
  const originals = {
    register: server.register,
    registerFallback: server.registerFallback,
    registerUpgrade: server.registerUpgrade,
  }
  // The pinned Web server exposes no middleware seat, so cover routes mounted both before and after this fiber.
  if (!(server.exact instanceof Map) || !(server.prefixes instanceof Map) || !(server.upgrades instanceof Map)) {
    throw new Error('lan-auth: the pinned webserver route registry shape changed')
  }

  const accepted = req => isSameOriginRequest(req.headers) || isSafeCrossSiteNavigation(req)
  const forward = async (req, next, preserveAuthority = false) => {
    if (preserveAuthority || isLoopbackRequest(req) || !isLoopbackHost(req.headers.host) && isTrustedLanRequest(req.headers, trustedHosts)) return next()
    const host = req.headers.host
    const origin = req.headers.origin
    req.headers.host = proxyAuthority
    if (typeof origin === 'string') req.headers.origin = `${new URL(origin).protocol}//${proxyAuthority}`
    try {
      return await next()
    } finally {
      req.headers.host = host
      if (origin === undefined) delete req.headers.origin
      else req.headers.origin = origin
    }
  }
  const authenticated = req => {
    if (isLoopbackRequest(req)) return true
    const token = cookie(req)
    const expires = token === undefined ? undefined : sessions.get(token)
    if (expires === undefined) return false
    if (expires <= Date.now()) {
      sessions.delete(token)
      return false
    }
    return true
  }
  const issueSession = req => {
    while (sessions.size >= 16) sessions.delete(sessions.keys().next().value)
    const token = randomBytes(32).toString('base64url')
    sessions.set(token, Date.now() + SESSION_TTL_SECONDS * 1000)
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secureRequest(req) ? '; Secure' : ''}`
  }
  const describePassword = () => ctx.credentials.describe(PASSWORD_REF)
  const localUrl = `http://127.0.0.1:${server.port}`

  const unauthorized = async (req, res) => {
    const accept = req.headers.accept
    const documentRequest = req.method === 'GET' && (req.headers['sec-fetch-dest'] === 'document' || typeof accept === 'string' && accept.includes('text/html'))
    if (!documentRequest) {
      sendJson(res, 401, { error: 'authentication required' })
      return
    }
    const info = await describePassword()
    send(res, 200, loginPage(info.configured, localUrl, ctx.webStartup.title), {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    })
  }
  const guard = async (req, res, next) => {
    if (!accepted(req)) {
      send(res, 403, 'forbidden', { 'content-type': 'text/plain; charset=utf-8' })
      return
    }
    if (!authenticated(req)) {
      await unauthorized(req, res)
      return
    }
    await forward(req, next)
  }
  const clientKey = req => req.socket?.remoteAddress ?? 'unknown'
  const blocked = req => {
    const key = clientKey(req)
    const now = Date.now()
    const state = failures.get(key)
    if (state === undefined || now - state.startedAt >= FAILURE_WINDOW_MS) {
      failures.delete(key)
      return false
    }
    return state.count >= MAX_FAILURES
  }
  const rememberFailure = req => {
    const key = clientKey(req)
    const now = Date.now()
    const state = failures.get(key)
    if (state === undefined || now - state.startedAt >= FAILURE_WINDOW_MS) {
      if (failures.size >= 1024) failures.delete(failures.keys().next().value)
      failures.set(key, { count: 1, startedAt: now })
    } else state.count += 1
  }

  const login = async (req, res) => {
    if (!accepted(req)) return send(res, 403, 'forbidden')
    if (req.method !== 'POST') return send(res, 405, 'method not allowed', { allow: 'POST' })
    if (blocked(req)) return sendJson(res, 429, { error: '尝试次数过多，请稍后再试' }, { 'retry-after': '60' })
    let body
    try {
      body = await readJson(req)
    } catch (error) {
      return sendJson(res, error.status ?? 400, { error: error.message })
    }
    if (typeof body?.password !== 'string' || Buffer.byteLength(body.password) > MAX_PASSWORD_BYTES) {
      rememberFailure(req)
      return sendJson(res, 401, { error: '密码错误' })
    }
    const resolved = await ctx.credentials.resolve(PASSWORD_REF)
    if (resolved === undefined) return sendJson(res, 503, { error: '尚未配置局域网密码' })
    if (!passwordsMatch(body.password, resolved.value)) {
      rememberFailure(req)
      return sendJson(res, 401, { error: '密码错误' })
    }
    failures.delete(clientKey(req))
    sendJson(res, 200, { ok: true }, { 'set-cookie': issueSession(req) })
  }

  const password = async (req, res) => {
    if (!accepted(req)) return send(res, 403, 'forbidden')
    if (!authenticated(req)) return sendJson(res, 401, { error: 'authentication required' })
    if (req.method === 'GET') {
      const info = await describePassword()
      return sendJson(res, 200, info)
    }
    if (req.method !== 'POST') return send(res, 405, 'method not allowed', { allow: 'GET, POST' })
    let body
    try {
      body = await readJson(req)
    } catch (error) {
      return sendJson(res, error.status ?? 400, { error: error.message })
    }
    if (!validatePassword(body?.password)) return sendJson(res, 400, { error: '密码至少 8 位，且不能超过 1024 字节' })
    const info = await describePassword()
    if (!info.writable) return sendJson(res, 409, { error: '密码由启动环境提供，不能在页面中修改' })
    await ctx.credentials.set(PASSWORD_REF, body.password)
    sessions.clear()
    sendJson(res, 200, { ok: true, reauthenticate: !isLoopbackRequest(req) })
  }

  const replaced = []
  const replacedFallbacks = []
  const wrapRoute = route => ({
    ...route,
    handler: (req, res) => guard(req, res, () => route.handler(req, res)),
  })
  const wrapUpgrade = route => ({
    ...route,
    handler: (req, socket, head) => {
      if (!accepted(req)) return rejectUpgrade(socket, 403, 'forbidden')
      if (!authenticated(req)) return rejectUpgrade(socket, 401, 'unauthorized')
      // The authenticated terminal route owns its same-origin/local-address fence;
      // rewriting a Tailscale Host to the internal bridge authority makes it reject.
      return forward(req, () => route.handler(req, socket, head), route.path === WEB_TERMINAL_PATH)
    },
  })
  const guardedRegister = route => {
    const wrapped = wrapRoute(route)
    const dispose = originals.register.call(server, wrapped)
    replaced.push({ table: route.kind === 'exact' ? server.exact : server.prefixes, path: route.path, route, wrapped })
    return dispose
  }
  const guardedFallback = handler => {
    const wrapped = wrapRoute({ handler }).handler
    const dispose = originals.registerFallback.call(server, wrapped)
    replacedFallbacks.push({ handler, wrapped })
    return dispose
  }
  const guardedUpgrade = route => {
    const wrapped = wrapUpgrade(route)
    const dispose = originals.registerUpgrade.call(server, wrapped)
    replaced.push({ table: server.upgrades, path: route.path, route, wrapped })
    return dispose
  }

  ctx.on('credentials/updated', ref => {
    if (ref === PASSWORD_REF) sessions.clear()
  })
  ctx.effect(() => {
    const disposeLogin = originals.register.call(server, { kind: 'exact', path: '/auth/login', handler: login })
    const disposePassword = originals.register.call(server, { kind: 'exact', path: '/auth/password', handler: password })
    for (const table of [server.exact, server.prefixes]) {
      for (const [path, route] of table) {
        if (path === '/auth/login' || path === '/auth/password') continue
        const wrapped = wrapRoute(route)
        table.set(path, wrapped)
        replaced.push({ table, path, route, wrapped })
      }
    }
    for (const [path, route] of server.upgrades) {
      const wrapped = wrapUpgrade(route)
      server.upgrades.set(path, wrapped)
      replaced.push({ table: server.upgrades, path, route, wrapped })
    }
    const fallback = server.fallback
    const wrappedFallback = fallback === undefined ? undefined : wrapRoute({ handler: fallback }).handler
    if (wrappedFallback !== undefined) {
      server.fallback = wrappedFallback
      replacedFallbacks.push({ handler: fallback, wrapped: wrappedFallback })
    }
    server.register = guardedRegister
    server.registerFallback = guardedFallback
    server.registerUpgrade = guardedUpgrade
    return () => {
      if (server.register === guardedRegister) server.register = originals.register
      if (server.registerFallback === guardedFallback) server.registerFallback = originals.registerFallback
      if (server.registerUpgrade === guardedUpgrade) server.registerUpgrade = originals.registerUpgrade
      for (const item of replaced) {
        if (item.table.get(item.path) === item.wrapped) item.table.set(item.path, item.route)
      }
      for (const item of replacedFallbacks.reverse()) {
        if (server.fallback === item.wrapped) server.fallback = item.handler
      }
      disposePassword()
      disposeLogin()
      sessions.clear()
      failures.clear()
    }
  }, 'LAN password authentication')
}

export default { name, inject, apply }
