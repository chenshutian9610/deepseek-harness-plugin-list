import { useEffect } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { PROCESS_DETAILS_HIDDEN_ATTRIBUTE } from './dom-visibility.ts'
import { NS } from './locales.ts'
import type { createProcessDetailsStore } from './visibility-store.ts'

/** Props composed for the Session Header switch. */
export type ProcessDetailsSwitchProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & PropsStore<ReturnType<typeof createProcessDetailsStore>>

/** Toggle Chat tool-call and reasoning presentation. */
export function ProcessDetailsSwitch({ useStore, actions, t }: ProcessDetailsSwitchProps) {
  const visible = useStore(state => state.visible)
  const action = visible ? t('hide') : t('show')
  useEffect(() => {
    document.documentElement.toggleAttribute(PROCESS_DETAILS_HIDDEN_ATTRIBUTE, !visible)
    return () => { document.documentElement.removeAttribute(PROCESS_DETAILS_HIDDEN_ATTRIBUTE) }
  }, [visible])
  return (
    <button
      type="button"
      className="dsh-process-visibility-switch"
      role="switch"
      aria-checked={visible}
      aria-label={action}
      title={action}
      onClick={() => { actions.setVisible(!visible) }}
    >
      <span className="dsh-process-visibility-switch__label">{t('label')}</span>
      <span className="dsh-process-visibility-switch__track" data-on={visible || undefined} aria-hidden="true">
        <span className="dsh-process-visibility-switch__thumb" />
      </span>
      <span className="dsh-process-visibility-switch__status" aria-live="polite">
        {visible ? t('shown') : t('hidden')}
      </span>
    </button>
  )
}
