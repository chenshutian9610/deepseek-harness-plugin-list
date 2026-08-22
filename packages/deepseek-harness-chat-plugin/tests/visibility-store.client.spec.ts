import { PROCESS_DETAILS_STORAGE_KEY, createProcessDetailsStore } from '../src/client/visibility-store.ts'
import { installMemoryStorage } from './storage.ts'

describe('process-detail visibility store', () => {
  beforeEach(() => { installMemoryStorage() })

  it('defaults to hidden and persists independently by session', () => {
    const handle = createProcessDetailsStore()
    const first = handle.create('session-a')
    const second = handle.create('session-b')
    first.actions.setVisible(true)

    expect(first.getSnapshot().visible).toBe(true)
    expect(second.getSnapshot().visible).toBe(false)
    expect(localStorage.getItem(`${PROCESS_DETAILS_STORAGE_KEY}.session-a`)).toBe('{"visible":true}')
    expect(handle.create('session-a').getSnapshot().visible).toBe(true)
  })
})
