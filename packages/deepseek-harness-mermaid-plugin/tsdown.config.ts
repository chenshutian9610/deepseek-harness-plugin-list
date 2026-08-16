import { defineConfig } from 'tsdown'

const PACKAGE = 'dsh-web-mermaid'

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
    sourcemap: false,
    minify: true,
    clean: false,
    deps: {
      alwaysBundle: [/.*/],
      onlyBundle: [/.*/],
    },
    outputOptions: {
      // Harness serves one client.js per plugin; Mermaid's lazy diagram imports must stay inside it.
      codeSplitting: false,
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
