/** Browser half: persisted Session Header switch and Chat presentation filter. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import styles from './styles.css?inline'
import { bindProcessDetailsVisibility } from './dom-visibility.ts'
import { en, NS, zh } from './locales.ts'
import { ProcessDetailsSwitch } from './ProcessDetailsSwitch.tsx'
import { createProcessDetailsStore } from './visibility-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'chat.processVisibility': import('./locales.ts').ProcessVisibilityKey
  }
}

/** Client services required by the Session Header contribution. */
export const inject = ['slots', 'locale']

function installStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-chat-process-visibility'
  style.textContent = styles
  document.head.appendChild(style)
  return () => { style.remove() }
}

/** Register the persisted process-detail switch and bind it to Chat presentation. */
export function apply(ctx: ClientContext): void {
  const store = createProcessDetailsStore()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'chat-process-visibility: dictionaries')
  ctx.effect(() => {
    const removeStyles = installStyles()
    const unbindVisibility = bindProcessDetailsVisibility()
    return () => {
      unbindVisibility()
      removeStyles()
    }
  }, 'chat-process-visibility: styles + document state')

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'chat-process-visibility',
    order: -10,
    locale: NS,
    store,
  }, ProcessDetailsSwitch))
}
