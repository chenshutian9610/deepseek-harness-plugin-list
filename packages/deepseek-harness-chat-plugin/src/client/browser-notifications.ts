import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

export const BROWSER_NOTIFICATIONS_STORAGE_KEY = 'dsh.chat.browserNotifications.v1'
export const BROWSER_NOTIFICATIONS_CHANGED_EVENT = 'dsh-chat-browser-notifications-changed'

const WORKER_PATH = 'chat-notifications-sw.js'
const OPEN_SESSION_MESSAGE = 'dsh-chat-open-session'
const NOTIFY_REPLY_MESSAGE = 'dsh-chat-notify-reply-completed'

function contextRootUrl(): URL {
  return new URL('./', document.baseURI)
}

export function browserNotificationsSupported(): boolean {
  return 'Notification' in window && 'serviceWorker' in navigator && window.isSecureContext
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

async function notificationWorker(): Promise<ServiceWorkerRegistration> {
  const root = contextRootUrl()
  const script = new URL(WORKER_PATH, root)
  return navigator.serviceWorker.register(script, { scope: root.pathname })
}

export async function enableBrowserNotifications(): Promise<boolean> {
  if (!browserNotificationsSupported()) return false
  const permission = Notification.permission === 'default'
    ? await Notification.requestPermission()
    : Notification.permission
  if (permission !== 'granted') {
    setBrowserNotificationsEnabled(false)
    return false
  }
  try {
    await notificationWorker()
    setBrowserNotificationsEnabled(true)
    return true
  } catch {
    setBrowserNotificationsEnabled(false)
    return false
  }
}

export async function notifyReplyCompleted(
  sessionId: SessionId,
  displayTitle: string,
): Promise<void> {
  if (!browserNotificationsEnabled()) return
  if (document.visibilityState === 'visible' && document.hasFocus()) return

  try {
    const registration = await notificationWorker()
    const worker = registration.active ?? registration.waiting ?? registration.installing
    worker?.postMessage({
      type: NOTIFY_REPLY_MESSAGE,
      title: 'AI 回复完成',
      body: displayTitle || '未命名会话',
      tag: `dsh-reply-completed-${sessionId}`,
      sessionId,
    })
  } catch {
    // A transient registration failure must not affect completion delivery.
  }
}

export function bindNotificationNavigation(openSession: (id: SessionId) => void): () => void {
  if (!('serviceWorker' in navigator)) return () => {}
  const onMessage = (event: MessageEvent<unknown>): void => {
    const message = event.data
    if (typeof message !== 'object' || message === null) return
    const value = message as { type?: unknown; sessionId?: unknown }
    if (value.type !== OPEN_SESSION_MESSAGE || typeof value.sessionId !== 'string') return
    openSession(value.sessionId as SessionId)
  }
  navigator.serviceWorker.addEventListener('message', onMessage)
  return () => { navigator.serviceWorker.removeEventListener('message', onMessage) }
}
