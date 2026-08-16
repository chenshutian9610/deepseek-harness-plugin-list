import type { ITheme } from '@xterm/xterm'

export type TerminalColorScheme = 'light' | 'dark'

/** xterm colors matching Harness's built-in light and dark base surfaces. */
export const TERMINAL_THEMES = {
  light: {
    background: '#ffffff',
    foreground: '#0f1115',
    cursor: '#0f1115',
    cursorAccent: '#ffffff',
    selectionBackground: 'rgba(65, 118, 230, 0.28)',
  },
  dark: {
    background: '#151517',
    foreground: '#f9fafb',
    cursor: '#f9fafb',
    cursorAccent: '#151517',
    selectionBackground: 'rgba(86, 134, 254, 0.36)',
  },
} satisfies Record<TerminalColorScheme, ITheme>
