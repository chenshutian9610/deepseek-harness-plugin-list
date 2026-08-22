import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'


export const LOAD_ALL_BUTTON_ATTRIBUTE = 'data-dsh-chat-load-all'
export const LOAD_ALL_LOCKED_ATTRIBUTE = 'data-dsh-chat-load-all-locked'

const PAGE_TIMEOUT_MS = 30_000

type SessionFace = NonNullable<ReturnType<ISessions['binding']>>['session']
type HistoryTranslate = (key: 'chat.loadOlder') => string
type PluginTranslate = (key: 'history.loadAll' | 'history.loadingAll') => string

function directChildren(element: Element): HTMLElement[] {
  return [...element.children].filter((child): child is HTMLElement => child instanceof HTMLElement)
}

/** Locate the native history pager without depending on its generated CSS-module class. */
function nativeOlderButton(flow: HTMLElement, loadOlderLabel: string): HTMLButtonElement | undefined {
  const injected = flow.querySelector<HTMLButtonElement>(`button[${LOAD_ALL_BUTTON_ATTRIBUTE}]`)
  const injectedSibling = injected?.previousElementSibling
  if (injectedSibling instanceof HTMLButtonElement) return injectedSibling

  const firstRow = directChildren(flow).find(child => child.hasAttribute('data-chat-flow-key'))
  for (const child of directChildren(flow)) {
    if (child === firstRow) break
    const buttons = [...child.querySelectorAll<HTMLButtonElement>(':scope > button[type="button"]')]
    if (buttons.length === 1 && buttons[0]?.textContent?.trim() === loadOlderLabel) return buttons[0]
  }
  return undefined
}

function firstChatKey(session: SessionFace): string | undefined {
  return session.getSnapshot().chat.order[0]
}

/** Add a load-all affordance beside Harness's native one-page history pager. */
export function bindLoadAllHistory(
  sessions: ISessions,
  conversationT: HistoryTranslate,
  pluginT: PluginTranslate,
): () => void {
  let disposed = false
  let scheduled = false
  let currentId: string | undefined
  let currentSession: SessionFace | undefined
  let unsubscribeSession: (() => void) | undefined
  let runGeneration = 0
  let loadingAll = false
  let cancelPageWait: (() => void) | undefined
  let programmaticClick = false

  const removeButtons = (): void => {
    for (const button of document.querySelectorAll<HTMLButtonElement>(`button[${LOAD_ALL_BUTTON_ATTRIBUTE}]`)) {
      const native = button.previousElementSibling
      if (native instanceof HTMLButtonElement) {
        native.removeAttribute(LOAD_ALL_LOCKED_ATTRIBUTE)
        native.removeAttribute('aria-disabled')
      }
      button.remove()
    }
  }

  const cancelRun = (): void => {
    runGeneration += 1
    loadingAll = false
    cancelPageWait?.()
    cancelPageWait = undefined
  }

  const rebindSession = (): void => {
    const nextId = sessions.list.getSnapshot().current
    if (nextId === currentId) return
    cancelRun()
    unsubscribeSession?.()
    unsubscribeSession = undefined
    currentId = nextId
    currentSession = nextId === undefined ? undefined : sessions.binding(nextId)?.session
    if (currentSession !== undefined) unsubscribeSession = currentSession.subscribe(schedule)
  }

  const waitForPage = (
    session: SessionFace,
    previousFirstKey: string | undefined,
    generation: number,
    click: () => void,
  ): Promise<boolean> => new Promise((resolve) => {
    let settled = false
    let sawLoading = session.getSnapshot().loadingOlder
    const finish = (progressed: boolean): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      unsubscribe()
      if (cancelPageWait === cancel) cancelPageWait = undefined
      resolve(progressed)
    }
    const check = (): void => {
      if (disposed || generation !== runGeneration) {
        finish(false)
        return
      }
      const snapshot = session.getSnapshot()
      if (snapshot.loadingOlder) sawLoading = true
      if (!snapshot.loadingOlder && (
        !snapshot.hasMore
        || firstChatKey(session) !== previousFirstKey
        || sawLoading
      )) finish(!snapshot.hasMore || firstChatKey(session) !== previousFirstKey)
    }
    const unsubscribe = session.subscribe(check)
    const timeout = window.setTimeout(() => { finish(false) }, PAGE_TIMEOUT_MS)
    const cancel = (): void => { finish(false) }
    cancelPageWait = cancel
    click()
    check()
  })

  const runAll = async (sessionId: string, session: SessionFace): Promise<void> => {
    if (loadingAll) return
    loadingAll = true
    const generation = ++runGeneration
    schedule()
    try {
      while (!disposed && generation === runGeneration && currentId === sessionId) {
        const snapshot = session.getSnapshot()
        if (!snapshot.hasMore) break
        if (snapshot.loadingOlder) {
          const progressed = await waitForPage(session, firstChatKey(session), generation, () => {})
          if (!progressed) break
          continue
        }
        syncDom()
        const flow = document.querySelector<HTMLElement>('[data-chat-flow]')
        const native = flow === null ? undefined : nativeOlderButton(flow, conversationT('chat.loadOlder'))
        if (native === undefined) break
        const previousFirstKey = firstChatKey(session)
        const progressed = await waitForPage(session, previousFirstKey, generation, () => {
          programmaticClick = true
          try {
            native.click()
          } finally {
            programmaticClick = false
          }
        })
        if (!progressed) break
      }
    } finally {
      if (generation === runGeneration) {
        loadingAll = false
        schedule()
      }
    }
  }

  function syncDom(): void {
    if (disposed) return
    rebindSession()
    const session = currentSession
    const snapshot = session?.getSnapshot()
    const flow = document.querySelector<HTMLElement>('[data-chat-flow]')
    if (session === undefined || snapshot?.hasMore !== true || flow === null) {
      removeButtons()
      return
    }

    const native = nativeOlderButton(flow, conversationT('chat.loadOlder'))
    if (native === undefined) return
    const container = native.parentElement
    if (container === null) return
    let button = container.querySelector<HTMLButtonElement>(`:scope > button[${LOAD_ALL_BUTTON_ATTRIBUTE}]`)
    if (button === null) {
      button = document.createElement('button')
      button.type = 'button'
      button.className = 'dsh-chat-load-all-button'
      button.setAttribute(LOAD_ALL_BUTTON_ATTRIBUTE, '')
      container.appendChild(button)
    }
    const label = loadingAll ? pluginT('history.loadingAll') : pluginT('history.loadAll')
    if (button.textContent !== label) button.textContent = label
    button.title = pluginT('history.loadAll')
    button.setAttribute('aria-label', pluginT('history.loadAll'))
    button.setAttribute('aria-busy', String(loadingAll))
    button.disabled = loadingAll || snapshot.loadingOlder
    button.onclick = () => { void runAll(currentId!, session) }
    if (loadingAll) {
      native.setAttribute(LOAD_ALL_LOCKED_ATTRIBUTE, '')
      native.setAttribute('aria-disabled', 'true')
    } else {
      native.removeAttribute(LOAD_ALL_LOCKED_ATTRIBUTE)
      native.removeAttribute('aria-disabled')
    }
  }

  function schedule(): void {
    if (scheduled || disposed) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      syncDom()
    })
  }

  const blockNativeClick = (event: MouseEvent): void => {
    if (!loadingAll || programmaticClick) return
    const target = event.target
    if (target instanceof HTMLElement && target.closest(`[${LOAD_ALL_LOCKED_ATTRIBUTE}]`) !== null) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }

  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  document.addEventListener('click', blockNativeClick, true)
  const unsubscribeList = sessions.list.subscribe(schedule)
  schedule()

  return () => {
    disposed = true
    cancelRun()
    unsubscribeSession?.()
    unsubscribeList()
    observer.disconnect()
    document.removeEventListener('click', blockNativeClick, true)
    removeButtons()
  }
}
