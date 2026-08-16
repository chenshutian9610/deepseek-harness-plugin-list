import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(process.cwd(), 'src/client/styles.css'), 'utf8')

describe('chat process-detail selectors', () => {
  it('hides internal process rows and Think disclosures without hiding entire Assistant rows', () => {
    for (const kind of [
      'tool-call', 'context', 'compaction', 'manual-compaction', 'model-retry', 'workflow-run',
    ]) expect(css).toContain(`[data-chat-flow-kind='${kind}']`)
    expect(css).toContain('[data-dsh-process-only-assistant]')
    expect(css).toContain("[data-chat-flow-kind='assistant-step'] [data-variant='think']")
    expect(css).not.toMatch(/data-chat-flow-kind='assistant-step'\]\s*\{/)
    expect(css).not.toContain("[data-chat-flow-kind='turn-error']")
    expect(css).not.toContain("[data-chat-flow-kind='turn-max-tokens']")
  })
})
