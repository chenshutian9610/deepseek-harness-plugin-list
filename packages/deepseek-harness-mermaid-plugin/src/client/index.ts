/** Browser half: render finalized Mermaid fences without replacing Harness's Markdown renderer. */
import type { Context } from '@deepseek-ai/cordis'
import mermaid from 'mermaid'

const CODE_BLOCK_SELECTOR = '.md-code-block'
const ICON_FULLSCREEN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.59 12.34 6.59 8.34 7.66 9.41 3.66 13.41H8v1.4H3.05a1.86 1.86 0 0 1-1.86-1.86V8h1.4v4.34ZM12.95 1.19c1.03 0 1.86.84 1.86 1.86V8h-1.4V3.66L9.41 7.66 8.34 6.59l4-4H8v-1.4h4.95Z"/></svg>'
const ICON_DOWNLOAD = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m15.37 11.41-.25 1.48a2.94 2.94 0 0 1-2.9 2.45H3.78a2.94 2.94 0 0 1-2.9-2.45l-.25-1.48 1.42-.24.25 1.48c.12.72.74 1.25 1.48 1.25h8.44c.74 0 1.36-.53 1.48-1.25l.25-1.48 1.42.24ZM8.72 8.99l3.76-3.76 1.02 1.03-3.58 3.58c-.28.28-.53.53-.76.72-.24.19-.52.36-.87.42a1.82 1.82 0 0 1-.58 0c-.35-.06-.63-.23-.87-.42-.23-.19-.48-.44-.76-.72L2.5 6.26l1.02-1.03 3.76 3.76V1.31h1.44v7.68Z"/></svg>'
const ICON_CLOSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m14.12 13.2-.92.92L1.88 2.8l.92-.92L14.12 13.2Zm-.92-11.32.92.92L2.8 14.12l-.92-.92L13.2 1.88Z"/></svg>'
const STYLE = `
[data-dsh-web-mermaid] {
  max-width: 100%;
  margin: 16px 0;
  overflow: hidden;
  border-radius: 12px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-markdown-code-block);
}
[data-dsh-web-mermaid-banner],
[data-dsh-web-mermaid-preview-header] {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
[data-dsh-web-mermaid-banner] {
  gap: 12px;
  padding: 7px 10px 7px 14px;
  background: var(--dsw-alias-markdown-code-block-banner);
}
[data-dsh-web-mermaid-language] {
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  line-height: 18px;
}
[data-dsh-web-mermaid-actions],
[data-dsh-web-mermaid-preview-actions] {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
}
[data-dsh-web-mermaid-action],
[data-dsh-web-mermaid-preview-actions] > button {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  cursor: pointer;
}
[data-dsh-web-mermaid-action] > svg,
[data-dsh-web-mermaid-preview-actions] svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
}
[data-dsh-web-mermaid-preview-actions] > button[data-zoom] {
  font: 20px/1 sans-serif;
}
[data-dsh-web-mermaid-preview-actions] > button[data-zoom] > span {
  display: block;
}
[data-dsh-web-mermaid-preview-actions] > button[data-zoom="0.25"] > span {
  transform: translateY(-1px);
}
[data-dsh-web-mermaid-action]:hover,
[data-dsh-web-mermaid-preview-actions] > button:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
[data-dsh-web-mermaid-action]:focus-visible,
[data-dsh-web-mermaid-preview-actions] > button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
[data-dsh-web-mermaid-preview-actions] > button:disabled {
  cursor: default;
  opacity: 0.35;
}
[data-dsh-web-mermaid-diagram],
[data-dsh-web-mermaid-preview-body] {
  background: #fff;
}
[data-dsh-web-mermaid-diagram] {
  padding: 16px;
  overflow: auto;
}
[data-dsh-web-mermaid-diagram] > img,
[data-dsh-web-mermaid-preview-body] > img {
  display: block;
  width: 100%;
  height: auto;
  margin: auto;
}
[data-dsh-web-mermaid-diagram] > img {
  max-width: 100%;
}
[data-dsh-web-mermaid-preview-root] {
  position: fixed;
  box-sizing: border-box;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
[data-dsh-web-mermaid-preview-mask] {
  position: absolute;
  inset: 0;
  background: var(--dsw-alias-bg-mask-1);
  backdrop-filter: var(--dsw-mask-blur);
}
[data-dsh-web-mermaid-preview-dialog] {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: min(1600px, 100%);
  height: calc(100vh - 48px);
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-inverted);
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--dsw-shadow-lv3);
}
[data-dsh-web-mermaid-preview-header] {
  flex: none;
  padding: 10px 12px 10px 20px;
  font-size: 14px;
  line-height: 22px;
}
[data-dsh-web-mermaid-preview-body] {
  flex: 1;
  min-height: 0;
  padding: 24px;
  overflow: auto;
}
`

interface RenderedDiagram {
  readonly source: string
  readonly element: HTMLDivElement
  readonly wasHidden: HTMLElement['hidden']
}

interface PreviewDialog {
  readonly element: HTMLDivElement
  readonly opener: HTMLButtonElement
  readonly onKeyDown: (event: KeyboardEvent) => void
}

function mermaidSource(block: HTMLElement): string | undefined {
  const language = block.firstElementChild?.firstElementChild?.firstElementChild?.textContent
    ?.trim().toLowerCase()
  if (language !== 'mermaid') return undefined
  const source = block.querySelector('pre code')?.textContent
  return source?.trim() === '' ? undefined : source
}

/** Cordis plugin name. */
export const name = 'web-mermaid-client'

/** Install finalized-fence discovery and Mermaid rendering for the current page. */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: 'neutral',
    })

    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-web-mermaid'
    style.textContent = STYLE
    document.head.append(style)

    const rendered = new Map<HTMLElement, RenderedDiagram>()
    const pending = new WeakMap<HTMLElement, string>()
    let active = true
    let nextId = 0
    let queue: Promise<void> = Promise.resolve()
    let preview: PreviewDialog | undefined

    const closePreview = (): void => {
      if (preview === undefined) return
      const current = preview
      preview = undefined
      document.removeEventListener('keydown', current.onKeyDown)
      current.element.remove()
      if (active && current.opener.isConnected) current.opener.focus()
    }

    const showPreview = (imageUrl: string, opener: HTMLButtonElement): void => {
      closePreview()
      const root = document.createElement('div')
      root.dataset.dshWebMermaidPreviewRoot = ''
      root.setAttribute('role', 'presentation')
      root.innerHTML = `
        <div data-dsh-web-mermaid-preview-mask aria-hidden="true"></div>
        <div data-dsh-web-mermaid-preview-dialog role="dialog" aria-modal="true" aria-label="放大预览">
          <div data-dsh-web-mermaid-preview-header>
            <span>Mermaid</span>
            <div data-dsh-web-mermaid-preview-actions role="group" aria-label="Mermaid 预览操作">
              <button type="button" data-zoom="-0.25" aria-label="缩小图表"><span aria-hidden="true">−</span></button>
              <button type="button" data-zoom="0.25" aria-label="放大图表"><span aria-hidden="true">+</span></button>
              <button type="button" data-close aria-label="关闭预览">${ICON_CLOSE}</button>
            </div>
          </div>
          <div data-dsh-web-mermaid-preview-body><img alt="Mermaid"></div>
        </div>
      `
      const image = root.querySelector<HTMLImageElement>('img') as HTMLImageElement
      const zoomOut = root.querySelector<HTMLButtonElement>('[data-zoom="-0.25"]') as HTMLButtonElement
      const zoomIn = root.querySelector<HTMLButtonElement>('[data-zoom="0.25"]') as HTMLButtonElement
      const close = root.querySelector<HTMLButtonElement>('[data-close]') as HTMLButtonElement
      image.src = imageUrl
      let zoom = 1

      root.addEventListener('click', (event) => {
        const button = event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>('button')
          : null
        if (button?.hasAttribute('data-close') === true) {
          closePreview()
          return
        }
        if (button?.dataset.zoom === undefined) return
        zoom = Math.max(0.5, Math.min(3, zoom + Number(button.dataset.zoom)))
        image.style.width = `${zoom * 100}%`
        zoomOut.disabled = zoom === 0.5
        zoomIn.disabled = zoom === 3
      })
      root.querySelector('[data-dsh-web-mermaid-preview-mask]')?.addEventListener('click', closePreview)
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') closePreview()
      }
      preview = { element: root, opener, onKeyDown }
      document.addEventListener('keydown', onKeyDown)
      document.body.append(root)
      close.focus()
    }

    const clearRendered = (block: HTMLElement): void => {
      const current = rendered.get(block)
      if (current === undefined) return
      if (preview?.opener.closest('[data-dsh-web-mermaid]') === current.element) closePreview()
      current.element.remove()
      block.hidden = current.wasHidden
      rendered.delete(block)
    }

    const renderBlock = (block: HTMLElement): void => {
      const source = mermaidSource(block)
      const current = rendered.get(block)
      if (source === undefined) {
        clearRendered(block)
        return
      }
      if (current?.source === source && current.element.isConnected) return
      if (current !== undefined) clearRendered(block)
      if (pending.get(block) === source) return
      pending.set(block, source)

      const task = queue.then(async () => {
        if (!active || !block.isConnected || mermaidSource(block) !== source) return undefined
        return mermaid.render(`dsh-web-mermaid-${++nextId}`, source)
      })
      queue = task.then(() => undefined, () => undefined)
      void task.then((result) => {
        if (result === undefined || !active || !block.isConnected || mermaidSource(block) !== source) return
        const imageUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`
        const diagram = document.createElement('div')
        diagram.dataset.dshWebMermaid = ''
        diagram.innerHTML = `
          <div data-dsh-web-mermaid-banner>
            <span data-dsh-web-mermaid-language>mermaid</span>
            <div data-dsh-web-mermaid-actions>
              <button type="button" data-dsh-web-mermaid-action="preview" aria-label="放大预览" title="放大预览">${ICON_FULLSCREEN}</button>
              <button type="button" data-dsh-web-mermaid-action="download" aria-label="下载图片" title="下载图片">${ICON_DOWNLOAD}</button>
            </div>
          </div>
          <div data-dsh-web-mermaid-diagram><img alt="Mermaid"></div>
        `
        const image = diagram.querySelector<HTMLImageElement>('img') as HTMLImageElement
        const previewButton = diagram.querySelector<HTMLButtonElement>('[data-dsh-web-mermaid-action="preview"]') as HTMLButtonElement
        const downloadButton = diagram.querySelector<HTMLButtonElement>('[data-dsh-web-mermaid-action="download"]') as HTMLButtonElement
        image.src = imageUrl
        previewButton.addEventListener('click', () => { showPreview(imageUrl, previewButton) })
        downloadButton.addEventListener('click', () => {
          const url = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml;charset=utf-8' }))
          const link = document.createElement('a')
          link.href = url
          link.download = 'mermaid-diagram.svg'
          document.body.append(link)
          link.click()
          link.remove()
          window.setTimeout(() => { URL.revokeObjectURL(url) }, 0)
        })
        const wasHidden = block.hidden
        block.insertAdjacentElement('afterend', diagram)
        block.hidden = true
        rendered.set(block, { source, element: diagram, wasHidden })
      }).catch(() => {
        // Invalid Mermaid remains visible as the original code block.
      }).finally(() => {
        if (pending.get(block) === source) pending.delete(block)
      })
    }

    const scan = (root: ParentNode): void => {
      if (root instanceof HTMLElement && root.matches(CODE_BLOCK_SELECTOR)) renderBlock(root)
      for (const block of root.querySelectorAll<HTMLElement>(CODE_BLOCK_SELECTOR)) renderBlock(block)
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const target = mutation.target instanceof Element
          ? mutation.target
          : mutation.target.parentElement
        const owner = target?.closest<HTMLElement>(CODE_BLOCK_SELECTOR)
        if (owner !== null && owner !== undefined) renderBlock(owner)
        if (mutation.type !== 'childList') continue
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) scan(node)
        }
      }
      for (const block of rendered.keys()) {
        if (!block.isConnected) clearRendered(block)
      }
    })
    observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true })
    scan(document)

    return () => {
      active = false
      observer.disconnect()
      closePreview()
      for (const block of [...rendered.keys()]) clearRendered(block)
      style.remove()
    }
  }, 'web-mermaid: diagrams + preview + download + observer + styles')
}
