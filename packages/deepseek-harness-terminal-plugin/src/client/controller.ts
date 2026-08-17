/** React-free browser controller for one page-local terminal connection. */
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import type { IDisposable } from '@xterm/xterm'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { TERMINAL_THEMES, type TerminalColorScheme } from './theme.ts'

/** Facts rendered by the terminal overlay. */
export interface TerminalSnapshot {
  readonly open: boolean
  readonly phase: 'idle' | 'connecting' | 'ready' | 'exited' | 'error'
  readonly message?: string
}

interface ServerMessage {
  readonly type: 'ready' | 'output' | 'exit' | 'error'
  readonly data?: string
  readonly message?: string
  readonly exitCode?: number | null
  readonly signal?: string | null
}

function parseServerMessage(value: string): ServerMessage {
  const parsed: unknown = JSON.parse(value)
  if (parsed === null || typeof parsed !== 'object') throw new Error('invalid terminal response')
  const record = parsed as Record<string, unknown>
  if (!['ready', 'output', 'exit', 'error'].includes(String(record.type))) {
    throw new Error('invalid terminal response')
  }
  if (record.type === 'output' && typeof record.data !== 'string') throw new Error('invalid terminal output')
  if (record.type === 'error' && typeof record.message !== 'string') throw new Error('invalid terminal error')
  return record as unknown as ServerMessage
}

function socketUrl(sessionId: SessionId, cols: number, rows: number): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = new URL('/web-terminal', `${scheme}//${window.location.host}`)
  url.searchParams.set('session', sessionId)
  url.searchParams.set('cols', String(cols))
  url.searchParams.set('rows', String(rows))
  return url.href
}

/** Owns xterm, the same-origin WebSocket, and the global hotkey state. */
export class TerminalController implements ObservableSnapshot<TerminalSnapshot> {
  private snapshot: TerminalSnapshot = Object.freeze({ open: false, phase: 'idle' })
  private readonly listeners = new Set<() => void>()
  private readonly terminal = new Terminal({
    cursorBlink: true,
    cursorInactiveStyle: 'bar',
    cursorStyle: 'bar',
    cursorWidth: 2,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.2,
    minimumContrastRatio: 4.5,
    scrollback: 10_000,
    screenReaderMode: true,
  })
  private readonly fit = new FitAddon()
  private readonly input: IDisposable
  private element: HTMLElement | undefined
  private sessionId: SessionId | undefined
  private socket: WebSocket | undefined
  private generation = 0

  constructor() {
    this.terminal.loadAddon(this.fit)
    const sendInput = (data: string): void => {
      if (this.socket?.readyState === WebSocket.OPEN && this.snapshot.phase === 'ready') {
        this.socket.send(JSON.stringify({ type: 'input', data }))
      }
    }
    this.input = this.terminal.onData(sendInput)
    this.terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      if (['Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
        event.preventDefault()
        event.stopPropagation()
        return true
      }
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return true
      const data = event.key === 'ArrowLeft' ? '\x1bb' : event.key === 'ArrowRight' ? '\x1bf' : undefined
      if (data === undefined) return true
      event.preventDefault()
      event.stopPropagation()
      sendInput(data)
      return false
    })
  }

  getSnapshot = (): TerminalSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Mount or reparent xterm when the session-scoped dock remounts. */
  attach = (element: HTMLElement): (() => void) => {
    this.element = element
    if (this.terminal.element === undefined) this.terminal.open(element)
    else element.append(this.terminal.element)
    if (this.snapshot.open) requestAnimationFrame(this.activate)
    return () => {
      if (this.element === element) this.element = undefined
    }
  }

  /** Follow the page's current Session, dropping a shell from the previous one. */
  setSession = (sessionId: SessionId | undefined): void => {
    if (sessionId === this.sessionId) return
    this.sessionId = sessionId
    this.disconnect()
    this.terminal.reset()
    this.publish({ open: this.snapshot.open, phase: 'idle' })
    if (this.snapshot.open) this.connect()
  }

  /** Keep xterm's canvas palette in sync with the resolved page theme. */
  setColorScheme = (colorScheme: TerminalColorScheme): void => {
    this.terminal.options.theme = TERMINAL_THEMES[colorScheme]
  }

  /** Toggle the composer dock from Cmd/Ctrl+J. */
  toggle = (): void => {
    if (this.snapshot.open) {
      this.publish({ ...this.snapshot, open: false })
      return
    }
    this.publish({ ...this.snapshot, open: true })
    requestAnimationFrame(this.activate)
  }

  /** Hide the panel without terminating its shell. */
  hide = (): void => {
    if (this.snapshot.open) this.publish({ ...this.snapshot, open: false })
  }

  /** Release browser resources; socket close makes the Host await PTY termination. */
  dispose(): void {
    this.generation += 1
    this.socket?.close(1000, 'client disposed')
    this.socket = undefined
    this.input.dispose()
    this.terminal.dispose()
    this.listeners.clear()
  }

  private activate = (): void => {
    if (this.element === undefined) return
    this.fit.fit()
    this.terminal.focus()
    if (this.socket === undefined) this.connect()
  }

  private connect(): void {
    if (this.sessionId === undefined) {
      this.publish({ open: true, phase: 'error', message: '请先选择一个 Session' })
      return
    }
    if (this.element === undefined) return
    this.fit.fit()
    const generation = ++this.generation
    const socket = new WebSocket(socketUrl(this.sessionId, this.terminal.cols, this.terminal.rows))
    this.socket = socket
    this.publish({ open: true, phase: 'connecting', message: '正在启动终端…' })

    socket.addEventListener('message', (event) => {
      if (generation !== this.generation || typeof event.data !== 'string') return
      try {
        const message = parseServerMessage(event.data)
        switch (message.type) {
          case 'ready':
            this.publish({ open: true, phase: 'ready' })
            this.terminal.focus()
            break
          case 'output':
            this.terminal.write(message.data ?? '')
            break
          case 'exit': {
            const detail = message.signal ?? message.exitCode ?? 0
            this.terminal.write(`\r\n\x1b[90m[进程已退出: ${String(detail)}]\x1b[0m\r\n`)
            this.publish({ open: true, phase: 'exited', message: '进程已退出；重新打开面板可启动新终端' })
            break
          }
          case 'error':
            this.publish({ open: true, phase: 'error', message: message.message ?? '终端连接失败' })
            break
        }
      } catch (error) {
        this.publish({ open: true, phase: 'error', message: String(error) })
        socket.close(1008, 'invalid server message')
      }
    })
    socket.addEventListener('close', () => {
      if (generation !== this.generation) return
      this.socket = undefined
      if (this.snapshot.phase === 'connecting') {
        this.publish({ open: this.snapshot.open, phase: 'error', message: '终端连接已关闭' })
      }
    })
    socket.addEventListener('error', () => {
      if (generation === this.generation) {
        this.publish({ open: this.snapshot.open, phase: 'error', message: '终端连接失败' })
      }
    })
  }

  private disconnect(): void {
    this.generation += 1
    this.socket?.close(1000, 'session changed')
    this.socket = undefined
  }

  private publish(snapshot: TerminalSnapshot): void {
    this.snapshot = Object.freeze(snapshot)
    for (const listener of this.listeners) listener()
  }
}
