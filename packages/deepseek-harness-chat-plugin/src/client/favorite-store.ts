import { defineStore, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/** Base persistence key; Harness appends the session id for session-scoped stores. */
export const FAVORITE_STORAGE_KEY = 'dsh.chat.favoriteSessions.v1'
export const FAVORITES_CHANGED_EVENT = 'dsh-chat-favorites-changed'

/** Read one persisted favorite without creating its Session-scoped store. */
export function isFavoriteSession(id: SessionId): boolean {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`${FAVORITE_STORAGE_KEY}.${id}`) ?? 'null')
    return typeof value === 'object' && value !== null
      && (value as { favorite?: unknown }).favorite === true
  } catch {
    return false
  }
}

/** Persist a sidebar favorite toggle and notify the mounted Header control. */
export function setFavoriteSession(id: SessionId, favorite: boolean): void {
  try {
    localStorage.setItem(`${FAVORITE_STORAGE_KEY}.${id}`, JSON.stringify({ favorite }))
  } catch {
    // Storage failures keep the rest of Session navigation usable.
  }
  window.dispatchEvent(new Event(FAVORITES_CHANGED_EVENT))
}

/** Declare the independently persisted favorite state for each session. */
export function createFavoriteStore() {
  return defineStore({
    init: () => ({ favorite: false }),
    persist: FAVORITE_STORAGE_KEY,
    actions: {
      setFavorite: (state, favorite: boolean) => { state.favorite = favorite },
    },
  })
}
