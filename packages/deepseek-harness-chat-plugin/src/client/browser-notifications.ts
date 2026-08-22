import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

export const BROWSER_NOTIFICATIONS_STORAGE_KEY = 'dsh.chat.browserNotifications.v1'
export const BROWSER_NOTIFICATIONS_CHANGED_EVENT = 'dsh-chat-browser-notifications-changed'

export function browserNotificationsSupported(): boolean {
  return 'Notification' in window && window.isSecureContext
}

export function browserNotificationsEnabled(): boolean {
  if (!browserNotificationsSupported() || Notification.permission !== 'granted') return false
  try {
    return localStorage.getItem(BROWSER_NOTIFICATIONS_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function setBrowserNotificationsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(BROWSER_NOTIFICATIONS_STORAGE_KEY, String(enabled))
  } catch {
    // A blocked preference store only makes notification state non-persistent.
  }
  window.dispatchEvent(new Event(BROWSER_NOTIFICATIONS_CHANGED_EVENT))
}

export async function enableBrowserNotifications(): Promise<boolean> {
  if (!browserNotificationsSupported()) return false
  const permission = Notification.permission === 'default'
    ? await Notification.requestPermission()
    : Notification.permission
  const enabled = permission === 'granted'
  setBrowserNotificationsEnabled(enabled)
  return enabled
}

export function notifyReplyCompleted(
  sessionId: SessionId,
  displayTitle: string,
  openSession: (id: SessionId) => void,
): void {
  if (!browserNotificationsEnabled()) return
  if (document.visibilityState === 'visible' && document.hasFocus()) return

  const notification = new Notification('AI 回复完成', {
    body: displayTitle || '未命名会话',
    tag: `dsh-reply-completed-${sessionId}`,
  })
  notification.onclick = () => {
    window.focus()
    openSession(sessionId)
    notification.close()
  }
}
