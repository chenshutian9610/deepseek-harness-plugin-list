const DEFAULT_CONTEXT_PATH = '/'
const ROOT_RESOURCE_PATHS = ['/api', '/auth', '/assets', '/plugins', '/web-terminal', '/favicon.svg', '/manifest.webmanifest']

export const name = 'web-context-path'
export const inject = ['webServer', 'webStartup']

export function normalizeContextPath(value = DEFAULT_CONTEXT_PATH) {
  if (value === '' || value === '/') return ''
  if (typeof value !== 'string' || !value.startsWith('/') || value.endsWith('/') || value.includes('?') || value.includes('#') || value.includes('\\')) {
    throw new Error(`web-context-path: context path must be / or an absolute path without a trailing slash, got ${JSON.stringify(value)}`)
  }
  const segments = value.slice(1).split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..' || decodeURIComponent(segment) !== segment)) {
    throw new Error(`web-context-path: invalid context path ${JSON.stringify(value)}`)
  }
  return value
}

function prefixedPath(contextPath, path) {
  if (contextPath === '') return path
  return path === '/' ? `${contextPath}/` : `${contextPath}${path}`
}

async function stripRequestContext(req, contextPath, next) {
  if (contextPath === '') return next()
  const original = req.url
  const url = new URL(original ?? '/', 'http://dsh.internal')
  url.pathname = url.pathname.slice(contextPath.length) || '/'
  req.url = `${url.pathname}${url.search}`
  try {
    return await next()
  } finally {
    req.url = original
  }
}

function browserBootstrap(contextPath) {
  const roots = JSON.stringify(ROOT_RESOURCE_PATHS)
  return `<script data-web-context-path>(()=>{const base=${JSON.stringify(contextPath)},roots=${roots};window.__DSH_CONTEXT_PATH__=base;const map=input=>{try{const url=input instanceof URL?new URL(input.href):new URL(String(input),location.href);if(url.host!==location.host||url.pathname===base||url.pathname.startsWith(base+'/'))return input;if(!roots.some(root=>url.pathname===root||url.pathname.startsWith(root+'/')))return input;url.pathname=base+url.pathname;return input instanceof URL?url:url.href}catch{return input}};const nativeFetch=window.fetch.bind(window);window.fetch=(input,init)=>nativeFetch(map(input),init);const NativeWebSocket=window.WebSocket;window.WebSocket=class extends NativeWebSocket{constructor(url,protocols){if(protocols===undefined)super(map(url));else super(map(url),protocols)}};Object.defineProperties(window.WebSocket,{CONNECTING:{value:NativeWebSocket.CONNECTING},OPEN:{value:NativeWebSocket.OPEN},CLOSING:{value:NativeWebSocket.CLOSING},CLOSED:{value:NativeWebSocket.CLOSED}});const NativeEventSource=window.EventSource;if(NativeEventSource)window.EventSource=class extends NativeEventSource{constructor(url,options){if(options===undefined)super(map(url));else super(map(url),options)}}})()</script>`
}

export function rewriteContextBody(body, contentType, contextPath) {
  if (contextPath === '' || body.length === 0) return body
  if (contentType.startsWith('text/html')) {
    let html = body.toString('utf8')
    html = html
      .replaceAll('href="/', `href="${contextPath}/`)
      .replaceAll('src="/', `src="${contextPath}/`)
      .replaceAll("fetch('/", `fetch('${contextPath}/`)
      .replaceAll('"url":"/plugins/', `"url":"${contextPath}/plugins/`)
    const script = browserBootstrap(contextPath)
    const head = html.indexOf('<head>')
    html = head === -1 ? `${script}${html}` : `${html.slice(0, head + 6)}${script}${html.slice(head + 6)}`
    return Buffer.from(html)
  }
  if (contentType.startsWith('text/css')) {
    return Buffer.from(body.toString('utf8').replaceAll('url(/', `url(${contextPath}/`))
  }
  if (contentType.startsWith('application/manifest+json')) {
    const manifest = JSON.parse(body.toString('utf8'))
    for (const key of ['id', 'start_url', 'scope']) {
      if (typeof manifest[key] === 'string' && manifest[key].startsWith('/')) manifest[key] = `${contextPath}${manifest[key]}`
    }
    if (Array.isArray(manifest.icons)) {
      for (const icon of manifest.icons) if (typeof icon?.src === 'string' && icon.src.startsWith('/')) icon.src = `${contextPath}${icon.src}`
    }
    return Buffer.from(JSON.stringify(manifest))
  }
  return body
}

async function transformResponse(res, contextPath, next) {
  if (contextPath === '') return next()
  const originalWriteHead = res.writeHead
  const originalWrite = res.write
  const originalEnd = res.end
  let transform = false
  let statusCode
  let statusMessage
  let headers
  const chunks = []

  res.writeHead = function patchedWriteHead(status, messageOrHeaders, maybeHeaders) {
    statusCode = status
    if (typeof messageOrHeaders === 'string') {
      statusMessage = messageOrHeaders
      headers = maybeHeaders ?? {}
    } else headers = messageOrHeaders ?? {}
    const contentType = String(headers['content-type'] ?? headers['Content-Type'] ?? res.getHeader?.('content-type') ?? '')
    transform = contentType.startsWith('text/html') || contentType.startsWith('text/css') || contentType.startsWith('application/manifest+json')
    if (!transform) return originalWriteHead.call(this, status, messageOrHeaders, maybeHeaders)
    return this
  }
  res.write = function patchedWrite(chunk, encoding, callback) {
    if (!transform) return originalWrite.call(this, chunk, encoding, callback)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding))
    callback?.()
    return true
  }
  res.end = function patchedEnd(chunk, encoding, callback) {
    if (!transform) return originalEnd.call(this, chunk, encoding, callback)
    if (chunk !== undefined && chunk !== null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding))
    const contentType = String(headers['content-type'] ?? headers['Content-Type'] ?? res.getHeader?.('content-type') ?? '')
    const body = rewriteContextBody(Buffer.concat(chunks), contentType, contextPath)
    const nextHeaders = { ...headers, 'content-length': String(body.length) }
    delete nextHeaders['Content-Length']
    if (statusMessage === undefined) originalWriteHead.call(this, statusCode ?? 200, nextHeaders)
    else originalWriteHead.call(this, statusCode ?? 200, statusMessage, nextHeaders)
    return originalEnd.call(this, body, undefined, callback)
  }
  try {
    return await next()
  } finally {
    res.writeHead = originalWriteHead
    res.write = originalWrite
    res.end = originalEnd
  }
}

export function apply(ctx) {
  const server = ctx.webServer
  const contextPath = normalizeContextPath(ctx.webStartup.contextPath)
  if (contextPath === '') return

  const originals = {
    register: server.register,
    registerFallback: server.registerFallback,
    registerUpgrade: server.registerUpgrade,
  }
  const registrations = []
  const wrapHandler = handler => (req, res) => transformResponse(res, contextPath, () => stripRequestContext(req, contextPath, () => handler(req, res)))
  const wrapRoute = route => ({ ...route, path: prefixedPath(contextPath, route.path), handler: wrapHandler(route.handler) })
  const wrapUpgrade = route => ({
    ...route,
    path: prefixedPath(contextPath, route.path),
    handler: (req, socket, head) => stripRequestContext(req, contextPath, () => route.handler(req, socket, head)),
  })

  const contextualRegister = route => originals.register.call(server, wrapRoute(route))
  const contextualFallback = handler => originals.register.call(server, {
    kind: 'prefix',
    path: contextPath,
    handler: wrapHandler(handler),
  })
  const contextualUpgrade = route => originals.registerUpgrade.call(server, wrapUpgrade(route))

  ctx.effect(() => {
    for (const table of [server.exact, server.prefixes]) {
      for (const [path, route] of [...table]) {
        table.delete(path)
        const wrapped = wrapRoute(route)
        table.set(wrapped.path, wrapped)
        registrations.push({ table, path: wrapped.path, originalPath: path, originalRoute: route, wrapped })
      }
    }
    for (const [path, route] of [...server.upgrades]) {
      server.upgrades.delete(path)
      const wrapped = wrapUpgrade(route)
      server.upgrades.set(wrapped.path, wrapped)
      registrations.push({ table: server.upgrades, path: wrapped.path })
    }
    server.register = contextualRegister
    server.registerFallback = contextualFallback
    server.registerUpgrade = contextualUpgrade

    const redirect = location => (_req, res) => {
      res.writeHead(308, { location, 'cache-control': 'no-store' })
      res.end()
    }
    const rootRoute = { kind: 'exact', path: '/', handler: redirect(`${contextPath}/`) }
    const contextRootRoute = { kind: 'exact', path: contextPath, handler: redirect(`${contextPath}/`) }
    server.exact.set(rootRoute.path, rootRoute)
    server.exact.set(contextRootRoute.path, contextRootRoute)

    return () => {
      if (server.exact.get(contextRootRoute.path) === contextRootRoute) server.exact.delete(contextRootRoute.path)
      if (server.exact.get(rootRoute.path) === rootRoute) server.exact.delete(rootRoute.path)
      if (server.register === contextualRegister) server.register = originals.register
      if (server.registerFallback === contextualFallback) server.registerFallback = originals.registerFallback
      if (server.registerUpgrade === contextualUpgrade) server.registerUpgrade = originals.registerUpgrade
      for (const item of registrations) {
        if (item.table.get(item.path) !== item.wrapped) continue
        item.table.delete(item.path)
        item.table.set(item.originalPath, item.originalRoute)
      }
    }
  }, `Web context path ${contextPath}`)
}

export default { name, inject, apply }
