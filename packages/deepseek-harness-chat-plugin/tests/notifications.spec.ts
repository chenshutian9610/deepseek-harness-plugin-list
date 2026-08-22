import { runInNewContext } from 'node:vm'
import { NOTIFICATION_WORKER_PATH, NOTIFICATION_WORKER_SOURCE } from '../src/index.ts'

it('ships a scoped notification service worker with click navigation', () => {
  expect(NOTIFICATION_WORKER_PATH).toBe('/chat-notifications-sw.js')
  expect(NOTIFICATION_WORKER_SOURCE).toContain("self.registration.showNotification")
  expect(NOTIFICATION_WORKER_SOURCE).toContain("clients.openWindow(self.registration.scope)")
  expect(NOTIFICATION_WORKER_SOURCE).toContain("type:'dsh-chat-open-session'")

  const listeners = new Map<string, (event: unknown) => void>()
  const self = {
    addEventListener(type: string, listener: (event: unknown) => void) {
      listeners.set(type, listener)
    },
    registration: { showNotification: vi.fn(), scope: 'http://localhost:3081/dsh/' },
  }
  runInNewContext(NOTIFICATION_WORKER_SOURCE, { self, clients: {} })
  expect(listeners.has('message')).toBe(true)
  expect(listeners.has('notificationclick')).toBe(true)
})
