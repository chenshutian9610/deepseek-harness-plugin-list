/** Root attribute set while process details are hidden. */
export const PROCESS_DETAILS_HIDDEN_ATTRIBUTE = 'data-dsh-process-details-hidden'
/** Assistant-row marker used to remove the flex item, not only its hidden Think children. */
export const PROCESS_ONLY_ASSISTANT_ATTRIBUTE = 'data-dsh-process-only-assistant'

const ASSISTANT_ROW_SELECTOR = "[data-chat-flow-kind='assistant-step']"
const THINK_SELECTOR = "[data-variant='think']"
const MEANINGFUL_MEDIA_SELECTOR = 'img, video, audio, canvas, iframe, object, embed'

/** Mark Assistant flow items whose rendered body contains only Think chrome or no visible content. */
export function markProcessOnlyAssistantRows(root: ParentNode = document): void {
  for (const row of root.querySelectorAll<HTMLElement>(ASSISTANT_ROW_SELECTOR)) {
    const remainder = row.cloneNode(true) as HTMLElement
    for (const think of remainder.querySelectorAll(THINK_SELECTOR)) think.remove()
    const hasText = (remainder.textContent ?? '').trim().length > 0
    const hasMedia = remainder.querySelector(MEANINGFUL_MEDIA_SELECTOR) !== null
    row.toggleAttribute(PROCESS_ONLY_ASSISTANT_ATTRIBUTE, !hasText && !hasMedia)
  }
}

function clearProcessOnlyAssistantRows(): void {
  for (const row of document.querySelectorAll<HTMLElement>(`[${PROCESS_ONLY_ASSISTANT_ATTRIBUTE}]`)) {
    row.removeAttribute(PROCESS_ONLY_ASSISTANT_ATTRIBUTE)
  }
}

/** Track streamed Assistant rows and return the document-state disposer. */
export function bindProcessDetailsVisibility(): () => void {
  let scheduled = false
  let disposed = false
  const classify = (): void => {
    if (disposed || scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      if (!disposed) markProcessOnlyAssistantRows()
    })
  }
  const observer = new MutationObserver(classify)
  observer.observe(document.body, { childList: true, characterData: true, subtree: true })
  markProcessOnlyAssistantRows()
  classify()
  return () => {
    disposed = true
    observer.disconnect()
    document.documentElement.removeAttribute(PROCESS_DETAILS_HIDDEN_ATTRIBUTE)
    clearProcessOnlyAssistantRows()
  }
}
