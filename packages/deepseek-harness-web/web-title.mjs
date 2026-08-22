const OFFICIAL_PRODUCT_TITLE = 'DeepSeek Harness'

export const name = 'web-title'
export const inject = ['webServer', 'webStartup']

function serializeInlineScriptString(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
}

export function createTitleBootstrap(productTitle) {
  return `(()=>{const official=${serializeInlineScriptString(OFFICIAL_PRODUCT_TITLE)},product=${serializeInlineScriptString(productTitle)};const project=value=>value===official?product:value.endsWith(" — "+official)?value.slice(0,-official.length)+product:value;const sync=()=>{const next=project(document.title);if(next!==document.title)document.title=next};sync();new MutationObserver(sync).observe(document.querySelector("title")??document.head,{childList:true,subtree:true,characterData:true})})()`
}

export function injectProductTitle(html, productTitle) {
  const bootstrap = createTitleBootstrap(productTitle)
  return html.replace('<head>', `<head><script data-web-product-title>${bootstrap}</script>`)
}

export function apply(ctx) {
  const productTitle = ctx.webStartup.title
  ctx.effect(
    () => ctx.webServer.tapIndex(html => injectProductTitle(html, productTitle)),
    'custom browser product title',
  )
}
