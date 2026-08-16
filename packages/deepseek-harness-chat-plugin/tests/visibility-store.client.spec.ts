import { PROCESS_DETAILS_STORAGE_KEY, createProcessDetailsStore } from '../src/client/visibility-store.ts'
import { installMemoryStorage } from './storage.ts'

describe('process-detail visibility store', () => {
  beforeEach(() => { installMemoryStorage() })

  it('defaults to visible and persists independently by session', () => {
    const handle = createProcessDetailsStore()
    const first = handle.create('session-a')
    const second = handle.create('session-b')
    first.actions.setVisible(false)

    expect(first.getSnapshot().visible).toBe(false)
    expect(second.getSnapshot().visible).toBe(true)
    expect(localStorage.getItem(`${PROCESS_DETAILS_STORAGE_KEY}.session-a`)).toBe('{"visible":false}')
    expect(handle.create('session-a').getSnapshot().visible).toBe(false)
  })
})
