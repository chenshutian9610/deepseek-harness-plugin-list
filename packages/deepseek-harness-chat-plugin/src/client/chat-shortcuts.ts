import type {
  ISessions, IWorkspaces, SessionId, SessionSearchResultItem,
} from '@deepseek-ai/dsh-client-runtime/client'

const SEARCH_DEBOUNCE_MS = 250
const SEARCH_QUERY_MAX_LENGTH = 500

/** Bind browser-wide new-session and conversation-content search shortcuts. */
export function bindChatShortcuts(sessions: ISessions, workspaces: IWorkspaces): () => void {
  const dialog = document.createElement('dialog')
  dialog.className = 'dsh-chat-search-dialog'
  dialog.setAttribute('aria-label', '搜索会话内容')
  dialog.innerHTML = `
    <div class="dsh-chat-search-dialog__card">
      <div class="dsh-chat-search-dialog__header">
        <strong>搜索会话内容</strong>
        <kbd>Esc</kbd>
      </div>
      <input class="dsh-chat-search-dialog__input" type="search" maxlength="500"
        autocomplete="off" placeholder="输入会话中的文字…" aria-label="搜索会话内容">
      <div class="dsh-chat-search-dialog__status" aria-live="polite"></div>
      <div class="dsh-chat-search-dialog__results" role="listbox" aria-label="搜索结果"></div>
      <div class="dsh-chat-search-dialog__hint">↑↓ 选择 · Enter 打开 · 双击打开</div>
    </div>`
  document.body.appendChild(dialog)

  const input = dialog.querySelector<HTMLInputElement>('.dsh-chat-search-dialog__input')!
  const status = dialog.querySelector<HTMLElement>('.dsh-chat-search-dialog__status')!
  const resultList = dialog.querySelector<HTMLElement>('.dsh-chat-search-dialog__results')!
  let results: SessionSearchResultItem[] = []
  let selectedIndex = -1
  let searchTimer: number | undefined
  let searchController: AbortController | undefined

  const render = (message = ''): void => {
    resultList.replaceChildren()
    status.textContent = message
    const sessionState = sessions.list.getSnapshot()
    const workspaceState = workspaces.list.getSnapshot()
    results.forEach((result, index) => {
      const session = sessionState.byId[result.sessionId]
      const workspace = workspaceState.items.find(item => item.sessionIds.includes(result.sessionId))
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'dsh-chat-search-result'
      row.dataset.index = String(index)
      row.dataset.sessionId = result.sessionId
      row.setAttribute('role', 'option')
      row.setAttribute('aria-selected', String(index === selectedIndex))

      const title = document.createElement('span')
      title.className = 'dsh-chat-search-result__title'
      title.textContent = session?.displayTitle ?? '未命名会话'
      row.appendChild(title)
      if (workspace !== undefined) {
        const workspaceLabel = document.createElement('span')
        workspaceLabel.className = 'dsh-chat-search-result__workspace'
        workspaceLabel.textContent = workspace.title
        row.appendChild(workspaceLabel)
      }
      const snippet = document.createElement('span')
      snippet.className = 'dsh-chat-search-result__snippet'
      snippet.textContent = result.snippet
      row.appendChild(snippet)
      resultList.appendChild(row)
    })
  }

  const selectResult = (index: number): void => {
    if (results[index] === undefined) return
    selectedIndex = index
    for (const [rowIndex, row] of [...resultList.children].entries()) {
      row.setAttribute('aria-selected', String(rowIndex === selectedIndex))
    }
    resultList.children[selectedIndex]?.scrollIntoView({ block: 'nearest' })
  }

  const openResult = (id: SessionId): void => {
    try {
      sessions.open(id)
      dialog.close()
    } catch {
      status.textContent = '该会话已不存在'
    }
  }

  const runSearch = (): void => {
    const sanitized = input.value.replaceAll('\0', '').slice(0, SEARCH_QUERY_MAX_LENGTH)
    if (sanitized !== input.value) input.value = sanitized
    const query = sanitized.trim()
    window.clearTimeout(searchTimer)
    searchController?.abort()
    results = []
    selectedIndex = -1
    if (query === '') {
      render('输入关键词搜索会话内容')
      return
    }
    render('正在搜索…')
    searchController = new AbortController()
    const controller = searchController
    searchTimer = window.setTimeout(async () => {
      try {
        const response = await sessions.search(query, controller.signal)
        if (controller.signal.aborted) return
        if (!response.ok) {
          render(response.error.message)
          return
        }
        results = response.value.items
        selectedIndex = results.length === 0 ? -1 : 0
        render(results.length === 0
          ? '没有匹配的会话'
          : response.value.hasMore ? `显示前 ${results.length} 条结果` : '')
      } catch (error) {
        if (!controller.signal.aborted) render(error instanceof Error ? error.message : String(error))
      }
    }, SEARCH_DEBOUNCE_MS)
  }

  const onGlobalKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.altKey || (!event.metaKey && !event.ctrlKey)) return
    const key = event.key.toLowerCase()
    if (key === 'o' && event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      if (dialog.open) dialog.close()
      workspaces.startSession()
      return
    }
    if (key !== 'k' || event.shiftKey) return
    event.preventDefault()
    event.stopPropagation()
    if (!dialog.open) dialog.showModal()
    input.focus()
    input.select()
  }

  input.addEventListener('input', runSearch)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (results.length === 0) return
      selectResult((selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + results.length)
        % results.length)
      return
    }
    if (event.key === 'Enter' && selectedIndex >= 0) {
      const result = results[selectedIndex]
      if (result === undefined) return
      event.preventDefault()
      openResult(result.sessionId)
    }
  })
  resultList.addEventListener('click', (event) => {
    const row = event.target instanceof Element
      ? event.target.closest<HTMLElement>('.dsh-chat-search-result') : null
    const index = Number(row?.dataset.index)
    if (!Number.isInteger(index) || results[index] === undefined) return
    selectResult(index)
  })
  resultList.addEventListener('dblclick', (event) => {
    const row = event.target instanceof Element
      ? event.target.closest<HTMLElement>('.dsh-chat-search-result') : null
    const id = row?.dataset.sessionId as SessionId | undefined
    if (id !== undefined) openResult(id)
  })
  resultList.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    const row = event.target instanceof Element
      ? event.target.closest<HTMLElement>('.dsh-chat-search-result') : null
    const id = row?.dataset.sessionId as SessionId | undefined
    if (id !== undefined) openResult(id)
  })
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close()
  })
  dialog.addEventListener('close', () => {
    window.clearTimeout(searchTimer)
    searchController?.abort()
    input.value = ''
    results = []
    selectedIndex = -1
    render('输入关键词搜索会话内容')
  })
  document.addEventListener('keydown', onGlobalKeyDown, true)
  render('输入关键词搜索会话内容')

  return () => {
    window.clearTimeout(searchTimer)
    searchController?.abort()
    document.removeEventListener('keydown', onGlobalKeyDown, true)
    dialog.remove()
  }
}
