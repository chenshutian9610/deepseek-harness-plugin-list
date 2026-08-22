import assert from 'node:assert/strict'
import { once } from 'node:events'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import { DEFAULT_MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_DIMENSION } from '@deepseek-ai/dsh-attachment-local'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import LlmRuntime, { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { packChunkRuns } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as LanAuth from './lan-auth/index.mjs'
import * as LanSettings from './lan-settings.mjs'
import CustomProviders, { CustomProviderAdapter } from './llm-custom-providers.mjs'
import { dedupeProfilePatches, loadWebProfilePatches } from './profile-config.mjs'
import { patchRemoteSettingsSource } from './patch-remote-settings-client.mjs'
import { READ_ONLY_HISTORY_EVENT, readOnlyHistoryPrefix } from './session-persistence-jsonl-readonly.mjs'
import { renderStartupError } from './startup-diagnostics.mjs'
import { normalizeContextPath, rewriteContextBody } from './web-context-path.mjs'
import { injectWebCryptoPolyfill, WEB_CRYPTO_POLYFILL } from './web-crypto-polyfill.mjs'
import { createTitleBootstrap, injectProductTitle } from './web-title.mjs'
import * as WebStartup from './web-startup.mjs'

const config = await readFile(new URL('./cordis.yml', import.meta.url), 'utf8')
const presets = await Promise.all(['standard', 'code', 'minimal', 'cordis'].map(id => readFile(new URL(`./agent-presets/${id}/agent.cordis.yml`, import.meta.url), 'utf8')))
const manifest = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'))
const lock = JSON.parse(await readFile(new URL('./package-lock.json', import.meta.url), 'utf8'))
const authClient = await readFile(new URL('./lan-auth/client.js', import.meta.url), 'utf8')
const mobileStyle = await readFile(new URL('./web-mobile-style.mjs', import.meta.url), 'utf8')
const projectMcpSource = await readFile(new URL('./project-mcp/src/index.ts', import.meta.url), 'utf8')
const mcpClientSource = await readFile(new URL('./project-mcp/src/mcp-client/index.ts', import.meta.url), 'utf8')

for (const plugin of [
  '@deepseek-ai/dsh-client-ui-model-selection',
  '@deepseek-ai/dsh-client-ui-settings-general',
  '@deepseek-ai/dsh-client-ui-settings-models',
  '@deepseek-ai/dsh-client-ui-settings-plugins',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-brand-official',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-ui-reference',
  '@deepseek-ai/dsh-session-reference',
  '@deepseek-ai/dsh-file-reference-local',
  '@deepseek-ai/dsh-client-ui-skill',
  '@deepseek-ai/dsh-client-ui-subagent',
  '@deepseek-ai/dsh-client-ui-workflow-run',
  '@deepseek-ai/dsh-bash-local',
  '@deepseek-ai/dsh-pwsh-local',
  '@deepseek-ai/dsh-fs-local',
]) assert.ok(config.includes(`name: '${plugin}'`), `missing ${plugin}`)
assert.ok(config.includes("name: './lan-settings.mjs'"), 'missing opt-in LAN settings provider')
assert.ok(manifest.files.includes('patch-remote-settings-client.mjs'), 'missing packaged remote settings client patch')
assert.ok(config.includes("name: 'deepseek-harness-web-lan-auth'"), 'missing LAN authentication provider')
assert.ok(config.includes('ctx.webStartup.authProxyHost'), 'missing authenticated arbitrary-domain bridge authority')
assert.ok(config.includes("name: '@deepseek-ai/dsh-subprocess-local'"), 'missing PTY-capable local subprocess provider')
assert.ok(config.includes("name: './llm-custom-providers.mjs'"), 'missing custom LLM provider')
assert.ok(config.includes("name: './web-context-path.mjs'"), 'missing Web context-path provider')
assert.ok(config.includes("name: './web-crypto-polyfill.mjs'"), 'missing insecure-origin Web Crypto compatibility')
assert.ok(config.includes("name: './web-title.mjs'"), 'missing custom browser title provider')
assert.ok(config.includes("name: './web-startup.mjs'"), 'missing network-capable web startup provider')
assert.ok(config.includes('openBrowser: false'), 'standalone Web must not auto-open a browser')
assert.ok(config.includes("name: './project-mcp/lib/index.js'"), 'missing built-in project MCP provider')
assert.ok(config.includes("name: './session-persistence-jsonl-readonly.mjs'"), 'missing corrupt-history read-only fallback')
assert.ok(config.includes('    - sessionProjections'), 'read-only persistence fallback must wait for projection registry')

for (const plugin of [
  '@deepseek-ai/dsh-sandbox-local',
  '@deepseek-ai/dsh-bash-sandbox',
  '@deepseek-ai/dsh-pwsh-sandbox',
  '@deepseek-ai/dsh-fs-sandbox',
  '@deepseek-ai/dsh-session-telemetry-otel',
  '@deepseek-ai/dsh-llm-pi-ai',
  '@deepseek-ai/dsh-tool-web',
  '@deepseek-ai/dsh-web',
  '@deepseek-ai/dsh-web-search-deepseek',
]) assert.equal(manifest.dependencies[plugin], undefined, `${plugin} must not be installed`)
for (const [plugin, version] of Object.entries(manifest.dependencies)) {
  if (plugin.startsWith('@deepseek-ai/dsh-')) assert.equal(version, '0.1.0-rc.8', `${plugin} must be pinned to rc.8`)
}
for (const plugin of ['@deepseek-ai/dsh-tool-web', '@deepseek-ai/dsh-web', '@deepseek-ai/dsh-web-search-deepseek']) {
  assert.ok(!config.includes(`name: '${plugin}'`), `${plugin} must not be composed on the host`)
}
assert.ok(presets.every(preset => !preset.includes("name: '@deepseek-ai/dsh-tool-web'")), 'web tool must not be composed by a preset')
assert.ok(presets[2].includes("name: '@deepseek-ai/dsh-tool-bash-persistent'"), 'minimal preset must provide persistent bash')
assert.ok(presets[2].includes("name: '@deepseek-ai/dsh-tool-str-replace-editor'"), 'minimal preset must provide str_replace_editor')
for (const plugin of [
  '@deepseek-ai/dsh-llm-pi-ai',
  '@deepseek-ai/dsh-tool-web',
  '@deepseek-ai/dsh-web',
  '@deepseek-ai/dsh-web-search-deepseek',
  '@mixmark-io/domino',
  'turndown',
  '@earendil-works/pi-ai',
  '@aws-sdk/client-bedrock-runtime',
  '@google/genai',
  '@mistralai/mistralai',
]) assert.equal(lock.packages[`node_modules/${plugin}`], undefined, `${plugin} must be absent from the production closure`)
assert.equal(manifest.dependencies.openai, '6.26.0')
assert.equal(manifest.dependencies['@anthropic-ai/sdk'], '0.91.1')
assert.equal(manifest.dependencies['deepseek-harness-web-lan-auth'], 'file:./lan-auth')
assert.equal(manifest.dependencies['@modelcontextprotocol/sdk'], '1.29.0')
assert.equal(manifest.dependencies.zod, '4.4.3')
assert.equal(lock.packages['node_modules/node-pty'].version, '1.2.0-beta.15')
assert.equal(lock.packages['node_modules/koffi'].version, '3.1.5')
assert.equal(lock.packages['node_modules/deepseek-harness-web-lan-auth'].link, true)
assert.equal(lock.packages['node_modules/deepseek-harness-web-project-mcp'], undefined)
assert.equal(lock.packages['project-mcp'], undefined, 'project MCP must not be a nested npm package')
assert.equal(DEFAULT_MAX_IMAGE_BYTES, 3.5 * 1024 * 1024, 'rc.8 attachment byte limit drift must stay explicit')
assert.equal(DEFAULT_MAX_IMAGE_DIMENSION, 2_000, 'rc.8 attachment dimension drift must stay explicit')
assert.equal(resolveRetryPolicy(undefined, 'deepseek-harness-web rc.8 defaults').maxRetries, 5, 'rc.8 retry drift must stay explicit')
assert.ok(manifest.files.includes('profile-config.mjs'))
assert.ok(manifest.files.includes('session-persistence-jsonl-readonly.mjs'))
assert.ok(manifest.files.includes('startup-diagnostics.mjs'))
assert.ok(manifest.files.includes('web-context-path.mjs'))
assert.ok(manifest.files.includes('web-title.mjs'))
assert.ok(manifest.files.includes('web-mobile-style.mjs'))
assert.match(mobileStyle, /body \[data-question-key\] > section > footer/)
assert.match(mobileStyle, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
assert.match(mobileStyle, /padding: 6px 8px calc\(10px \+ env\(safe-area-inset-bottom\)\)/)
assert.ok(manifest.files.includes('lan-auth'))
assert.ok(manifest.files.includes('project-mcp/lib'))
assert.ok(manifest.files.includes('project-mcp/src'))
assert.ok(authClient.includes("id: 'deepseek-harness-web-lan-auth'"))
assert.ok(projectMcpSource.includes("from './mcp-client/index.ts'"), 'project MCP must use the Web-owned MCP client')
assert.ok(!projectMcpSource.includes("from '@deepseek-ai/dsh-mcp-client'"), 'project MCP must not import the official MCP client package')
assert.ok(mcpClientSource.includes('const reservationOwner = ctx.agent ?? ctx.root'), 'MCP client reservation must be agent-scoped')

const historyHeader = JSON.stringify({ version: 0, id: 'session-readonly-test', createdAt: 1, cwd: '/tmp' })
const historyEvents = [
  { type: 'turn/start', seq: 0, time: 2, data: { turn: 0 } },
  { type: 'turn/end', seq: 1, time: 3, data: { turn: 0 } },
  { type: 'turn/start', seq: 2, time: 4, data: { turn: 1 } },
]
const duplicateBranch = { type: 'turn/start', seq: 1, time: 5, data: { turn: 1 } }
const readOnlyPrefix = readOnlyHistoryPrefix(`${historyHeader}\n${historyEvents.map(event => JSON.stringify(event)).join('\n')}\n${JSON.stringify(duplicateBranch)}\n`)
assert.deepEqual(readOnlyPrefix.map(event => event.seq), [0, 1], 'read-only fallback must stop at the last complete turn before a seq gap')
assert.equal(READ_ONLY_HISTORY_EVENT, 'deployment/read-only-history')

const packedHistory = packChunkRuns([
  { type: 'assistant/chunk', seq: 0, time: 10, data: { turn: 0, step: 0, chunk: { type: 'text-delta', text: 'a' } } },
  { type: 'assistant/chunk', seq: 1, time: 11, data: { turn: 0, step: 0, chunk: { type: 'text-delta', text: 'b' } } },
  { type: 'turn/end', seq: 2, time: 12, data: { turn: 0 } },
])
assert.deepEqual(
  readOnlyHistoryPrefix(`${historyHeader}\n${packedHistory.map(record => JSON.stringify(record)).join('\n')}\n`).map(event => event.seq),
  [0, 1, 2],
  'read-only fallback must decode packed chunk rows',
)
assert.deepEqual(
  readOnlyHistoryPrefix(`${historyHeader}\n${JSON.stringify(historyEvents[0])}\n{bad json}\n`).map(event => event.seq),
  [],
  'read-only fallback must not expose an incomplete turn',
)

const nestedStartupFailure = new Error('deepseek-harness-web: plugin tree failed to load: loader entries failed to apply', {
  cause: new AggregateError([
    new Error('failed to apply loader entry subprocess (@deepseek-ai/dsh-subprocess-local): Cannot find module ../build/Release/pty.node'),
    new Error('failed to apply loader entry directory-picker (@deepseek-ai/dsh-host-directory-picker-auto): unsupported platform'),
  ], 'loader entries failed to apply'),
})
const startupDiagnostic = renderStartupError(nestedStartupFailure)
assert.match(startupDiagnostic, /subprocess \(@deepseek-ai\/dsh-subprocess-local\)/)
assert.match(startupDiagnostic, /Cannot find module \.\.\/build\/Release\/pty\.node/)
assert.match(startupDiagnostic, /directory-picker \(@deepseek-ai\/dsh-host-directory-picker-auto\)/)

const profileRoot = await mkdtemp(join(tmpdir(), 'deepseek-harness-web-profile-'))
try {
  const appDir = join(profileRoot, 'app')
  const profileDir = join(profileRoot, 'home', 'profiles', 'web')
  const bundleDir = join(profileDir, 'node_modules', 'test-web-bundle')
  const legacyMcpBundleDir = join(profileDir, 'node_modules', 'dsh-project-mcp')
  await mkdir(bundleDir, { recursive: true })
  await mkdir(legacyMcpBundleDir, { recursive: true })
  const appManifest = join(appDir, 'package.json')
  const baseConfig = join(appDir, 'cordis.yml')
  await mkdir(join(appDir, 'node_modules'), { recursive: true })
  await symlink(join(profileRoot, 'missing-bundle'), join(appDir, 'node_modules', 'test-web-bundle'), process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(appManifest, JSON.stringify({ name: 'test-app', type: 'module' }))
  await writeFile(baseConfig, "- id: existing\n  name: existing-plugin\n  disabled: true\n  config:\n    value: base\n- id: project-mcp\n  name: ./project-mcp/lib/index.js\n")
  await writeFile(join(bundleDir, 'package.json'), JSON.stringify({
    name: 'test-web-bundle',
    type: 'module',
    main: './index.js',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  await writeFile(join(bundleDir, 'index.js'), 'export function apply() {}\n')
  await writeFile(join(bundleDir, 'cordis.patch.yml'), "- insert:\n    - id: external\n      name: test-web-bundle\n")
  await writeFile(join(legacyMcpBundleDir, 'package.json'), JSON.stringify({
    name: 'dsh-project-mcp',
    type: 'module',
    main: './index.js',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  await writeFile(join(legacyMcpBundleDir, 'index.js'), 'export function apply() {}\n')
  await writeFile(join(legacyMcpBundleDir, 'cordis.patch.yml'), "- insert:\n    - id: project-mcp\n      name: dsh-project-mcp\n")
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'test-web-bundle', 'dsh-project-mcp'] } },
  }))
  await writeFile(join(profileDir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: existing',
    '      name: existing-plugin',
    '      config:',
    '        value: profile',
    '    - id: added',
    '      name: added-plugin',
    '',
  ].join('\n'))

  const patches = loadWebProfilePatches({
    configPath: baseConfig,
    installAnchor: appManifest,
    home: join(profileRoot, 'home'),
  })
  const composed = applyEntryPatches([
    { id: 'existing', name: 'existing-plugin', disabled: true, config: { value: 'base' } },
    { id: 'project-mcp', name: './project-mcp/lib/index.js' },
  ], patches, message => assert.fail(message))
  assert.equal(composed.filter(entry => entry.id === 'existing').length, 1)
  assert.deepEqual(composed.find(entry => entry.id === 'existing').config, { value: 'profile' })
  assert.equal(composed.find(entry => entry.id === 'existing').disabled, undefined)
  assert.ok(composed.some(entry => entry.id === 'external'))
  assert.ok(composed.some(entry => entry.id === 'added'))
  assert.equal(composed.filter(entry => entry.id === 'project-mcp').length, 1)
  assert.equal(composed.find(entry => entry.id === 'project-mcp').name, './project-mcp/lib/index.js')
  assert.ok(!JSON.stringify(patches).includes('dsh-project-mcp'), 'legacy project MCP profile bundle must be ignored')
  assert.equal((await lstat(join(appDir, 'node_modules', 'test-web-bundle'))).isSymbolicLink(), true)
  assert.throws(() => dedupeProfilePatches(
    [{ id: 'same', name: 'first' }],
    [{ insert: [{ id: 'same', name: 'second' }] }],
  ), /profile insert id "same" conflicts/)
} finally {
  await rm(profileRoot, { recursive: true, force: true })
}

assert.equal(normalizeContextPath(), '')
assert.equal(normalizeContextPath('/'), '')
assert.equal(normalizeContextPath('/team/dsh'), '/team/dsh')
assert.throws(() => normalizeContextPath('dsh'), /absolute path/)
assert.throws(() => normalizeContextPath('/dsh/'), /trailing slash/)
const contextualHtml = rewriteContextBody(Buffer.from('<head><link href="/assets/app.css"><script src="/plugins/a/client.js"></script></head>'), 'text/html; charset=utf-8', '/dsh').toString()
assert.match(contextualHtml, /data-web-context-path/)
assert.match(contextualHtml, /href="\/dsh\/assets\/app\.css"/)
assert.match(contextualHtml, /src="\/dsh\/plugins\/a\/client\.js"/)
assert.equal(rewriteContextBody(Buffer.from('a{src:url(/assets/font.woff2)}'), 'text/css', '/dsh').toString(), 'a{src:url(/dsh/assets/font.woff2)}')
const contextualManifest = JSON.parse(rewriteContextBody(Buffer.from('{"id":"/","start_url":"/","scope":"/","icons":[{"src":"/favicon.svg"}]}'), 'application/manifest+json', '/dsh'))
assert.deepEqual(contextualManifest, { id: '/dsh/', start_url: '/dsh/', scope: '/dsh/', icons: [{ src: '/dsh/favicon.svg' }] })

const cryptoContext = {
  crypto: { getRandomValues: bytes => bytes.fill(0) },
}
runInNewContext(WEB_CRYPTO_POLYFILL, cryptoContext)
assert.equal(cryptoContext.crypto.randomUUID(), '00000000-0000-4000-8000-000000000000')
const nativeCryptoContext = { crypto: { randomUUID: () => 'native' } }
runInNewContext(WEB_CRYPTO_POLYFILL, nativeCryptoContext)
assert.equal(nativeCryptoContext.crypto.randomUUID(), 'native')
const polyfilledIndex = injectWebCryptoPolyfill('<head><script type="module"></script>')
assert.ok(polyfilledIndex.indexOf('data-web-crypto-polyfill') < polyfilledIndex.indexOf('type="module"'))
const remoteSettingsIndex = LanSettings.injectRemoteSettingsCapability('<head><script type="module"></script>')
assert.ok(remoteSettingsIndex.indexOf('data-remote-settings-capability') < remoteSettingsIndex.indexOf('type="module"'))
assert.equal(runInNewContext(`${LanSettings.REMOTE_SETTINGS_BOOTSTRAP};globalThis.__DSH_REMOTE_SETTINGS__`, {}), true)
const settingsGate = 'connection.isLoopback ? "host" : "memory"'
const patchedSettings = patchRemoteSettingsSource(`${settingsGate}\n${settingsGate}`)
assert.equal(patchedSettings.split('__DSH_REMOTE_SETTINGS__').length - 1, 2)
assert.equal(patchRemoteSettingsSource(patchedSettings), patchedSettings)
assert.match(injectProductTitle('<head><title>DeepSeek Harness</title></head>', '我的 AI 助手'), /data-web-product-title/)
assert.match(createTitleBootstrap('我的 AI 助手'), /我的 AI 助手/)
assert.doesNotThrow(() => new Function(createTitleBootstrap('</script><script>bad()</script>')))
assert.equal(WebStartup.normalizeProductTitle('  我的 AI 助手  '), '我的 AI 助手')
assert.throws(() => WebStartup.normalizeProductTitle('   '), /must not be empty/)
assert.throws(() => WebStartup.normalizeProductTitle('bad\ntitle'), /control characters/)

const startupCtx = new Context()
provideCmdline(startupCtx, {
  args: ['--host', '0.0.0.0', '--port', '0', '--trusted-host', 'harness.example.com', '--title', '我的 AI 助手', '--allow-remote-settings'],
  exit: code => assert.fail(`web startup unexpectedly requested exit ${code}`),
})
const startupFiber = await startupCtx.plugin(WebStartup)
assert.equal(WebStartup.AUTH_PROXY_HOST, 'dsh-auth.invalid')
assert.deepEqual(startupCtx.get('webStartup'), {
  host: '0.0.0.0',
  port: 0,
  trustedHosts: ['harness.example.com'],
  contextPath: '/',
  title: '我的 AI 助手',
  authProxyHost: 'dsh-auth.invalid',
  allowRemoteSettings: true,
})
assert.equal(LanSettings.isTrustedLanRequest({ host: '192.168.1.8:3081', origin: 'http://192.168.1.8:3081' }, ['192.168.1.8']), true)
assert.equal(LanSettings.isTrustedLanRequest({ host: 'harness.example.com:3081', origin: 'http://harness.example.com:3081' }, ['harness.example.com']), true)
assert.equal(LanSettings.isTrustedLanRequest({ host: '192.168.1.8:3081', origin: 'http://evil.example.com' }, ['192.168.1.8']), false)
assert.equal(LanSettings.isTrustedLanRequest({ host: '192.168.1.8:3081', 'sec-fetch-site': 'cross-site' }, ['192.168.1.8']), false)
assert.equal(LanSettings.isSameOriginRequest({ host: 'unlisted.example:3081', origin: 'http://unlisted.example:3081' }), true)
assert.equal(LanSettings.isSameOriginRequest({ host: 'unlisted.example:3081', origin: 'http://evil.example' }), false)
const lanRoutes = []
LanSettings.apply({
  apiProxy: {},
  webRuntime: { trustedHosts: ['192.168.1.8'] },
  webServer: {
    tapIndex(transform) {
      assert.match(transform('<head></head>'), /data-remote-settings-capability/)
      return () => {}
    },
    register(route) { lanRoutes.push(route); return () => {} },
  },
  effect(setup) { setup() },
}, { enabled: true })
assert.ok(lanRoutes.every(route => route.kind === 'exact'))
assert.ok(lanRoutes.some(route => route.path === '/api/settings.describe'))
assert.ok(lanRoutes.some(route => route.path === '/api/credentials.set'))
assert.ok(lanRoutes.some(route => route.path === '/api/llm.discoverModels'))
assert.ok(!lanRoutes.some(route => route.path === '/api/settings.openDocument'))
await startupFiber.dispose()
await startupCtx.fiber.dispose()

assert.equal(LanAuth.isLoopbackAddress('::1'), true)
assert.equal(LanAuth.isLoopbackAddress('::ffff:127.0.0.1'), true)
assert.equal(LanAuth.isLoopbackAddress('192.168.1.8'), false)
assert.equal(LanAuth.isSafeCrossSiteNavigation({ method: 'GET', headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } }), true)
assert.equal(LanAuth.isSafeCrossSiteNavigation({ method: 'POST', headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } }), false)
assert.equal(LanAuth.isSafeCrossSiteNavigation({ method: 'GET', headers: { origin: 'http://evil.example', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } }), false)
assert.equal(LanAuth.isSafeCrossSiteNavigation({ method: 'GET', headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' } }), false)
assert.equal(LanAuth.validatePassword('1234567'), false)
assert.equal(LanAuth.validatePassword('12345678'), true)

const authRoutes = new Map()
const authServer = {
  host: '0.0.0.0',
  port: 3081,
  exact: authRoutes,
  prefixes: new Map(),
  upgrades: new Map(),
  fallback: undefined,
  register(route) {
    const table = route.kind === 'exact' ? this.exact : this.prefixes
    assert.ok(!table.has(route.path), `duplicate test auth route ${route.path}`)
    table.set(route.path, route)
    return () => table.delete(route.path)
  },
  registerFallback(handler) {
    this.fallback = handler
    return () => { this.fallback = undefined }
  },
  registerUpgrade(route) {
    this.upgrades.set(route.path, route)
    return () => this.upgrades.delete(route.path)
  },
}
let authPassword = 'correct password'
let protectedCalls = 0
let protectedHost
let terminalHost
authServer.register({
  kind: 'exact',
  path: '/preexisting',
  handler: async (_req, res) => {
    protectedCalls += 100
    res.writeHead(204).end()
  },
})
LanAuth.apply({
  credentials: {
    describe: async () => ({ configured: true, writable: true, source: 'file' }),
    resolve: async () => ({ value: authPassword, source: 'file' }),
    set: async (_ref, value) => { authPassword = value },
  },
  webServer: authServer,
  webStartup: { trustedHosts: [], authProxyHost: 'dsh-auth.invalid', title: '我的 AI 助手' },
  effect(setup) { setup() },
  on() {},
})
authServer.register({
  kind: 'exact',
  path: '/protected',
  handler: async (req, res) => {
    protectedCalls += 1
    protectedHost = req.headers.host
    res.writeHead(204).end()
  },
})
authServer.registerUpgrade({
  path: '/web-terminal',
  handler: (req) => { terminalHost = req.headers.host },
})
const authRequest = (remoteAddress, headers = {}, body) => ({
  method: body === undefined ? 'GET' : 'POST',
  url: '/test',
  headers: { host: '127.0.0.1:3081', ...headers },
  socket: { remoteAddress },
  async *[Symbol.asyncIterator]() {
    if (body !== undefined) yield Buffer.from(body)
  },
})
const authResponse = () => ({
  status: undefined,
  headers: {},
  body: '',
  writeHead(status, headers = {}) {
    this.status = status
    this.headers = headers
    return this
  },
  end(body = '') {
    this.body = String(body)
    return this
  },
})
const preexistingPage = authResponse()
await authRoutes.get('/preexisting').handler(authRequest('192.168.1.8', { accept: 'text/html' }), preexistingPage)
assert.match(preexistingPage.body, /局域网登录/)
assert.equal(protectedCalls, 0)
const domainHeaders = { host: 'unlisted.example:3081', origin: 'http://unlisted.example:3081' }
const remotePage = authResponse()
await authRoutes.get('/protected').handler(authRequest('192.168.1.8', { ...domainHeaders, accept: 'text/html' }), remotePage)
assert.equal(remotePage.status, 200)
assert.match(remotePage.body, /局域网登录/)
assert.match(remotePage.body, /<title>登录 · 我的 AI 助手<\/title>/)
assert.equal(protectedCalls, 0)
const installedPwaPage = authResponse()
await authRoutes.get('/protected').handler(authRequest('192.168.1.8', {
  host: 'unlisted.example:3081',
  accept: 'text/html',
  'sec-fetch-site': 'cross-site',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
}), installedPwaPage)
assert.equal(installedPwaPage.status, 200)
assert.match(installedPwaPage.body, /局域网登录/)
assert.equal(protectedCalls, 0)
const crossSiteApi = authResponse()
await authRoutes.get('/protected').handler(authRequest('192.168.1.8', {
  host: 'unlisted.example:3081',
  'sec-fetch-site': 'cross-site',
  'sec-fetch-mode': 'cors',
  'sec-fetch-dest': 'empty',
}), crossSiteApi)
assert.equal(crossSiteApi.status, 403)
assert.equal(protectedCalls, 0)
const localPage = authResponse()
await authRoutes.get('/protected').handler(authRequest('127.0.0.1'), localPage)
assert.equal(localPage.status, 204)
assert.equal(protectedCalls, 1)
const loginResponse = authResponse()
await authRoutes.get('/auth/login').handler(authRequest('192.168.1.8', {
  ...domainHeaders,
  'content-type': 'application/json',
}, JSON.stringify({ password: authPassword })), loginResponse)
assert.equal(loginResponse.status, 200)
assert.match(loginResponse.headers['set-cookie'], /^dsh_lan_session=/)
const sessionCookie = loginResponse.headers['set-cookie'].split(';', 1)[0]
const authenticatedPage = authResponse()
await authRoutes.get('/protected').handler(authRequest('192.168.1.8', { ...domainHeaders, cookie: sessionCookie }), authenticatedPage)
assert.equal(authenticatedPage.status, 204)
assert.equal(protectedCalls, 2)
assert.equal(protectedHost, 'dsh-auth.invalid:3081')
await authServer.upgrades.get('/web-terminal').handler(authRequest('100.66.1.4', {
  host: '100.66.1.3:3081',
  origin: 'http://100.66.1.3:3081',
  cookie: sessionCookie,
}), {}, Buffer.alloc(0))
assert.equal(terminalHost, '100.66.1.3:3081')
const spoofedLoopbackPage = authResponse()
await authRoutes.get('/protected').handler(authRequest('192.168.1.8', { cookie: sessionCookie }), spoofedLoopbackPage)
assert.equal(spoofedLoopbackPage.status, 204)
assert.equal(protectedCalls, 3)
assert.equal(protectedHost, 'dsh-auth.invalid:3081')
const passwordResponse = authResponse()
await authRoutes.get('/auth/password').handler(authRequest('192.168.1.8', {
  ...domainHeaders,
  cookie: sessionCookie,
  'content-type': 'application/json',
}, JSON.stringify({ password: 'new correct password' })), passwordResponse)
assert.equal(passwordResponse.status, 200)
assert.equal(authPassword, 'new correct password')
const expiredPage = authResponse()
await authRoutes.get('/protected').handler(authRequest('192.168.1.8', { accept: 'text/html', cookie: sessionCookie }), expiredPage)
assert.match(expiredPage.body, /局域网登录/)

const llmCtx = new Context()
const llmFiber = await llmCtx.plugin(LlmRuntime)
const customProviderFiber = await llmCtx.plugin(CustomProviders)
assert.deepEqual(llmCtx.llm.listConfigurableProviders(), [{
  provider: 'custom-provider',
  displayName: 'Custom Provider',
  settingsNs: 'llm-pi-ai',
  settingsPath: ['providers', 'custom-provider'],
  declared: true,
}])
await customProviderFiber.dispose()
const normalizedCustomConfig = CustomProviders.Config({ providers: {
  local: {
    displayName: 'Local',
    api: 'openai-responses',
    baseURL: 'http://127.0.0.1:9999/v1',
    defaultInput: ['text', 'image'],
    models: [{ id: 'local-model' }],
  },
} })
assert.deepEqual(normalizedCustomConfig.providers.local.models[0].reasoningEfforts, {})
const configuredProviderFiber = await llmCtx.plugin(CustomProviders, normalizedCustomConfig)
assert.ok(llmCtx.llm.listConfigurableProviders().some(entry => entry.provider === 'local'))
await configuredProviderFiber.dispose()
await llmFiber.dispose()
await llmCtx.fiber.dispose()

const requests = new Map()
const requestHeaders = new Map()
const protocolServer = createServer(async (request, response) => {
  let body = ''
  for await (const chunk of request) body += chunk
  requests.set(request.url, JSON.parse(body))
  requestHeaders.set(request.url, request.headers)
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const send = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  if (request.url === '/v1/chat/completions') {
    response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'chat' }, finish_reason: null }] })}\n\n`)
    response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 1 } })}\n\n`)
    response.end('data: [DONE]\n\n')
    return
  }
  if (request.url === '/v1/responses') {
    send({ type: 'response.output_item.added', output_index: 0, sequence_number: 1, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup', arguments: '', status: 'in_progress' } })
    send({ type: 'response.function_call_arguments.delta', output_index: 0, sequence_number: 2, item_id: 'fc_1', delta: '{"q":"x"}' })
    send({ type: 'response.completed', sequence_number: 3, response: { status: 'completed', output: [], usage: { input_tokens: 3, output_tokens: 2, input_tokens_details: { cached_tokens: 1 }, output_tokens_details: { reasoning_tokens: 0 } } } })
    response.end()
    return
  }
  if (request.url === '/v1/messages') {
    send({ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: 'model', stop_reason: null, stop_sequence: null, usage: { input_tokens: 4, output_tokens: 0 } } })
    send({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } })
    send({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'think' } })
    send({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } })
    send({ type: 'content_block_stop', index: 0 })
    send({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } })
    send({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'anthropic' } })
    send({ type: 'content_block_stop', index: 1 })
    send({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } })
    send({ type: 'message_stop' })
    response.end()
    return
  }
  response.writeHead(404).end()
})
protocolServer.listen(0, '127.0.0.1')
await once(protocolServer, 'listening')
try {
  const origin = `http://127.0.0.1:${protocolServer.address().port}`
  const profiles = new Map(['openai-completions', 'openai-responses', 'anthropic-messages'].map(api => {
    const model = { id: 'model', name: 'Model', input: ['text'], contextWindow: 1024, maxTokens: 128 }
    return [api, {
      provider: api,
      displayName: api,
      api,
      baseURL: api === 'anthropic-messages' ? origin : `${origin}/v1`,
      models: [model],
      modelMap: new Map([[model.id, model]]),
      streamIdleTimeoutMs: 5000,
    }]
  }))
  const adapter = new CustomProviderAdapter({ profiles: () => profiles, resolveApiKey: async () => undefined, attachments: () => undefined })
  const call = provider => Array.fromAsync(adapter.stream({
    provider,
    model: 'model',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    tools: [{ name: 'lookup', description: 'Lookup', parameters: { type: 'object' } }],
  }))
  const chatChunks = await call('openai-completions')
  assert.equal(chatChunks.find(chunk => chunk.type === 'block-end').block.text, 'chat')
  assert.equal(chatChunks.at(-1).reason.kind, 'stop')
  const responseChunks = await call('openai-responses')
  assert.deepEqual(responseChunks.find(chunk => chunk.type === 'block-end').block, { type: 'tool-call', id: 'call_1', name: 'lookup', arguments: '{"q":"x"}' })
  assert.equal(responseChunks.at(-1).reason.kind, 'tool-calls')
  const anthropicChunks = await call('anthropic-messages')
  assert.deepEqual(anthropicChunks.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block.type), ['reasoning', 'text'])
  assert.equal(anthropicChunks.at(-1).replayState.reasoning[0].signature, 'sig')
  assert.deepEqual([...requests.keys()].sort(), ['/v1/chat/completions', '/v1/messages', '/v1/responses'])
  assert.equal(requests.get('/v1/chat/completions').tools[0].function.name, 'lookup')
  assert.equal(requests.get('/v1/responses').tools[0].name, 'lookup')
  assert.equal(requests.get('/v1/messages').tools[0].name, 'lookup')
  for (const headers of requestHeaders.values()) {
    assert.equal(headers.authorization, undefined)
    assert.equal(headers['x-api-key'], undefined)
    assert.equal(headers['openai-organization'], undefined)
    assert.equal(headers['openai-project'], undefined)
  }
} finally {
  protocolServer.closeAllConnections()
  protocolServer.close()
  await once(protocolServer, 'close')
}

const ctx = new Context()
const fiber = await ctx.plugin(LocalSubprocessRuntime)
const spec = (argv, overrides = {}) => ({
  argv,
  cwd: process.cwd(),
  stdio: {
    stdin: 'ignore',
    stdout: { maxBytes: 4, spill: { maxBytes: 1024 } },
    stderr: { maxBytes: 1024 },
  },
  graceMs: 50,
  ...overrides,
})

assert.equal(await ctx.subprocess.resolveExecutable(process.execPath), process.execPath)
await assert.rejects(ctx.subprocess.resolveExecutable('./node'), /relative path/)

const terminal = await ctx.subprocess.spawnTerminal({
  argv: [process.execPath, '-e', "process.stdout.write('pty-ready')"],
  cwd: process.cwd(),
  rows: 24,
  cols: 80,
  graceMs: 50,
})
let terminalOutput = ''
terminal.output.on('data', chunk => { terminalOutput += chunk.toString() })
const terminalEnded = once(terminal.output, 'end')
assert.deepEqual(await terminal.done, { exitCode: 0, signal: null })
await terminalEnded
assert.match(terminalOutput, /pty-ready/)
await terminal.terminate()

const captured = ctx.subprocess.spawn(spec([process.execPath, '-e', "process.stdout.write('abcdef')"]))
assert.deepEqual(await captured.done, { exitCode: 0, signal: null })
const output = captured.collected.stdout.readFrom(0)
assert.equal(output.text, 'cdef')
assert.equal(output.lossy, true)
assert.equal(await readFile(output.spillPath, 'utf8'), 'abcdef')
await unlink(output.spillPath)

const controller = new AbortController()
const tree = ctx.subprocess.spawn(spec([
  process.execPath,
  '-e',
  "process.on('SIGTERM',()=>{});const{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"],{stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000)",
], {
  signal: controller.signal,
  stdio: { stdin: 'ignore', stdout: { maxBytes: 100 }, stderr: { maxBytes: 1024 } },
}))
for (let attempt = 0; attempt < 100 && tree.collected.stdout.readFrom(0).text.trim() === ''; attempt += 1) await sleep(10)
assert.match(tree.collected.stdout.readFrom(0).text.trim(), /^\d+$/)
controller.abort('check cancellation')
const treeOutcome = await tree.done
assert.ok(treeOutcome.signal !== null || treeOutcome.exitCode !== 0)
assert.equal(await tree.waitForExit(), true)

if (process.platform !== 'win32') {
  const { default: LocalBashExecutor } = await import('@deepseek-ai/dsh-bash-local')
  const shellFiber = await ctx.plugin(LocalBashExecutor, { timeoutMs: 50, maxTimeoutMs: 500, graceMs: 50 })
  const foreground = await ctx.shell.run(ctx.shell.resolve({ command: 'printf web-only' }))
  assert.equal(foreground.stdout.text, 'web-only')
  assert.equal(foreground.exitCode, 0)
  const timed = await ctx.shell.run(ctx.shell.resolve({ command: 'sleep 10' }))
  assert.equal(timed.timedOut, true)
  const background = ctx.shell.start(ctx.shell.resolve({ command: 'printf ready; sleep 10' }))
  let backgroundOutput = ''
  for (let attempt = 0; attempt < 100 && !backgroundOutput.includes('ready'); attempt += 1) {
    backgroundOutput += background.readOutput().delta
    await sleep(10)
  }
  assert.match(backgroundOutput, /ready/)
  assert.equal(background.kill(), true)
  await background.done
  assert.equal(background.status, 'killed')
  await shellFiber.dispose()
}

const managed = ctx.subprocess.spawn(spec([
  process.execPath,
  '-e',
  "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)",
]))
await fiber.dispose()
const managedOutcome = await managed.done
assert.ok(managedOutcome.signal !== null || managedOutcome.exitCode !== 0)
assert.equal(await managed.waitForExit(), true)

console.log('Web roster, LAN auth, custom LLM protocols, profile layers, minimal preset, and PTY subprocess lifecycle verified')
