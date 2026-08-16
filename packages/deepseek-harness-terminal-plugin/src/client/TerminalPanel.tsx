/** Terminal below the composer; all live state and actions arrive through slot props. */
import { useEffect, useRef } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TerminalController } from './controller.ts'

/** Business face supplied by the client plugin registration. */
export interface TerminalPanelInjected {
  hooks: { terminal: TerminalController }
  attach(element: HTMLElement): () => void
  hide(): void
  toggle(): void
}

type TerminalPanelProps = PropsRuntime<'conversation.input.dock'> & InjectFace<TerminalPanelInjected>
type TerminalButtonProps = PropsRuntime<'conversation.session.header.utilities'> & InjectFace<TerminalPanelInjected>

/** Toggle the terminal from the session header's right edge. */
export function TerminalButton({ useTerminal, toggle }: TerminalButtonProps) {
  const open = useTerminal(state => state.open)
  return (
    <button
      type="button"
      className="dsh-web-terminal-toggle"
      data-open={open || undefined}
      aria-pressed={open}
      title="Terminal（⌘/Ctrl J）"
      onClick={toggle}
    >
      Terminal
    </button>
  )
}

/** Render the terminal under the current session's composer. */
export function TerminalPanel({ sessionId, useSessions, useTerminal, attach, hide }: TerminalPanelProps) {
  const element = useRef<HTMLDivElement | null>(null)
  const title = useSessions(state => state.byId[sessionId]?.displayTitle)
  const terminal = useTerminal(state => state)

  useEffect(() => element.current === null ? undefined : attach(element.current), [attach])

  return (
    <section
      className="dsh-web-terminal-panel"
      data-open={terminal.open || undefined}
      aria-hidden={!terminal.open}
      aria-label="终端"
    >
      <header className="dsh-web-terminal-header">
        <div className="dsh-web-terminal-title">
          <strong>终端</strong>
          {title !== undefined && <span>{title}</span>}
          {terminal.phase !== 'ready' && terminal.phase !== 'idle' && (
            <span className="dsh-web-terminal-status" aria-live="polite">{terminal.message ?? terminal.phase}</span>
          )}
        </div>
        <div className="dsh-web-terminal-actions">
          <kbd>⌘/Ctrl J</kbd>
          <button type="button" onClick={hide} aria-label="关闭终端">×</button>
        </div>
      </header>
      <div ref={element} className="dsh-web-terminal-viewport" />
    </section>
  )
}
