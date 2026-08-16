import {
  bindProcessDetailsVisibility, markProcessOnlyAssistantRows,
  PROCESS_DETAILS_HIDDEN_ATTRIBUTE, PROCESS_ONLY_ASSISTANT_ATTRIBUTE,
} from '../src/client/dom-visibility.ts'

function assistant(content: string): HTMLElement {
  const row = document.createElement('div')
  row.dataset.chatFlowKind = 'assistant-step'
  row.innerHTML = content
  document.body.appendChild(row)
  return row
}

describe('document process-detail visibility binding', () => {
  afterEach(() => {
    document.body.textContent = ''
    document.documentElement.removeAttribute(PROCESS_DETAILS_HIDDEN_ATTRIBUTE)
  })

  it('classifies Think-only Assistant rows without swallowing ordinary prose', () => {
    const thinkOnly = assistant('<div data-variant="think">internal reasoning</div>')
    const mixed = assistant('<div data-variant="think">internal reasoning</div><p>public answer</p>')
    const empty = assistant('<div><span> </span></div>')
    const image = assistant('<div data-variant="think">internal reasoning</div><img alt="result">')

    markProcessOnlyAssistantRows()

    expect(thinkOnly.hasAttribute(PROCESS_ONLY_ASSISTANT_ATTRIBUTE)).toBe(true)
    expect(empty.hasAttribute(PROCESS_ONLY_ASSISTANT_ATTRIBUTE)).toBe(true)
    expect(mixed.hasAttribute(PROCESS_ONLY_ASSISTANT_ATTRIBUTE)).toBe(false)
    expect(image.hasAttribute(PROCESS_ONLY_ASSISTANT_ATTRIBUTE)).toBe(false)
  })

  it('classifies streamed rows and cleans all attributes on disposal', async () => {
    const dispose = bindProcessDetailsVisibility()
    const streamed = assistant('<div data-variant="think">streamed reasoning</div>')
    await Promise.resolve()
    expect(streamed.hasAttribute(PROCESS_ONLY_ASSISTANT_ATTRIBUTE)).toBe(true)

    document.documentElement.setAttribute(PROCESS_DETAILS_HIDDEN_ATTRIBUTE, '')
    dispose()
    expect(document.documentElement.hasAttribute(PROCESS_DETAILS_HIDDEN_ATTRIBUTE)).toBe(false)
    expect(streamed.hasAttribute(PROCESS_ONLY_ASSISTANT_ATTRIBUTE)).toBe(false)
  })
})
