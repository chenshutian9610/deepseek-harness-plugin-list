import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply, loadProjectMcpConfig, toMcpClientConfig } from '../lib/index.js'
import * as McpClient from '../lib/mcp-client/index.js'

const sharedConfig = {
  toolCallTimeoutMs: 12_345,
  failOnStartupError: true,
  reconnect: false,
}

const root = await mkdtemp(join(tmpdir(), 'dsh-project-mcp-config-'))
try {
  await writeFile(join(root, '.mcp.json'), JSON.stringify({
    mcpServers: {
      local: { command: 'node', args: ['server.mjs'], cwd: 'services/api' },
      remote: { type: 'http', url: 'https://example.test/mcp', directTools: true },
    },
  }))
  const loaded = await loadProjectMcpConfig(root, '.mcp.json', true)
  assert.deepEqual(Object.keys(loaded.document.mcpServers), ['local', 'remote'])
  assert.deepEqual(toMcpClientConfig('local', loaded.document.mcpServers.local, root, sharedConfig), {
    transport: 'stdio',
    serverName: 'local',
    command: 'node',
    args: ['server.mjs'],
    env: {},
    cwd: join(root, 'services/api'),
    toolCallTimeoutMs: 12_345,
    failOnStartupError: true,
    reconnect: { enabled: false },
  })
  assert.deepEqual(toMcpClientConfig('remote', loaded.document.mcpServers.remote, root, sharedConfig), {
    transport: 'streamable-http',
    serverName: 'remote',
    url: 'https://example.test/mcp',
    headers: {},
    toolCallTimeoutMs: 12_345,
    failOnStartupError: true,
    reconnect: { enabled: false },
  })
} finally {
  await rm(root, { recursive: true, force: true })
}

const project = await mkdtemp(join(tmpdir(), 'dsh-project-mcp-project-'))
const fixtureServer = fileURLToPath(new URL('./fixture-server.mjs', import.meta.url))
const fixtureConfig = {
  serverName: 'fixture',
  transport: 'stdio',
  command: process.execPath,
  args: [fixtureServer],
  reconnect: { enabled: false },
}
const ctx = new Context()
try {
  await writeFile(join(project, '.mcp.json'), JSON.stringify({
    mcpServers: {
      fixture: {
        command: process.execPath,
        args: [fixtureServer],
      },
    },
  }))
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fiber = await ctx.plugin({ name: 'project-mcp-test', inject: ['agents', 'tools'], apply }, {
    projectRoot: '',
    configPath: '.mcp.json',
    requireConfig: false,
    toolCallTimeoutMs: 5_000,
    failOnStartupError: true,
    reconnect: false,
  })
  const tools = ctx.tools
  const agents = ctx.agents
  const sessions = ctx.sessions
  if (tools === undefined || agents === undefined || sessions === undefined) throw new Error('test services did not mount')

  const first = createStubAgent(ctx, sessions, project, 'agent-project-one')
  const second = createStubAgent(ctx, sessions, project, 'agent-project-two')
  const disposeFirst = agents.register(first.agent)
  const disposeSecond = agents.register(second.agent)

  await waitFor(() => tools.get('mcp__fixture__fixture_ping', first.key) !== undefined)
  await waitFor(() => tools.get('mcp__fixture__fixture_ping', second.key) !== undefined)
  assert.equal(tools.get('mcp__fixture__fixture_ping'), undefined)

  const duplicate = second.agent.ctx.plugin(McpClient, fixtureConfig)
  await assert.rejects(Promise.resolve(duplicate), /already in use/)
  await duplicate.dispose()

  disposeFirst()
  await first.scope.dispose()
  await waitFor(() => tools.get('mcp__fixture__fixture_ping', first.key) === undefined)
  assert.notEqual(tools.get('mcp__fixture__fixture_ping', second.key), undefined)

  await fiber.dispose()
  await waitFor(() => tools.get('mcp__fixture__fixture_ping', second.key) === undefined)

  const remounted = second.agent.ctx.plugin(McpClient, fixtureConfig)
  await remounted
  await waitFor(() => tools.get('mcp__fixture__fixture_ping', second.key) !== undefined)
  await remounted.dispose()
  await waitFor(() => tools.get('mcp__fixture__fixture_ping', second.key) === undefined)

  disposeSecond()
  await second.scope.dispose()
} finally {
  await ctx.fiber.dispose()
  await rm(project, { recursive: true, force: true })
}

function createStubAgent(ctx, sessions, project, id) {
  const session = sessions.create(SessionId(id), { meta: { cwd: project } })
  const key = {}
  const scope = createScope(ctx, key)
  const base = {
    id: session.id,
    options: {},
    session,
    inbox: {},
    status: 'idle',
    ctx: scope.ctx,
    cancel() {},
    whenIdle: async () => {},
    runMaintenance: async task => await task(new AbortController().signal),
    send() {},
    followup() {},
    steer() {},
    inject() {},
  }
  const agentCtx = scope.ctx.extend({ agent: base })
  return { agent: { ...base, ctx: agentCtx }, key, scope }
}

async function waitFor(check, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
