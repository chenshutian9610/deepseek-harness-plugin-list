import { useEffect } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'

export type ReadOnlySessionGuardProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & {
    setComposerBlock: (reason: string | undefined) => void
  }

const GUARDED = 'data-dsh-readonly-disabled'

function guardComposerButtons(readOnly: boolean): () => void {
  const sync = (): void => {
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-composer-card] button')) {
      if (readOnly) {
        if (!button.disabled) button.setAttribute(GUARDED, '')
        button.disabled = true
      } else if (button.hasAttribute(GUARDED)) {
        button.removeAttribute(GUARDED)
        button.disabled = false
      }
    }
  }
  sync()
  const observer = new MutationObserver(sync)
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    for (const button of document.querySelectorAll<HTMLButtonElement>(`[${GUARDED}]`)) {
      button.removeAttribute(GUARDED)
      button.disabled = false
    }
  }
}

/** Apply the client-side affordance fence for a corrupt-history projection. */
export function ReadOnlySessionGuard({ useProjection, setComposerBlock, t }: ReadOnlySessionGuardProps) {
  const readOnly = useProjection('readOnlyHistory') === true
  const reason = t('readonly.composer')

  useEffect(() => {
    setComposerBlock(readOnly ? reason : undefined)
    const unguard = guardComposerButtons(readOnly)
    document.documentElement.toggleAttribute('data-dsh-readonly-session', readOnly)
    return () => {
      unguard()
      setComposerBlock(undefined)
      document.documentElement.removeAttribute('data-dsh-readonly-session')
    }
  }, [readOnly, reason, setComposerBlock])

  if (!readOnly) return null
  return <span className="dsh-readonly-badge" role="status">{t('readonly.badge')}</span>
}
