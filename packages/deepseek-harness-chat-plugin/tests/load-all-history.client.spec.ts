import type { ConversationSnapshot, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { bindLoadAllHistory, LOAD_ALL_BUTTON_ATTRIBUTE } from '../src/client/load-all-history.ts'

function emptySnapshot(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    sessionId: 'session-1' as SessionId,
    views: {} as never,
    chat: {
      order: ['node-3'],
      nodes: { get: () => undefined, values: () => [] },
      locations: { getTurn: () => [], getStep: () => [] },
      timeline: { turns: new Map() } as never,
      legacy: {
        nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
      },
    },
    nodes: [],
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: null,
    runningCalls: [],
    pending: [],
    queue: [],
    running: false,
    subagent: null,
    composerPhase: 'active',
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: true,
    loadingOlder: false,
    promptError: null,
    blank: false,
    lastAgentError: null,
    ...overrides,
  }
}

const conversationTranslation = (_key: 'chat.loadOlder'): string => '加载更早'
const pluginTranslation = (key: 'history.loadAll' | 'history.loadingAll'): string =>
  key === 'history.loadAll' ? '加载全部' : '正在加载全部…'

function pager(): HTMLButtonElement {
  document.body.innerHTML = `
    <div data-chat-flow>
      <div><button type="button">加载更早</button></div>
      <div data-chat-flow-key="node-3"></div>
    </div>`
  return document.querySelector('button')!
}

function bench(initial: ConversationSnapshot) {
  let snapshot = initial
  const sessionListeners = new Set<() => void>()
  const listListeners = new Set<() => void>()
  const session = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      sessionListeners.add(listener)
      return () => { sessionListeners.delete(listener) }
    },
  }
  const sessions = {
    list: {
      getSnapshot: () => ({ current: 'session-1' }),
      subscribe: (listener: () => void) => {
        listListeners.add(listener)
        return () => { listListeners.delete(listener) }
      },
    },
    binding: () => ({ session }),
  } as unknown as ISessions
  const publish = (next: ConversationSnapshot) => {
    snapshot = next
    for (const listener of sessionListeners) listener()
  }
  return { sessions, publish }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('load all history control', () => {
  beforeEach(() => { document.body.replaceChildren() })

  it('mounts one button beside the native history pager and removes it on dispose', async () => {
    const native = pager()
    const b = bench(emptySnapshot())
    const dispose = bindLoadAllHistory(b.sessions, conversationTranslation, pluginTranslation)
    await flush()

    const button = document.querySelector<HTMLButtonElement>(`button[${LOAD_ALL_BUTTON_ATTRIBUTE}]`)
    expect(button?.textContent).toBe('加载全部')
    expect(native.nextElementSibling).toBe(button)

    dispose()
    expect(document.querySelector(`button[${LOAD_ALL_BUTTON_ATTRIBUTE}]`)).toBeNull()
  })

  it('loads pages until the session reports no earlier history', async () => {
    const native = pager()
    let snapshot = emptySnapshot()
    const b = bench(snapshot)
    let pages = 0
    native.addEventListener('click', () => {
      pages += 1
      snapshot = emptySnapshot({
        hasMore: pages < 2,
        chat: { ...snapshot.chat, order: [`node-${3 - pages}`] },
      })
      queueMicrotask(() => { b.publish(snapshot) })
    })
    const dispose = bindLoadAllHistory(b.sessions, conversationTranslation, pluginTranslation)
    await flush()

    document.querySelector<HTMLButtonElement>(`button[${LOAD_ALL_BUTTON_ATTRIBUTE}]`)!.click()
    await flush()
    await flush()

    expect(pages).toBe(2)
    expect(document.querySelector(`button[${LOAD_ALL_BUTTON_ATTRIBUTE}]`)).toBeNull()
    dispose()
  })

  it('does not duplicate the injected button after transcript mutations', async () => {
    pager()
    const b = bench(emptySnapshot())
    const dispose = bindLoadAllHistory(b.sessions, conversationTranslation, pluginTranslation)
    await flush()

    document.querySelector('[data-chat-flow]')!.appendChild(document.createElement('div'))
    await new Promise(resolve => { window.setTimeout(resolve, 0) })
    expect(document.querySelectorAll(`button[${LOAD_ALL_BUTTON_ATTRIBUTE}]`)).toHaveLength(1)
    dispose()
  })
})
