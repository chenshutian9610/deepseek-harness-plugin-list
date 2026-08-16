import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Base persistence key; Harness appends the session id for session-scoped stores. */
export const PROCESS_DETAILS_STORAGE_KEY = 'dsh.chat.processDetails.visible'

/** Declare the independently persisted process-detail preference for each session. */
export function createProcessDetailsStore() {
  return defineStore({
    init: () => ({ visible: true }),
    persist: PROCESS_DETAILS_STORAGE_KEY,
    actions: {
      setVisible: (state, visible: boolean) => { state.visible = visible },
    },
  })
}
