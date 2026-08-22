import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { ReadOnlySessionGuard } from '../src/client/ReadOnlySessionGuard.tsx'

describe('read-only session guard', () => {
  it('blocks the composer and disables every composer button', () => {
    document.body.innerHTML = '<div data-composer-card><textarea></textarea><button>model</button><button disabled>send</button></div>'
    const setComposerBlock = vi.fn()
    const useProjection = (() => true) as never

    const Guard = ReadOnlySessionGuard as unknown as (props: {
      useProjection: typeof useProjection
      setComposerBlock: typeof setComposerBlock
      t: (key: string) => string
    }) => ReactNode
    const view = render(<Guard
      useProjection={useProjection}
      setComposerBlock={setComposerBlock}
      t={(key: string) => key}
    />)

    expect(setComposerBlock).toHaveBeenCalledWith('readonly.composer')
    expect(document.documentElement.hasAttribute('data-dsh-readonly-session')).toBe(true)
    expect([...document.querySelectorAll<HTMLButtonElement>('[data-composer-card] button')].every(button => button.disabled)).toBe(true)
    expect(view.getByRole('status').textContent).toBe('readonly.badge')

    view.unmount()
    expect(setComposerBlock).toHaveBeenLastCalledWith(undefined)
    expect(document.documentElement.hasAttribute('data-dsh-readonly-session')).toBe(false)
    const buttons = document.querySelectorAll<HTMLButtonElement>('[data-composer-card] button')
    expect(buttons[0]?.disabled).toBe(false)
    expect(buttons[1]?.disabled).toBe(true)
  })
})
