import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  BROWSER_NOTIFICATIONS_CHANGED_EVENT,
  browserNotificationsEnabled,
  browserNotificationsSupported,
  enableBrowserNotifications,
  setBrowserNotificationsEnabled,
} from './browser-notifications.ts'
import { NS } from './locales.ts'

export type BrowserNotificationsButtonProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>

/** Enable or disable browser notifications when an AI reply finishes in the background. */
export function BrowserNotificationsButton({ t }: BrowserNotificationsButtonProps) {
  const [enabled, setEnabled] = useState(browserNotificationsEnabled)
  const supported = browserNotificationsSupported()

  useEffect(() => {
    const sync = (): void => { setEnabled(browserNotificationsEnabled()) }
    window.addEventListener(BROWSER_NOTIFICATIONS_CHANGED_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(BROWSER_NOTIFICATIONS_CHANGED_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const label = !supported
    ? t('notification.unsupported')
    : enabled ? t('notification.disable') : t('notification.enable')

  return (
    <button
      type="button"
      className="dsh-chat-notification-button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      title={label}
      disabled={!supported}
      onClick={() => {
        if (enabled) setBrowserNotificationsEnabled(false)
        else void enableBrowserNotifications()
      }}
    >
      <span aria-hidden="true">{enabled ? '🔔' : '🔕'}</span>
    </button>
  )
}
