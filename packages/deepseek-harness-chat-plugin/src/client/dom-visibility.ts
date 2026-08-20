/** Root attribute set while process details are hidden. */
export const PROCESS_DETAILS_HIDDEN_ATTRIBUTE = 'data-dsh-process-details-hidden'
/** Assistant-row marker used to remove the flex item, not only its hidden Think children. */
export const PROCESS_ONLY_ASSISTANT_ATTRIBUTE = 'data-dsh-process-only-assistant'
/** Inert current-process summary shown while full process details are hidden. */
export const PROCESS_PREVIEW_ATTRIBUTE = 'data-dsh-process-preview'

const ASSISTANT_ROW_SELECTOR = "[data-chat-flow-kind='assistant-step']"
const THINK_SELECTOR = "[data-variant='think']"
const MEANINGFUL_MEDIA_SELECTOR = 'img, video, audio, canvas, iframe, object, embed'
const PROCESS_CANDIDATE_SELECTOR = [
  "[data-chat-flow-kind='tool-call']",
  "[data-chat-flow-kind='context']",
  "[data-chat-flow-kind='compaction']",
  "[data-chat-flow-kind='manual-compaction']",
  "[data-chat-flow-kind='model-retry']",
  "[data-chat-flow-kind='workflow-run']",
  `${ASSISTANT_ROW_SELECTOR} ${THINK_SELECTOR}`,
].join(',')

function normalizedText(value: string | null): string {
  return (value ?? '').replace(/\s+/gu, ' ').trim()
}

function processSummary(candidate: HTMLElement): string {
  const row = candidate.matches('[data-disclosure-row]')
    ? candidate
    : candidate.querySelector<HTMLElement>('[data-disclosure-row]')
      ?? candidate.querySelector<HTMLElement>('button')
  if (row !== null) {
    const parts = Array.from(row.children, child => normalizedText(child.textContent)).filter(Boolean)
    if (parts.length > 0) return parts.join(' · ')
  }
  return normalizedText(candidate.textContent).slice(0, 300)
}

function latestProcessCandidate(flow: HTMLElement): HTMLElement | null {
  const users = flow.querySelectorAll<HTMLElement>("[data-chat-flow-kind='user']")
  const latestUser = users.item(users.length - 1)
  const candidates = Array.from(flow.querySelectorAll<HTMLElement>(PROCESS_CANDIDATE_SELECTOR))
  return candidates.findLast(candidate => latestUser === null
    || Boolean(latestUser.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING)) ?? null
}

function syncProcessPreviews(): void {
  for (const flow of document.querySelectorAll<HTMLElement>('[data-chat-flow]')) {
    const children = Array.from(flow.children)
    const status = children.find((child): child is HTMLElement => child instanceof HTMLElement
      && child.getAttribute('role') === 'status'
      && !child.hasAttribute(PROCESS_PREVIEW_ATTRIBUTE))
    const existing = children.find((child): child is HTMLElement => child instanceof HTMLElement
      && child.hasAttribute(PROCESS_PREVIEW_ATTRIBUTE))
    if (status === undefined) {
      existing?.remove()
      continue
    }

    const text = processSummary(latestProcessCandidate(flow) ?? status)
    const preview = existing ?? document.createElement('div')
    if (existing === undefined) {
      preview.setAttribute(PROCESS_PREVIEW_ATTRIBUTE, '')
      preview.setAttribute('role', 'status')
      preview.setAttribute('aria-live', 'polite')
      preview.innerHTML = '<span class="dsh-process-preview__spinner" aria-hidden="true"></span><span class="dsh-process-preview__text"></span>'
    }
    const label = preview.querySelector<HTMLElement>('.dsh-process-preview__text')
    if (label !== null && label.textContent !== text) label.textContent = text
    if (preview.nextSibling !== status) status.before(preview)
  }
}

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

function clearDocumentMarkers(): void {
  for (const row of document.querySelectorAll<HTMLElement>(`[${PROCESS_ONLY_ASSISTANT_ATTRIBUTE}]`)) {
    row.removeAttribute(PROCESS_ONLY_ASSISTANT_ATTRIBUTE)
  }
  for (const preview of document.querySelectorAll<HTMLElement>(`[${PROCESS_PREVIEW_ATTRIBUTE}]`)) preview.remove()
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
      if (!disposed) {
        markProcessOnlyAssistantRows()
        syncProcessPreviews()
      }
    })
  }
  const observer = new MutationObserver(classify)
  observer.observe(document.body, { childList: true, characterData: true, subtree: true })
  markProcessOnlyAssistantRows()
  syncProcessPreviews()
  classify()
  return () => {
    disposed = true
    observer.disconnect()
    document.documentElement.removeAttribute(PROCESS_DETAILS_HIDDEN_ATTRIBUTE)
    clearDocumentMarkers()
  }
}
