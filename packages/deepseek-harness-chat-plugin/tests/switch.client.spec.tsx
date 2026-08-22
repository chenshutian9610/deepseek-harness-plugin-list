import { useSyncExternalStore } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { PROCESS_DETAILS_HIDDEN_ATTRIBUTE } from '../src/client/dom-visibility.ts'
import type { ProcessDetailsSwitchProps } from '../src/client/ProcessDetailsSwitch.tsx'
import { ProcessDetailsSwitch } from '../src/client/ProcessDetailsSwitch.tsx'
import { zh } from '../src/client/locales.ts'
import { createProcessDetailsStore } from '../src/client/visibility-store.ts'
import { installMemoryStorage } from './storage.ts'

function t(key: keyof typeof zh): string {
  return zh[key]
}

describe('ProcessDetailsSwitch', () => {
  beforeEach(() => { installMemoryStorage() })

  it('renders an accessible switch and toggles the preference', () => {
    const visible = createProcessDetailsStore().create('session-a')
    const useStore = <T,>(selector: (value: { visible: boolean }) => T): T => {
      const value = useSyncExternalStore(visible.subscribe, visible.getSnapshot)
      return selector(value)
    }
    const props = { useStore, actions: visible.actions, t } as unknown as ProcessDetailsSwitchProps

    render(<ProcessDetailsSwitch {...props} />)
    const control = screen.getByRole('switch', { name: zh.show })
    expect(control.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText(zh.hidden)).toBeTruthy()
    expect(document.documentElement.hasAttribute(PROCESS_DETAILS_HIDDEN_ATTRIBUTE)).toBe(true)

    fireEvent.click(control)
    const visibleControl = screen.getByRole('switch', { name: zh.hide })
    expect(visibleControl.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(zh.shown)).toBeTruthy()
    expect(document.documentElement.hasAttribute(PROCESS_DETAILS_HIDDEN_ATTRIBUTE)).toBe(false)
  })
})
