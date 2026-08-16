import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import {
  apply,
  loadProjectMcpConfig,
  toMcpClientConfig,
  type Config,
} from '../src/index.ts'

const sharedConfig = {
  toolCallTimeoutMs: 12_345,
  failOnStartupError: true,
  reconnect: false,
} as const

test('loads Claude Code stdio and HTTP server syntax', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-project-mcp-'))
  try {
    await writeFile(join(root, '.mcp.json'), JSON.stringify({
      mcpServers: {
        local: {
          command: 'node',
          args: ['server.mjs'],
          env: { TOKEN: 'project-token' },
          cwd: 'services/api',
        },
        remote: {
          type: 'http',
          url: 'https://example.test/mcp',
          directTools: true,
          headers: { Authorization: 'Bearer value' },
        },
      },
    }))

    const loaded = await loadProjectMcpConfig(root, '.mcp.json', true)
    assert.deepEqual(Object.keys(loaded.document!.mcpServers), ['local', 'remote'])

    const local = toMcpClientConfig('local', loaded.document!.mcpServers.local!, root, sharedConfig)
    assert.deepEqual(local, {
      transport: 'stdio',
      serverName: 'local',
      command: 'node',
      args: ['server.mjs'],
      env: { TOKEN: 'project-token' },
      cwd: join(root, 'services/api'),
      toolCallTimeoutMs: 12_345,
      failOnStartupError: true,
      reconnect: { enabled: false },
    })

    const remote = toMcpClientConfig('remote', loaded.document!.mcpServers.remote!, root, sharedConfig)
    assert.deepEqual(remote, {
      transport: 'streamable-http',
      serverName: 'remote',
      url: 'https://example.test/mcp',
      headers: { Authorization: 'Bearer value' },
      toolCallTimeoutMs: 12_345,
      failOnStartupError: true,
      reconnect: { enabled: false },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('defaults stdio cwd to the project root', () => {
  const mapped = toMcpClientConfig('filesystem', {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
  }, '/workspace/demo', sharedConfig)

  assert.equal(mapped.transport, 'stdio')
  assert.equal(mapped.cwd, '/workspace/demo')
})

test('missing .mcp.json is optional unless requireConfig is enabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-project-mcp-'))
  try {
    const optional = await loadProjectMcpConfig(root, '.mcp.json', false)
    assert.equal(optional.document, undefined)
    await assert.rejects(
      loadProjectMcpConfig(root, '.mcp.json', true),
      /cannot read/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects invalid and unsupported Claude Code entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-project-mcp-'))
  try {
    await writeFile(join(root, '.mcp.json'), JSON.stringify({
      mcpServers: {
        'bad name': { command: 'node' },
      },
    }))
    await assert.rejects(loadProjectMcpConfig(root, '.mcp.json', true), /must match/)

    await writeFile(join(root, '.mcp.json'), JSON.stringify({
      mcpServers: {
        mixed: { command: 'node', url: 'https://example.test/mcp' },
      },
    }))
    await assert.rejects(loadProjectMcpConfig(root, '.mcp.json', true), /exactly one/)

    await writeFile(join(root, '.mcp.json'), JSON.stringify({
      mcpServers: {
        websocket: { type: 'ws', url: 'https://example.test/mcp' },
      },
    }))
    await assert.rejects(loadProjectMcpConfig(root, '.mcp.json', true), /must be "http" or "sse"/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('loads the same MCP namespace in multiple agent scopes and releases each independently', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsh-project-mcp-project-'))
  const host = await mkdtemp(join(tmpdir(), 'dsh-project-mcp-host-'))
  const ctx = new Context()
  try {
    await writeFile(join(project, '.mcp.json'), JSON.stringify({
      mcpServers: {
        fixture: {
          command: process.execPath,
          args: [join(import.meta.dirname, 'fixture-server.mjs')],
        },
      },
    }))
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const config: Config = {
      projectRoot: '',
      configPath: '.mcp.json',
      requireConfig: false,
      toolCallTimeoutMs: 5_000,
      failOnStartupError: true,
      reconnect: false,
    }
    const fiber = await ctx.plugin({ name: 'project-mcp-agent-cwd', inject: ['agents', 'tools'], apply }, config)
    const tools = ctx.get('tools')
    const agents = ctx.get('agents')
    const sessions = ctx.get('sessions')
    if (tools === undefined || agents === undefined || sessions === undefined) throw new Error('test services did not mount')

    const first = createStubAgent(ctx, sessions, project, 'agent-project-one')
    const second = createStubAgent(ctx, sessions, project, 'agent-project-two')
    const disposeFirst = agents.register(first.agent)
    const disposeSecond = agents.register(second.agent)

    await waitFor(() => tools.get('mcp__fixture__fixture_ping', first.key) !== undefined)
    await waitFor(() => tools.get('mcp__fixture__fixture_ping', second.key) !== undefined)
    assert.equal(tools.get('mcp__fixture__fixture_ping'), undefined)
    assert.notEqual(tools.get('mcp__fixture__fixture_ping', first.key), undefined)
    assert.notEqual(tools.get('mcp__fixture__fixture_ping', second.key), undefined)

    disposeFirst()
    await first.scope.dispose()
    await waitFor(() => tools.get('mcp__fixture__fixture_ping', first.key) === undefined)
    assert.notEqual(tools.get('mcp__fixture__fixture_ping', second.key), undefined)

    disposeSecond()
    await second.scope.dispose()
    await waitFor(() => tools.get('mcp__fixture__fixture_ping', second.key) === undefined)
    await fiber.dispose()
  } finally {
    await ctx.fiber.dispose()
    await rm(project, { recursive: true, force: true })
    await rm(host, { recursive: true, force: true })
  }
})

function createStubAgent(
  ctx: Context,
  sessions: InstanceType<typeof SessionStore>,
  project: string,
  id: string,
): { agent: Agent; key: object; scope: ReturnType<typeof createScope> } {
  const session = sessions.create(SessionId(id), { meta: { cwd: project } })
  const key = {}
  const scope = createScope(ctx, key)
  const base = stubAgent(scope.ctx, session)
  const agentCtx = scope.ctx.extend({ agent: base })
  return { agent: { ...base, ctx: agentCtx }, key, scope }
}

function stubAgent(agentCtx: Context, session: ReturnType<InstanceType<typeof SessionStore>['create']>): Agent {
  return {
    id: session.id,
    options: {},
    session,
    inbox: {} as Agent['inbox'],
    status: 'idle',
    ctx: agentCtx,
    cancel() {},
    whenIdle: async () => {},
    runMaintenance: async task => await task(new AbortController().signal),
    send() {},
    followup() {},
    steer() {},
    inject() {},
  }
}

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
