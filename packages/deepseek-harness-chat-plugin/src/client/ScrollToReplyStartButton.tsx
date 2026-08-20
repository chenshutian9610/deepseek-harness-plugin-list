import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'

export type ScrollToReplyStartButtonProps =
  PropsRuntime<'conversation.chat.assistant-actions'>
  & PropsLocale<typeof NS>

/** Scroll from an Assistant reply's footer actions back to that reply's first line. */
export function ScrollToReplyStartButton({ messageId, useSession, t }: ScrollToReplyStartButtonProps) {
  const anchorKey = useSession((snapshot) => {
    for (const key of snapshot.chat.order) {
      const node = snapshot.chat.nodes.get(key)
      if (node?.kind !== 'assistant-step') continue
      const finalNode = (node.data as { finalNode?: { messageId?: unknown } }).finalNode
      if (finalNode?.messageId === messageId) return key
    }
    return undefined
  })
  const label = t('reply.toStart')

  return (
    <button
      type="button"
      className="dsh-chat-reply-start-button"
      aria-label={label}
      title={label}
      data-chat-reply-anchor={anchorKey}
      onClick={() => {
        for (const row of document.querySelectorAll<HTMLElement>('[data-chat-flow-key]')) {
          if (row.dataset.chatFlowKey === anchorKey) {
            const scrollport = row.closest<HTMLElement>('[data-conversation-scroll]')
            if (scrollport === null) row.scrollIntoView({ behavior: 'smooth', block: 'start' })
            else scrollport.scrollTo({
              top: scrollport.scrollTop
                + row.getBoundingClientRect().top
                - scrollport.getBoundingClientRect().top
                - 16,
              behavior: 'smooth',
            })
            break
          }
        }
      }}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none">
        <path d="M8 13V3M4 7l4-4 4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
