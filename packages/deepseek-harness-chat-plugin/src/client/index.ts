/** Browser half: persisted Session Header switch and Chat presentation filter. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import styles from './styles.css?inline'
import { bindChatShortcuts } from './chat-shortcuts.ts'
import { bindProcessDetailsVisibility } from './dom-visibility.ts'
import { createFavoriteStore } from './favorite-store.ts'
import { FavoriteButton } from './FavoriteButton.tsx'
import { en, NS, zh } from './locales.ts'
import { ProcessDetailsSwitch } from './ProcessDetailsSwitch.tsx'
import { bindUnreadNotifications } from './unread-notifications.ts'
import { createProcessDetailsStore } from './visibility-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'chat.processVisibility': import('./locales.ts').ProcessVisibilityKey
  }
}

/** Client services required by the Header controls and sidebar indicators. */
export const inject = ['slots', 'locale', 'sessions', 'workspaces']

function installStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-chat-process-visibility'
  style.textContent = styles
  document.head.appendChild(style)
  return () => { style.remove() }
}

/** Register persisted Header controls and bind their sidebar and Chat presentation. */
export function apply(ctx: ClientContext): void {
  const processDetailsStore = createProcessDetailsStore()
  const favoriteStore = createFavoriteStore()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'chat-process-visibility: dictionaries')
  ctx.effect(() => {
    const removeStyles = installStyles()
    const unbindVisibility = bindProcessDetailsVisibility()
    const unbindShortcuts = bindChatShortcuts(ctx.sessions, ctx.workspaces)
    const unbindUnread = bindUnreadNotifications(
      ctx.sessions.list, ctx.workspaces.list, id => { ctx.sessions.open(id) },
    )
    return () => {
      unbindUnread()
      unbindShortcuts()
      unbindVisibility()
      removeStyles()
    }
  }, 'chat-process-visibility: styles + document state + shortcuts')

  ctx.slots.inject('conversation.session.header.utilities', function* () {
    yield ctx.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'chat-process-visibility',
      order: -10,
      locale: NS,
      store: processDetailsStore,
    }, ProcessDetailsSwitch)
    yield ctx.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'chat-favorite',
      order: 0,
      locale: NS,
      store: favoriteStore,
    }, FavoriteButton)
  })
}
