/** Host half of the dsh-web terminal plugin. */
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-subprocess'
import WebSocket, { WebSocketServer } from 'ws'
import type { RawData } from 'ws'
import {
  isTrustedTerminalUpgrade,
  parseTerminalInput,
  parseTerminalOpenRequest,
  TERMINAL_SOCKET_PATH,
} from './host/protocol.ts'

/** Cordis plugin name. */
export const name = 'web-terminal'
/** Host services required to allocate a policy-confined PTY and expose it to dsh-web. */
export const inject = ['agents', 'sandboxPolicy', 'subprocess', 'webServer']

/** Deployment settings for the browser terminal. */
export interface Config {
  /** Interactive shell executable. */
  shellPath?: string
  /** Arguments passed to the shell executable. */
  shellArgs?: string[]
  /** TERM-to-KILL grace used by the subprocess provider. */
  disposeGraceMs?: number
  /** Largest accepted terminal width. */
  maxCols?: number
  /** Largest accepted terminal height. */
  maxRows?: number
  /** Largest UTF-8 input message accepted from the browser. */
  maxInputBytes?: number
  /** Maximum queued WebSocket output before a slow client is disconnected. */
  maxSocketBufferBytes?: number
}

/** Schemastery configuration exposed to cordis.yml. */
export const Config: Schema<Config> = Schema.object({
  shellPath: Schema.string().default('/bin/bash'),
  shellArgs: Schema.array(Schema.string()).default(['--noprofile', '--norc', '-i']),
  disposeGraceMs: Schema.number().step(1).min(1).default(3_000),
  maxCols: Schema.number().step(1).min(2).default(400),
  maxRows: Schema.number().step(1).min(1).default(200),
  maxInputBytes: Schema.number().step(1).min(1).default(64 * 1024),
  maxSocketBufferBytes: Schema.number().step(1).min(1).default(1024 * 1024),
})

type ResolvedConfig = Required<Config>

function resolveConfig(config: Config): ResolvedConfig {
  const resolved = config as ResolvedConfig
  if (resolved.shellPath.length === 0) throw new Error('web-terminal: shellPath must be non-empty')
  return resolved
}

function rejectUpgrade(socket: Duplex, status: 400 | 403 | 503, body: string): void {
  const reason = status === 400 ? 'Bad Request' : status === 403 ? 'Forbidden' : 'Service Unavailable'
  socket.end([
    `HTTP/1.1 ${status} ${reason}`,
    'Connection: close',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(body)}`,
    '',
    body,
  ].join('\r\n'))
}

function socketClosed(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve()
  return new Promise(resolve => {
    socket.once('close', resolve)
    socket.once('error', resolve)
  })
}

/** Owns accepted browser sockets and their one-to-one PTY handles. */
class TerminalSocketHub {
  private readonly server = new WebSocketServer({ noServer: true })
  private readonly tasks = new Set<Promise<void>>()
  private accepting = true

  constructor(private readonly ctx: Context, private readonly config: ResolvedConfig) {}

  /** Validate and upgrade one browser connection. */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!this.accepting) {
      rejectUpgrade(socket, 503, 'disposing')
      return
    }
    const remoteAddress = (socket as Duplex & { remoteAddress?: string }).remoteAddress
    if (!isTrustedTerminalUpgrade(req.headers, remoteAddress)) {
      rejectUpgrade(socket, 403, 'forbidden')
      return
    }
    let request
    try {
      request = parseTerminalOpenRequest(req.url, this.config.maxCols, this.config.maxRows)
    } catch (error) {
      rejectUpgrade(socket, 400, error instanceof Error ? error.message : 'invalid request')
      return
    }
    this.server.handleUpgrade(req, socket, head, (websocket) => {
      const task = this.serve(websocket, request).catch((error: unknown) => {
        this.send(websocket, { type: 'error', message: String(error) })
        websocket.close(1011, 'terminal failed')
        this.ctx.logger.error(error)
      })
      this.tasks.add(task)
      void task.then(() => { this.tasks.delete(task) })
    })
  }

  /** Stop admission, terminate every socket, and await PTY quiescence. */
  async dispose(): Promise<void> {
    this.accepting = false
    for (const socket of this.server.clients) socket.terminate()
    await Promise.all(this.tasks)
    await new Promise<void>((resolve, reject) => {
      this.server.close(error => { error === undefined ? resolve() : reject(error) })
    })
  }

  private send(socket: WebSocket, message: object): boolean {
    if (socket.readyState !== WebSocket.OPEN) return false
    const body = JSON.stringify(message)
    if (socket.bufferedAmount + Buffer.byteLength(body) > this.config.maxSocketBufferBytes) {
      socket.close(1013, 'terminal client is too slow')
      return false
    }
    socket.send(body, (error) => { if (error) socket.terminate() })
    return true
  }

  private shellArgv(agent: Agent): { argv: string[]; cwd: string } {
    const policy = this.ctx.sandboxPolicy.resolve({ session: agent.session })
    const argv = [this.config.shellPath, ...this.config.shellArgs]
    if (policy.mode === 'danger-full-access') return { argv, cwd: policy.workspaceRoot }
    const sandbox = this.ctx.get('sandbox')
    if (sandbox === undefined) {
      throw new Error(`web-terminal: sandbox mode "${policy.mode}" requires a ctx.sandbox provider`)
    }
    return { argv: sandbox.confine(argv, { ...policy, mode: policy.mode }).argv, cwd: policy.workspaceRoot }
  }

  private ownerFence(agent: Agent, socket: WebSocket): () => Promise<void> | void {
    const openedMode = this.ctx.sandboxPolicy.resolve({ session: agent.session }).mode
    const offDispatch = agent.ctx.on('internal/dispatch', (_mode, eventName, args) => {
      if (eventName !== 'session/event') return
      const [session, event] = args as [Session, SessionEvent]
      if (session !== agent.session || event.type !== 'sandbox/mode' || event.data.mode === openedMode) return
      throw new Error('cannot change sandbox mode while the Web terminal is open; close it first')
    }, { global: true })
    const detach = agent.ctx.effect(() => () => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1001, 'session ended')
      }
    }, 'web-terminal: Agent owner')
    return () => {
      offDispatch()
      return detach()
    }
  }

  private async serve(socket: WebSocket, request: { sessionId: string; cols: number; rows: number }): Promise<void> {
    const agent = this.ctx.agents.get(request.sessionId as SessionId)
    if (agent === undefined) {
      this.send(socket, { type: 'error', message: '当前 Session 不在线' })
      socket.close(1008, 'session not live')
      return
    }

    const detachOwner = this.ownerFence(agent, socket)
    let terminal: SubprocessTerminalHandle | undefined
    let writeTail = Promise.resolve()
    try {
      const { argv, cwd } = this.shellArgv(agent)
      const handle = await this.ctx.subprocess.spawnTerminal({
        argv,
        cwd,
        env: {
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          DSH_SHELL: '1',
          DSH_SESSION_ID: agent.id,
        },
        rows: request.rows,
        cols: request.cols,
        graceMs: this.config.disposeGraceMs,
      })
      terminal = handle
      if (socket.readyState !== WebSocket.OPEN) return

      const decoder = new TextDecoder()
      const onData = (chunk: Buffer | Uint8Array | string): void => {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
        const data = decoder.decode(bytes, { stream: true })
        if (data.length > 0) this.send(socket, { type: 'output', data })
      }
      const onEnd = (): void => {
        const data = decoder.decode()
        if (data.length > 0) this.send(socket, { type: 'output', data })
      }
      const onOutputError = (error: Error): void => {
        this.send(socket, { type: 'error', message: error.message })
        socket.close(1011, 'terminal output failed')
      }
      const onMessage = (raw: RawData, isBinary: boolean): void => {
        try {
          if (isBinary) throw new Error('binary terminal input is not supported')
          const message = parseTerminalInput(raw.toString(), this.config.maxInputBytes)
          writeTail = writeTail.then(() => handle.write(message.data))
          void writeTail.catch((error: unknown) => {
            this.send(socket, { type: 'error', message: String(error) })
            socket.close(1011, 'terminal input failed')
          })
        } catch (error) {
          this.send(socket, { type: 'error', message: error instanceof Error ? error.message : 'invalid input' })
          socket.close(1008, 'invalid terminal input')
        }
      }

      handle.output.on('data', onData)
      handle.output.once('end', onEnd)
      handle.output.once('error', onOutputError)
      socket.on('message', onMessage)
      this.send(socket, { type: 'ready', pid: handle.pid })

      void handle.done.then(
        outcome => {
          this.send(socket, { type: 'exit', exitCode: outcome.exitCode, signal: outcome.signal })
          socket.close(1000, 'terminal exited')
        },
        (error: unknown) => {
          this.send(socket, { type: 'error', message: String(error) })
          socket.close(1011, 'terminal transport failed')
        },
      )
      await socketClosed(socket)

      socket.off('message', onMessage)
      handle.output.off('data', onData)
      handle.output.off('end', onEnd)
      handle.output.off('error', onOutputError)
    } finally {
      await detachOwner()
      if (terminal !== undefined) {
        const results = await Promise.allSettled([terminal.terminate(), terminal.done, writeTail])
        const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
        if (failures.length > 0) throw new AggregateError(failures, 'web-terminal: PTY cleanup failed')
      }
    }
  }
}

/** Register the terminal WebSocket and bind its lifetime to this plugin Fiber. */
export function apply(ctx: Context, config: Config): void {
  const hub = new TerminalSocketHub(ctx, resolveConfig(config))
  ctx.effect(() => {
    const unregister = ctx.webServer.registerUpgrade({
      path: TERMINAL_SOCKET_PATH,
      handler: (req, socket, head) => { hub.upgrade(req, socket, head) },
    })
    return async () => {
      unregister()
      await hub.dispose()
    }
  }, 'web-terminal: WebSocket + PTYs')
}
