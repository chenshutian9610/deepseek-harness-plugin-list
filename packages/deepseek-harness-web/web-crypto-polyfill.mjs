export const WEB_CRYPTO_POLYFILL = `if(globalThis.crypto&&typeof crypto.randomUUID!=="function"&&typeof crypto.getRandomValues==="function"){Object.defineProperty(crypto,"randomUUID",{configurable:true,value:()=>{const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=bytes[6]&15|64;bytes[8]=bytes[8]&63|128;const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("");return hex.slice(0,8)+"-"+hex.slice(8,12)+"-"+hex.slice(12,16)+"-"+hex.slice(16,20)+"-"+hex.slice(20)}})}`

export const name = 'web-crypto-polyfill'
export const inject = ['webServer']

export function injectWebCryptoPolyfill(html) {
  return html.replace('<head>', `<head><script data-web-crypto-polyfill>${WEB_CRYPTO_POLYFILL}</script>`)
}

export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.tapIndex(injectWebCryptoPolyfill),
    'web crypto compatibility bootstrap',
  )
}
