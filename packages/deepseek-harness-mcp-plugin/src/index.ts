import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import Schema from '@deepseek-ai/schemastery'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'project-mcp'

/** Services required by this plugin and its agent-scoped MCP clients. */
export const inject = ['agents', 'tools']

/** Plugin configuration. */
export interface Config {
  /** Project root containing the Claude Code MCP file. */
  projectRoot: string
  /** File name or absolute path of the Claude Code MCP configuration. */
  configPath: string
  /** Whether absence of the project MCP file is an activation error. */
  requireConfig: boolean
  /** Per-tool-call timeout passed to every child MCP client. */
  toolCallTimeoutMs: number
  /** Whether a server startup failure rejects this plugin. */
  failOnStartupError: boolean
  /** Whether child MCP clients reconnect after transport loss. */
  reconnect: boolean
}

/** Schemastery validation and defaults for plugin configuration. */
export const Config: Schema<Config> = Schema.object({
  projectRoot: Schema.string().default(''),
  configPath: Schema.string().default('.mcp.json'),
  requireConfig: Schema.boolean().default(false),
  toolCallTimeoutMs: Schema.number().min(1).default(60_000),
  failOnStartupError: Schema.boolean().default(false),
  reconnect: Schema.boolean().default(true),
})

interface ClaudeServerOptions {
  /** Claude Code hint requesting direct tool exposure; Harness tools are direct by default. */
  directTools?: boolean
}

/** Claude Code stdio MCP server entry. */
export interface ClaudeStdioServer extends ClaudeServerOptions {
  type?: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

/** Claude Code HTTP or SSE MCP server entry. */
export interface ClaudeHttpServer extends ClaudeServerOptions {
  type?: 'http' | 'sse'
  url: string
  headers?: Record<string, string>
}

/** Supported Claude Code MCP server entry. */
export type ClaudeMcpServer = ClaudeStdioServer | ClaudeHttpServer

/** Project-level Claude Code MCP document. */
export interface ClaudeMcpDocument {
  mcpServers: Record<string, ClaudeMcpServer>
}

interface LoadedProjectConfig {
  path: string
  document?: ClaudeMcpDocument
}

const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/**
 * Load and validate a Claude Code `.mcp.json` document.
 * @param projectRoot - Absolute or relative project root.
 * @param configPath - File name under the project root, or an absolute path.
 * @param requireConfig - Whether a missing file is an error.
 * @returns Resolved path and parsed document when present.
 */
export async function loadProjectMcpConfig(
  projectRoot: string,
  configPath: string,
  requireConfig: boolean,
): Promise<LoadedProjectConfig> {
  const root = resolve(projectRoot || process.cwd())
  const path = isAbsolute(configPath) ? configPath : join(root, configPath)

  let source: string
  try {
    source = await readFile(path, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT' && !requireConfig) return { path }
    throw new Error(`project-mcp: cannot read ${path}`, { cause: error })
  }

  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    throw new Error(`project-mcp: ${path} is not valid JSON`, { cause: error })
  }

  return { path, document: parseDocument(value, path) }
}

/**
 * Convert one Claude Code MCP entry into the Harness MCP client configuration.
 * @param serverName - Key from `mcpServers` and public tool namespace.
 * @param server - Validated Claude Code server entry.
 * @param projectRoot - Resolved project root used for default and relative cwd values.
 * @param config - Shared plugin policy passed to every child.
 * @returns Configuration accepted by `@deepseek-ai/dsh-mcp-client`.
 */
export function toMcpClientConfig(
  serverName: string,
  server: ClaudeMcpServer,
  projectRoot: string,
  config: Pick<Config, 'toolCallTimeoutMs' | 'failOnStartupError' | 'reconnect'>,
): McpClientConfig {
  const common = {
    serverName,
    toolCallTimeoutMs: config.toolCallTimeoutMs,
    failOnStartupError: config.failOnStartupError,
    reconnect: { enabled: config.reconnect },
  }

  if ('command' in server) {
    const cwd = server.cwd === undefined
      ? projectRoot
      : isAbsolute(server.cwd) ? server.cwd : resolve(projectRoot, server.cwd)
    return {
      ...common,
      transport: 'stdio',
      command: server.command,
      args: server.args ?? [],
      env: server.env ?? {},
      cwd,
    }
  }

  return {
    ...common,
    transport: 'streamable-http',
    url: server.url,
    headers: server.headers ?? {},
  }
}

/**
 * Install project-sensitive MCP loading for every live agent. Each agent reads
 * `.mcp.json` from its immutable session cwd and owns scoped MCP tool
 * registrations, so Web sessions may use different projects without restarting
 * the Host.
 * @param ctx - Cordis context carrying the agent registry and tool runtime.
 * @param config - Resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const mounted = new Map<Agent, Promise<void>>()
  let stopping = false

  const mount = (agent: Agent): void => {
    if (stopping || mounted.has(agent)) return
    const run = mountAgentMcp(agent, config).catch((error: unknown) => {
      ctx.logger.error(`project-mcp: agent "${agent.id}" failed to load project MCP configuration: ${renderError(error)}`)
      throw error
    })
    mounted.set(agent, run)
    void run.catch(() => {})
  }

  ctx.effect(() => {
    const stopCreated = ctx.on('agent/created', ({ agent }) => { mount(agent) })
    for (const agent of ctx.agents.list()) mount(agent)

    return async () => {
      stopping = true
      stopCreated()
      const pending = [...mounted.values()]
      mounted.clear()
      await Promise.allSettled(pending)
    }
  }, 'project-mcp.lifecycle()')
}

async function mountAgentMcp(agent: Agent, config: Config): Promise<void> {
  const sessionCwd = agent.session.header.cwd
  const projectRoot = resolve(config.projectRoot || sessionCwd || process.cwd())
  const loaded = await loadProjectMcpConfig(projectRoot, config.configPath, config.requireConfig)
  if (loaded.document === undefined) {
    agent.ctx.logger.debug(`project-mcp: no ${loaded.path}; no MCP servers loaded for agent "${agent.id}"`)
    return
  }

  const entries = Object.entries(loaded.document.mcpServers)
  const fibers: Fiber[] = []
  try {
    for (const [serverName, server] of entries) {
      const childConfig = toMcpClientConfig(serverName, server, projectRoot, config)
      fibers.push(agent.ctx.plugin(McpClient, childConfig))
    }
    await Promise.all(fibers)
  } catch (error) {
    await Promise.allSettled(fibers.map(async fiber => fiber.dispose()))
    throw error
  }

  agent.ctx.logger.info(`project-mcp: loaded ${entries.length} MCP server(s) for agent "${agent.id}" from ${loaded.path}`)
}

function parseDocument(value: unknown, path: string): ClaudeMcpDocument {
  const root = expectRecord(value, `${path}`)
  const servers = expectRecord(root.mcpServers, `${path}.mcpServers`)
  const mcpServers: Record<string, ClaudeMcpServer> = {}

  for (const [serverName, rawServer] of Object.entries(servers)) {
    if (!SERVER_NAME_PATTERN.test(serverName)) {
      throw new Error(`project-mcp: ${path}.mcpServers key "${serverName}" must match [A-Za-z0-9_-]{1,32}`)
    }
    mcpServers[serverName] = parseServer(rawServer, `${path}.mcpServers.${serverName}`)
  }

  return { mcpServers }
}

function parseServer(value: unknown, path: string): ClaudeMcpServer {
  const server = expectRecord(value, path)
  const type = optionalString(server.type, `${path}.type`)
  const hasCommand = server.command !== undefined
  const hasUrl = server.url !== undefined

  if (hasCommand === hasUrl) {
    throw new Error(`project-mcp: ${path} must define exactly one of command or url`)
  }

  if (hasCommand) {
    if (type !== undefined && type !== 'stdio') {
      throw new Error(`project-mcp: ${path}.type must be "stdio" when command is used`)
    }
    optionalBoolean(server.directTools, `${path}.directTools`)
    rejectUnknownKeys(server, path, ['type', 'command', 'args', 'env', 'cwd', 'directTools'])
    return {
      ...(type === undefined ? {} : { type: 'stdio' as const }),
      command: requiredString(server.command, `${path}.command`),
      ...(server.args === undefined ? {} : { args: stringArray(server.args, `${path}.args`) }),
      ...(server.env === undefined ? {} : { env: stringRecord(server.env, `${path}.env`) }),
      ...(server.cwd === undefined ? {} : { cwd: requiredString(server.cwd, `${path}.cwd`) }),
    }
  }

  if (type !== undefined && type !== 'http' && type !== 'sse') {
    throw new Error(`project-mcp: ${path}.type must be "http" or "sse" when url is used`)
  }
  optionalBoolean(server.directTools, `${path}.directTools`)
  rejectUnknownKeys(server, path, ['type', 'url', 'headers', 'directTools'])
  const url = requiredString(server.url, `${path}.url`)
  try {
    new URL(url)
  } catch (error) {
    throw new Error(`project-mcp: ${path}.url must be an absolute URL`, { cause: error })
  }
  return {
    ...(type === undefined ? {} : { type }),
    url,
    ...(server.headers === undefined ? {} : { headers: stringRecord(server.headers, `${path}.headers`) }),
  }
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`project-mcp: ${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`project-mcp: ${path} must be a non-empty string`)
  }
  return value
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`project-mcp: ${path} must be a string`)
  return value
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`project-mcp: ${path} must be a boolean`)
  return value
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`project-mcp: ${path} must be an array of strings`)
  }
  return value
}

function stringRecord(value: unknown, path: string): Record<string, string> {
  const record = expectRecord(value, path)
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== 'string') throw new Error(`project-mcp: ${path}.${key} must be a string`)
  }
  return record as Record<string, string>
}

function rejectUnknownKeys(record: Record<string, unknown>, path: string, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed)
  const unknown = Object.keys(record).find(key => !allowedKeys.has(key))
  if (unknown !== undefined) throw new Error(`project-mcp: ${path}.${unknown} is not supported`)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
