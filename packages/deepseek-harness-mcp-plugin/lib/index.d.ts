import type { Context } from '@deepseek-ai/cordis';
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client';
import Schema from '@deepseek-ai/schemastery';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "project-mcp";
/** Services required by this plugin and its agent-scoped MCP clients. */
export declare const inject: string[];
/** Plugin configuration. */
export interface Config {
    /** Project root containing the Claude Code MCP file. */
    projectRoot: string;
    /** File name or absolute path of the Claude Code MCP configuration. */
    configPath: string;
    /** Whether absence of the project MCP file is an activation error. */
    requireConfig: boolean;
    /** Per-tool-call timeout passed to every child MCP client. */
    toolCallTimeoutMs: number;
    /** Whether a server startup failure rejects this plugin. */
    failOnStartupError: boolean;
    /** Whether child MCP clients reconnect after transport loss. */
    reconnect: boolean;
}
/** Schemastery validation and defaults for plugin configuration. */
export declare const Config: Schema<Config>;
interface ClaudeServerOptions {
    /** Claude Code hint requesting direct tool exposure; Harness tools are direct by default. */
    directTools?: boolean;
}
/** Claude Code stdio MCP server entry. */
export interface ClaudeStdioServer extends ClaudeServerOptions {
    type?: 'stdio';
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
}
/** Claude Code HTTP or SSE MCP server entry. */
export interface ClaudeHttpServer extends ClaudeServerOptions {
    type?: 'http' | 'sse';
    url: string;
    headers?: Record<string, string>;
}
/** Supported Claude Code MCP server entry. */
export type ClaudeMcpServer = ClaudeStdioServer | ClaudeHttpServer;
/** Project-level Claude Code MCP document. */
export interface ClaudeMcpDocument {
    mcpServers: Record<string, ClaudeMcpServer>;
}
interface LoadedProjectConfig {
    path: string;
    document?: ClaudeMcpDocument;
}
/**
 * Load and validate a Claude Code `.mcp.json` document.
 * @param projectRoot - Absolute or relative project root.
 * @param configPath - File name under the project root, or an absolute path.
 * @param requireConfig - Whether a missing file is an error.
 * @returns Resolved path and parsed document when present.
 */
export declare function loadProjectMcpConfig(projectRoot: string, configPath: string, requireConfig: boolean): Promise<LoadedProjectConfig>;
/**
 * Convert one Claude Code MCP entry into the Harness MCP client configuration.
 * @param serverName - Key from `mcpServers` and public tool namespace.
 * @param server - Validated Claude Code server entry.
 * @param projectRoot - Resolved project root used for default and relative cwd values.
 * @param config - Shared plugin policy passed to every child.
 * @returns Configuration accepted by `@deepseek-ai/dsh-mcp-client`.
 */
export declare function toMcpClientConfig(serverName: string, server: ClaudeMcpServer, projectRoot: string, config: Pick<Config, 'toolCallTimeoutMs' | 'failOnStartupError' | 'reconnect'>): McpClientConfig;
/**
 * Install project-sensitive MCP loading for every live agent. Each agent reads
 * `.mcp.json` from its immutable session cwd and owns scoped MCP tool
 * registrations, so Web sessions may use different projects without restarting
 * the Host.
 * @param ctx - Cordis context carrying the agent registry and tool runtime.
 * @param config - Resolved plugin configuration.
 */
export declare function apply(ctx: Context, config: Config): void;
export {};
