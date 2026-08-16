import { readFile } from 'node:fs/promises'
import { defineConfig } from 'tsdown'

const PACKAGE = 'dsh-web-terminal'
const CSS_PREFIX = '\0dsh-web-terminal-css:'
const CSS_SUFFIX = '.mjs'
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
] as const

const inlineCss = {
  name: 'dsh-web-terminal-inline-css',
  async resolveId(source: string, importer: string | undefined) {
    if (!source.endsWith('.css?inline')) return null
    const resolved = await this.resolve(source.slice(0, -'?inline'.length), importer, { skipSelf: true })
    if (resolved === null) throw new Error(`cannot resolve stylesheet ${source}`)
    return CSS_PREFIX + resolved.id + CSS_SUFFIX
  },
  async load(id: string) {
    if (!id.startsWith(CSS_PREFIX)) return null
    const file = id.slice(CSS_PREFIX.length, -CSS_SUFFIX.length)
    return `export default ${JSON.stringify(await readFile(file, 'utf8'))}`
  },
}

export default defineConfig([
  {
    name: PACKAGE,
    entry: { index: 'src/index.ts' },
    tsconfig: 'tsconfig.host.json',
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
  },
  {
    name: `${PACKAGE}/client`,
    entry: { client: 'src/client/index.ts' },
    tsconfig: 'tsconfig.client.json',
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: [...CLIENT_EXTERNALS],
      alwaysBundle: /^@xterm\//,
      onlyBundle: [/^@xterm\//],
    },
    plugins: [inlineCss],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
