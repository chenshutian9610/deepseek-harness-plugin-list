import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const HARNESS = '/Users/chenshutian/Documents/Code/deepseek-harness'

export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/dsh-client-runtime/client': fileURLToPath(new URL(
        './packages/client/runtime/src/client/index.ts',
        `file://${HARNESS}/`,
      )),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
