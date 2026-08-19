import type {
  ObservableSnapshot, SessionId, SessionListState, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  FAVORITES_CHANGED_EVENT, FAVORITE_STORAGE_KEY, isFavoriteSession, setFavoriteSession,
} from './favorite-store.ts'

export const UNREAD_STORAGE_KEY = 'dsh.chat.unreadSessions.v1'

const SIDEBAR_SELECTOR = "[data-slot='sidebar.workspaces']"
const WORKSPACE_ROW_SELECTOR = "[role='treeitem'][aria-expanded]"
const SESSION_ROW_SELECTOR = "[role='treeitem'][aria-selected]"
const BADGE_CLASS = 'dsh-chat-unread-count'
const UNREAD_ATTRIBUTE = 'data-dsh-chat-unread'
const FLAT_UNREAD_ATTRIBUTE = 'data-dsh-chat-flat-unread'
const FAVORITE_BUTTON_CLASS = 'dsh-chat-favorite-button--sidebar'
const SIDEBAR_TABS_CLASS = 'dsh-chat-sidebar-tabs'
const SIDEBAR_TAB_CLASS = 'dsh-chat-sidebar-tab'
const FAVORITES_PANEL_CLASS = 'dsh-chat-favorites-panel'
const FAVORITES_LIST_CLASS = 'dsh-chat-favorites-list'
const FAVORITE_ROW_CLASS = 'dsh-chat-favorites-row'
const SIDEBAR_TAB_STORAGE_KEY = 'dsh.chat.sidebarTab.v1'
const NATIVE_LABEL_ATTRIBUTE = 'data-dsh-chat-native-label'
const WORKSPACES_ONLY_ATTRIBUTE = 'data-dsh-chat-workspaces-only'
const WORKSPACES_PANEL_ATTRIBUTE = 'data-dsh-chat-workspaces-panel'

function loadUnread(): Set<SessionId> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(UNREAD_STORAGE_KEY) ?? '[]')
    const ids = Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
    return new Set(ids as SessionId[])
  } catch {
    return new Set()
  }
}

function persistUnread(unread: ReadonlySet<SessionId>): void {
  try {
    localStorage.setItem(UNREAD_STORAGE_KEY, JSON.stringify([...unread]))
  } catch {
    // Storage failures must not break chat navigation or completion delivery.
  }
}

/** Persist reminders and compose favorite tabs onto the rc.6 WorkspaceBrowser DOM seam. */
export function bindUnreadNotifications(
  sessions: ObservableSnapshot<SessionListState>,
  workspaces: ObservableSnapshot<WorkspaceListState>,
  openSession: (id: SessionId) => void,
): () => void {
  const unread = loadUnread()
  let activeTab: 'workspaces' | 'favorites' = 'workspaces'
  try {
    if (localStorage.getItem(SIDEBAR_TAB_STORAGE_KEY) === 'favorites') activeTab = 'favorites'
  } catch {
    // A blocked preference store only resets the sidebar to Workspaces.
  }
  let scheduled = false
  let disposed = false

  const sync = (): void => {
    const root = document.querySelector<HTMLElement>(SIDEBAR_SELECTOR)
    if (root === null) return

    const sessionState = sessions.getSnapshot()
    const workspaceState = workspaces.getSnapshot()
    const archived = new Set(workspaceState.archivedSessionIds)
    const eligible = new Set(sessionState.ids.filter((id) => {
      const session = sessionState.byId[id]
      return session !== undefined && !session.blank
        && session.origin !== 'subagent' && !archived.has(id)
    }))
    const accounted = new Set(workspaceState.items.flatMap(workspace => workspace.sessionIds))

    // rc.6 exposes only the whole WorkspaceBrowser slot, so keep its tree intact and
    // idempotently add a sibling Favorites panel inside the same header/list containers.
    const browser = root.firstElementChild as HTMLElement | null
    const header = browser?.firstElementChild as HTMLElement | null
    const nativeTree = root.querySelector<HTMLElement>(`[role='tree']:not(.${FAVORITES_LIST_CLASS})`)
    const listArea = nativeTree?.parentElement?.parentElement
    const mountedTabs = header?.querySelector<HTMLElement>(`.${SIDEBAR_TABS_CLASS}`)
    if (mountedTabs !== null && mountedTabs !== undefined && nativeTree === null) mountedTabs.hidden = true
    if (browser !== null && header !== null && listArea !== null && listArea !== undefined) {
      let tabs = header.querySelector<HTMLElement>(`.${SIDEBAR_TABS_CLASS}`)
      if (tabs === null) {
        tabs = document.createElement('div')
        tabs.className = SIDEBAR_TABS_CLASS
        tabs.setAttribute('role', 'tablist')
        tabs.setAttribute('aria-label', '侧栏内容')
        for (const [tab, label] of [['workspaces', '工作区'], ['favorites', '收藏']] as const) {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = SIDEBAR_TAB_CLASS
          button.dataset.tab = tab
          button.setAttribute('role', 'tab')
          button.append(label)
          if (tab === 'favorites') {
            const count = document.createElement('span')
            count.className = 'dsh-chat-sidebar-tab__count'
            button.appendChild(count)
          }
          tabs.appendChild(button)
        }
        header.prepend(tabs)
      }

      const nativeLabel = [...header.children].find(child => child !== tabs
        && child.tagName === 'SPAN' && child.textContent?.trim() !== '')
      nativeLabel?.setAttribute(NATIVE_LABEL_ATTRIBUTE, '')
      tabs.hidden = false
      browser.dataset.dshChatSidebarTab = activeTab
      for (const child of [...header.children]) {
        if (child !== tabs && child !== nativeLabel) child.setAttribute(WORKSPACES_ONLY_ATTRIBUTE, '')
      }
      for (const child of [...listArea.children]) {
        if (!child.classList.contains(FAVORITES_PANEL_CLASS)) child.setAttribute(WORKSPACES_PANEL_ATTRIBUTE, '')
      }

      const favoriteIds = sessionState.ids.filter(id => eligible.has(id) && isFavoriteSession(id))
        .sort((left, right) => (sessionState.byId[right]?.updatedAt ?? 0)
          - (sessionState.byId[left]?.updatedAt ?? 0))
      const count = tabs.querySelector<HTMLElement>('.dsh-chat-sidebar-tab__count')
      const countLabel = favoriteIds.length === 0 ? '' : String(favoriteIds.length)
      if (count !== null && count.textContent !== countLabel) count.textContent = countLabel
      for (const button of tabs.querySelectorAll<HTMLButtonElement>(`.${SIDEBAR_TAB_CLASS}`)) {
        const selected = button.dataset.tab === activeTab
        button.setAttribute('aria-selected', String(selected))
        button.tabIndex = selected ? 0 : -1
      }

      let panel = listArea.querySelector<HTMLElement>(`:scope > .${FAVORITES_PANEL_CLASS}`)
      if (panel === null) {
        panel = document.createElement('div')
        panel.className = FAVORITES_PANEL_CLASS
        panel.setAttribute('role', 'tabpanel')
        panel.setAttribute('aria-label', '收藏的会话')
        const list = document.createElement('div')
        list.className = FAVORITES_LIST_CLASS
        list.setAttribute('role', 'tree')
        list.setAttribute('aria-label', '收藏的会话')
        panel.appendChild(list)
        listArea.appendChild(panel)
      }
      const favoriteList = panel.querySelector<HTMLElement>(`.${FAVORITES_LIST_CLASS}`)
      const signature = favoriteIds.map(id => {
        const session = sessionState.byId[id]
        return `${id}:${session?.displayTitle ?? ''}:${session?.updatedAt ?? 0}:${Number(unread.has(id))}`
      }).join('|') + `|current:${sessionState.current ?? ''}`
      if (favoriteList !== null && favoriteList.dataset.signature !== signature) {
        favoriteList.dataset.signature = signature
        const fragment = document.createDocumentFragment()
        if (favoriteIds.length === 0) {
          const empty = document.createElement('div')
          empty.className = 'dsh-chat-favorites-empty'
          empty.textContent = '暂无收藏的会话'
          fragment.appendChild(empty)
        }
        for (const id of favoriteIds) {
          const session = sessionState.byId[id]
          if (session === undefined) continue
          const row = document.createElement('div')
          row.className = FAVORITE_ROW_CLASS
          row.dataset.sessionId = id
          row.setAttribute('role', 'treeitem')
          row.setAttribute('aria-selected', String(id === sessionState.current))
          row.tabIndex = 0
          row.toggleAttribute(UNREAD_ATTRIBUTE, unread.has(id))

          const title = document.createElement('span')
          title.className = 'dsh-chat-favorites-row__title'
          title.textContent = session.displayTitle
          title.title = session.displayTitle
          row.appendChild(title)

          const workspace = workspaceState.items.find(item => item.sessionIds.includes(id))
          if (workspace !== undefined) {
            const workspaceTitle = document.createElement('span')
            workspaceTitle.className = 'dsh-chat-favorites-row__workspace'
            workspaceTitle.textContent = workspace.title
            workspaceTitle.title = workspace.path
            row.appendChild(workspaceTitle)
          }

          const remove = document.createElement('button')
          remove.type = 'button'
          remove.className = FAVORITE_BUTTON_CLASS
          remove.dataset.sessionId = id
          remove.dataset.favorite = 'true'
          remove.textContent = '★'
          remove.title = '取消收藏此对话'
          remove.setAttribute('aria-label', '取消收藏此对话')
          row.appendChild(remove)
          fragment.appendChild(row)
        }
        favoriteList.replaceChildren(fragment)
      }
    }

    const workspaceRows = [...root.querySelectorAll<HTMLElement>(WORKSPACE_ROW_SELECTOR)]
    const counts = workspaceState.items.map(workspace =>
      workspace.sessionIds.reduce((count, id) => count + Number(eligible.has(id) && unread.has(id)), 0))
    if (workspaceRows.length > counts.length) {
      counts.push([...unread].reduce(
        (count, id) => count + Number(eligible.has(id) && !accounted.has(id)), 0,
      ))
    }
    workspaceRows.forEach((row, index) => {
      const count = counts[index] ?? 0
      const current = row.querySelector<HTMLElement>(`.${BADGE_CLASS}`)
      if (count === 0) {
        current?.remove()
        return
      }
      const badge = current ?? document.createElement('span')
      const label = String(count)
      const ariaLabel = `${count} unread conversations`
      badge.className = BADGE_CLASS
      if (badge.textContent !== label) badge.textContent = label
      if (badge.getAttribute('aria-label') !== ariaLabel) badge.setAttribute('aria-label', ariaLabel)
      if (current === null) row.appendChild(badge)
    })

    const allSessionRows = [...root.querySelectorAll<HTMLElement>(
      `${SESSION_ROW_SELECTOR}:not(.${FAVORITE_ROW_CLASS})`,
    )]
    const groupedRows = new Set<HTMLElement>()
    const matchedIds = new Set<SessionId>()
    const markRows = (rows: readonly HTMLElement[], ids: readonly SessionId[], grouped: boolean): void => {
      const candidates = ids.filter(id => eligible.has(id) && !matchedIds.has(id))
      for (const row of rows) {
        let id = row.getAttribute('aria-selected') === 'true' ? sessionState.current : undefined
        if (id === undefined || !candidates.includes(id) || matchedIds.has(id)) {
          id = candidates.find(candidate => {
            const title = sessionState.byId[candidate]?.displayTitle
            return !matchedIds.has(candidate) && title !== undefined
              && [...row.querySelectorAll('span')].some(span =>
                span.childElementCount === 0 && span.textContent?.trim() === title)
          })
        }
        if (id !== undefined) matchedIds.add(id)
        const isUnread = id !== undefined && unread.has(id)
        row.toggleAttribute(UNREAD_ATTRIBUTE, isUnread)
        row.toggleAttribute(FLAT_UNREAD_ATTRIBUTE, isUnread && !grouped && row.tagName !== 'BUTTON')

        const current = row.querySelector<HTMLButtonElement>(`.${FAVORITE_BUTTON_CLASS}`)
        if (id === undefined || row.tagName === 'BUTTON') {
          current?.remove()
          continue
        }
        const favorite = isFavoriteSession(id)
        const button = current ?? document.createElement('button')
        const label = favorite ? '取消收藏此对话' : '收藏此对话'
        button.type = 'button'
        button.className = FAVORITE_BUTTON_CLASS
        button.dataset.sessionId = id
        button.dataset.favorite = String(favorite)
        if (button.textContent !== (favorite ? '★' : '☆')) button.textContent = favorite ? '★' : '☆'
        if (button.title !== label) button.title = label
        if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label)
        if (current !== null) continue
        const actions = row.querySelector('button')?.parentElement
        if (actions?.parentElement === row) row.insertBefore(button, actions)
        else row.appendChild(button)
      }
    }

    workspaceRows.forEach((workspaceRow, index) => {
      const rows = [...(workspaceRow.parentElement?.querySelectorAll<HTMLElement>(SESSION_ROW_SELECTOR) ?? [])]
      for (const row of rows) groupedRows.add(row)
      const ids = workspaceState.items[index]?.sessionIds
        ?? sessionState.ids.filter(id => !accounted.has(id))
      markRows(rows, ids, true)
    })
    markRows(allSessionRows.filter(row => !groupedRows.has(row)), sessionState.ids, false)
  }

  const schedule = (): void => {
    if (disposed || scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      if (!disposed) sync()
    })
  }

  const reconcile = (): void => {
    const state = sessions.getSnapshot()
    let changed = false
    for (const id of state.ids) {
      const session = state.byId[id]
      if (session?.completed === true && id !== state.current && !unread.has(id)) {
        unread.add(id)
        changed = true
      }
      if (session?.running === true && unread.delete(id)) changed = true
    }
    if (state.current !== undefined && unread.delete(state.current)) changed = true
    if (state.phase === 'ready') {
      for (const id of [...unread]) {
        if (state.byId[id] === undefined) {
          unread.delete(id)
          changed = true
        }
      }
    }
    if (changed) persistUnread(unread)
    schedule()
  }

  const onSidebarClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null
    const tab = target?.closest<HTMLButtonElement>(`.${SIDEBAR_TAB_CLASS}`)
    if (tab?.dataset.tab === 'workspaces' || tab?.dataset.tab === 'favorites') {
      activeTab = tab.dataset.tab
      try {
        localStorage.setItem(SIDEBAR_TAB_STORAGE_KEY, activeTab)
      } catch {
        // A blocked preference store does not block the current tab switch.
      }
      schedule()
      return
    }

    const button = target?.closest<HTMLButtonElement>(`.${FAVORITE_BUTTON_CLASS}`)
    const buttonSessionId = button?.dataset.sessionId as SessionId | undefined
    if (buttonSessionId !== undefined) {
      event.preventDefault()
      event.stopPropagation()
      setFavoriteSession(buttonSessionId, !isFavoriteSession(buttonSessionId))
      return
    }

    const row = target?.closest<HTMLElement>(`.${FAVORITE_ROW_CLASS}`)
    const rowSessionId = row?.dataset.sessionId as SessionId | undefined
    if (rowSessionId !== undefined) openSession(rowSessionId)
  }
  const onSidebarKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const row = event.target instanceof Element
      ? event.target.closest<HTMLElement>(`.${FAVORITE_ROW_CLASS}`) : null
    const id = row?.dataset.sessionId as SessionId | undefined
    if (id === undefined) return
    event.preventDefault()
    openSession(id)
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  document.addEventListener('click', onSidebarClick, true)
  document.addEventListener('keydown', onSidebarKeyDown, true)
  const onStorage = (event: StorageEvent): void => {
    if (event.key?.startsWith(`${FAVORITE_STORAGE_KEY}.`) === true) schedule()
  }
  window.addEventListener(FAVORITES_CHANGED_EVENT, schedule)
  window.addEventListener('storage', onStorage)
  const unsubscribeSessions = sessions.subscribe(reconcile)
  const unsubscribeWorkspaces = workspaces.subscribe(schedule)
  reconcile()

  return () => {
    disposed = true
    observer.disconnect()
    document.removeEventListener('click', onSidebarClick, true)
    document.removeEventListener('keydown', onSidebarKeyDown, true)
    window.removeEventListener(FAVORITES_CHANGED_EVENT, schedule)
    window.removeEventListener('storage', onStorage)
    unsubscribeSessions()
    unsubscribeWorkspaces()
    for (const badge of document.querySelectorAll(
      `.${BADGE_CLASS}, .${FAVORITE_BUTTON_CLASS}, .${SIDEBAR_TABS_CLASS}, .${FAVORITES_PANEL_CLASS}`,
    )) badge.remove()
    for (const element of document.querySelectorAll(
      `[${NATIVE_LABEL_ATTRIBUTE}], [${WORKSPACES_ONLY_ATTRIBUTE}], [${WORKSPACES_PANEL_ATTRIBUTE}], [data-dsh-chat-sidebar-tab]`,
    )) {
      element.removeAttribute(NATIVE_LABEL_ATTRIBUTE)
      element.removeAttribute(WORKSPACES_ONLY_ATTRIBUTE)
      element.removeAttribute(WORKSPACES_PANEL_ATTRIBUTE)
      element.removeAttribute('data-dsh-chat-sidebar-tab')
    }
    for (const row of document.querySelectorAll(`[${UNREAD_ATTRIBUTE}], [${FLAT_UNREAD_ATTRIBUTE}]`)) {
      row.removeAttribute(UNREAD_ATTRIBUTE)
      row.removeAttribute(FLAT_UNREAD_ATTRIBUTE)
    }
  }
}
