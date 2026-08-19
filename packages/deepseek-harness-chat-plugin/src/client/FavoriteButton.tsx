import { useEffect } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import {
  FAVORITES_CHANGED_EVENT, type createFavoriteStore, isFavoriteSession,
} from './favorite-store.ts'
import { NS } from './locales.ts'

/** Props composed for the Session Header favorite button. */
export type FavoriteButtonProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & PropsStore<ReturnType<typeof createFavoriteStore>>

/** Toggle the current conversation's browser-local favorite state. */
export function FavoriteButton({ sessionId, useStore, actions, t }: FavoriteButtonProps) {
  const favorite = useStore(state => state.favorite)
  const label = t(favorite ? 'favorite.remove' : 'favorite.add')
  useEffect(() => { window.dispatchEvent(new Event(FAVORITES_CHANGED_EVENT)) }, [favorite])
  useEffect(() => {
    const sync = (): void => { actions.setFavorite(isFavoriteSession(sessionId)) }
    window.addEventListener(FAVORITES_CHANGED_EVENT, sync)
    return () => { window.removeEventListener(FAVORITES_CHANGED_EVENT, sync) }
  }, [actions, sessionId])
  return (
    <button
      type="button"
      className="dsh-chat-favorite-button"
      aria-pressed={favorite}
      aria-label={label}
      title={label}
      onClick={() => { actions.setFavorite(!favorite) }}
    >
      <span aria-hidden="true">{favorite ? '★' : '☆'}</span>
    </button>
  )
}
