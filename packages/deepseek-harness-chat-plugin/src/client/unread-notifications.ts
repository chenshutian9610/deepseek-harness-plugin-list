import type {
  ObservableSnapshot, SessionId, SessionListState, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'

export const UNREAD_STORAGE_KEY = 'dsh.chat.unreadSessions.v1'

const SIDEBAR_SELECTOR = "[data-slot='sidebar.workspaces']"
const WORKSPACE_ROW_SELECTOR = "[role='treeitem'][aria-expanded]"
const SESSION_ROW_SELECTOR = "[role='treeitem'][aria-selected]"
const BADGE_CLASS = 'dsh-chat-unread-count'
const UNREAD_ATTRIBUTE = 'data-dsh-chat-unread'
const FLAT_UNREAD_ATTRIBUTE = 'data-dsh-chat-flat-unread'

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

/** Persist runtime completion reminders and mirror them onto Session and Workspace rows. */
export function bindUnreadNotifications(
  sessions: ObservableSnapshot<SessionListState>,
  workspaces: ObservableSnapshot<WorkspaceListState>,
): () => void {
  const unread = loadUnread()
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

    const allSessionRows = [...root.querySelectorAll<HTMLElement>(SESSION_ROW_SELECTOR)]
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

  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  const unsubscribeSessions = sessions.subscribe(reconcile)
  const unsubscribeWorkspaces = workspaces.subscribe(schedule)
  reconcile()

  return () => {
    disposed = true
    observer.disconnect()
    unsubscribeSessions()
    unsubscribeWorkspaces()
    for (const badge of document.querySelectorAll(`.${BADGE_CLASS}`)) badge.remove()
    for (const row of document.querySelectorAll(`[${UNREAD_ATTRIBUTE}], [${FLAT_UNREAD_ATTRIBUTE}]`)) {
      row.removeAttribute(UNREAD_ATTRIBUTE)
      row.removeAttribute(FLAT_UNREAD_ATTRIBUTE)
    }
  }
}
