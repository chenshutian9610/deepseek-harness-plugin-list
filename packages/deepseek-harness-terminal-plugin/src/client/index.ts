/** Browser half: input-dock registration, xterm controller, and Cmd/Ctrl+J. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import xtermCss from '@xterm/xterm/css/xterm.css?inline'
import panelCss from './styles.css?inline'
import { TerminalController } from './controller.ts'
import { TerminalButton, TerminalPanel, type TerminalPanelInjected } from './TerminalPanel.tsx'

/** Client services required by the session-scoped composer contribution. */
export const inject = ['slots', 'sessions', 'theme']

function installStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-web-terminal'
  style.textContent = `${xtermCss}\n${panelCss}`
  document.head.appendChild(style)
  return () => { style.remove() }
}

/** Register the terminal dock and its global shortcut. */
export function apply(ctx: ClientContext): void {
  const controller = new TerminalController()
  controller.setColorScheme(ctx.theme.getTheme().active.colorScheme)
  ctx.effect(() => {
    const syncSession = (): void => { controller.setSession(ctx.sessions.list.getSnapshot().current) }
    syncSession()
    const stopSessions = ctx.sessions.list.subscribe(syncSession)
    const stopTheme = ctx.on('theme/change', ({ active }) => {
      controller.setColorScheme(active.colorScheme)
    })
    const removeStyles = installStyles()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'j') return
      if (!event.metaKey && !event.ctrlKey) return
      event.preventDefault()
      controller.toggle()
    }
    document.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      document.removeEventListener('keydown', onKeyDown, { capture: true })
      stopSessions()
      stopTheme()
      removeStyles()
      controller.dispose()
    }
  }, 'web-terminal: session + theme + styles + shortcut')

  const injected = (): TerminalPanelInjected => ({
    hooks: { terminal: controller },
    attach: controller.attach,
    hide: controller.hide,
    toggle: controller.toggle,
  })
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'web-terminal',
    order: 0,
    inject: injected,
  }, TerminalButton))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'web-terminal',
    order: 100,
    inject: injected,
  }, TerminalPanel))
}
