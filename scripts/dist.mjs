import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packagesDir = join(root, 'packages')
const webDir = join(packagesDir, 'deepseek-harness-web')
const distDir = join(root, 'dist')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const webManifest = readJson(join(webDir, 'package.json'))
const supportedTargets = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-arm64',
  'win32-x64',
])
const targetArgument = process.argv.find(argument => argument.startsWith('--target='))?.slice('--target='.length)
const target = targetArgument ?? `${process.platform}-${process.arch}`
if (!supportedTargets.has(target)) {
  throw new Error(`unsupported distribution target: ${target}`)
}
const [targetPlatform, targetArch] = target.split('-')
const artifactName = `${webManifest.name}-${webManifest.version}-${target}`
const stagingDir = join(distDir, `.${artifactName}-${process.pid}`)
const packsDir = join(distDir, `.packs-${process.pid}`)
const outputDir = join(distDir, artifactName)
const archivePath = join(distDir, `${artifactName}.tar.gz`)

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function run(command, args, cwd = root, capture = false) {
  console.log(`\n==> ${command} ${args.join(' ')}`)
  return execFileSync(command, args, {
    cwd,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })
}

function copy(source, destination) {
  if (!existsSync(source)) throw new Error(`missing distribution input: ${source}`)
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, { recursive: true })
}

function findPlugins() {
  const plugins = []
  for (const entry of readdirSync(packagesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const dir = join(packagesDir, entry.name)
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = readJson(manifestPath)
    if (!manifest.dsh?.bundle?.patch) continue
    plugins.push({ dir, manifest })
  }
  return plugins
}

function packPlugin(plugin) {
  run(pnpm, ['install', '--frozen-lockfile'], plugin.dir)
  run(pnpm, ['run', 'build'], plugin.dir)
  if (!plugin.manifest.main || !existsSync(join(plugin.dir, plugin.manifest.main))) {
    throw new Error(`plugin ${plugin.manifest.name} did not produce ${plugin.manifest.main}`)
  }

  const output = run(npm, [
    'pack',
    '--ignore-scripts',
    '--json',
    '--pack-destination', packsDir,
    plugin.dir,
  ], root, true)
  const result = JSON.parse(output)[0]
  return join(packsDir, result.filename)
}

function packageDir(rootDir, name) {
  return join(rootDir, 'node_modules', ...name.split('/'))
}

// Extract prebuilt plugin tarballs directly so adding them cannot recalculate or prune the locked Web dependency tree.
function installPlugin(plugin, archive) {
  const extractDir = join(packsDir, `extract-${plugin.manifest.name}`)
  rmSync(extractDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true })
  run('tar', ['-xzf', archive, '-C', extractDir])

  const installed = packageDir(stagingDir, plugin.manifest.name)
  rmSync(installed, { recursive: true, force: true })
  mkdirSync(dirname(installed), { recursive: true })
  renameSync(join(extractDir, 'package'), installed)

  for (const name of Object.keys(plugin.manifest.dependencies ?? {})) {
    const destination = packageDir(stagingDir, name)
    if (existsSync(destination)) continue
    const source = packageDir(plugin.dir, name)
    if (!existsSync(source)) throw new Error(`missing installed dependency ${name} for ${plugin.manifest.name}`)
    copy(realpathSync(source), destination)
  }
}

// npm links the local package to ../lan-auth; materialize it and adjust its only parent import for a movable directory.
function materializeLanAuth() {
  const installed = packageDir(stagingDir, 'deepseek-harness-web-lan-auth')
  if (lstatSync(installed).isSymbolicLink()) {
    rmSync(installed, { recursive: true, force: true })
    copy(join(stagingDir, 'lan-auth'), installed)
  }
  const entry = join(installed, 'index.mjs')
  const source = readFileSync(entry, 'utf8')
  const originalImport = "from '../lan-settings.mjs'"
  if (!source.includes(originalImport)) throw new Error('lan-auth parent import changed; update dist materialization')
  writeFileSync(entry, source.replace(originalImport, "from '../../lan-settings.mjs'"))
}

// node-pty ships every platform in one package even though runtime only loads the current platform/architecture.
function pruneNodePty() {
  const nodePty = join(stagingDir, 'node_modules', 'node-pty')
  const prebuilds = join(nodePty, 'prebuilds')
  const current = join(prebuilds, target)
  if (!existsSync(current)) throw new Error(`node-pty has no prebuild for ${target}`)

  for (const entry of readdirSync(prebuilds, { withFileTypes: true })) {
    if (entry.name !== target) rmSync(join(prebuilds, entry.name), { recursive: true, force: true })
  }
  for (const entry of ['binding.gyp', 'scripts', 'src', 'third_party', 'typings']) {
    rmSync(join(nodePty, entry), { recursive: true, force: true })
  }
  if (targetPlatform === 'darwin') {
    const helper = join(current, 'spawn-helper')
    if (!existsSync(helper)) throw new Error(`node-pty has no spawn helper for ${target}`)
    chmodSync(helper, 0o755)
  }
  if (targetPlatform === 'win32') removeFilesByExtension(current, '.pdb')
}

function removeFilesByExtension(dir, extension) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) removeFilesByExtension(path, extension)
    else if (entry.name.endsWith(extension)) rmSync(path)
  }
}

// Reject source-tree links and load all native/plugin entry points before archiving.
function assertPortable(dir, pluginNames, validateNativeModules) {
  for (const name of pluginNames) {
    const pluginDir = join(dir, 'node_modules', name)
    if (lstatSync(pluginDir).isSymbolicLink()) throw new Error(`plugin package is still linked: ${name}`)
    const manifest = readJson(join(pluginDir, 'package.json'))
    if (!existsSync(join(pluginDir, manifest.main))) throw new Error(`plugin entry is missing: ${name}`)
  }

  const rootPath = realpathSync(dir)
  const visit = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isSymbolicLink()) {
        const targetPath = realpathSync(path)
        const outside = relative(rootPath, targetPath)
        if (outside === '..' || outside.startsWith(`..${sep}`)) {
          throw new Error(`distribution contains an external link: ${path} -> ${targetPath}`)
        }
      } else if (entry.isDirectory()) {
        visit(path)
      }
    }
  }
  visit(dir)

  if (validateNativeModules) run(process.execPath, ['-e', "require('node-pty')"], dir)
  run(process.execPath, [
    '--input-type=module',
    '-e',
    `await Promise.all(${JSON.stringify(pluginNames)}.map(name => import(name)))`,
  ], dir)
}

function directorySize(dir) {
  let bytes = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory() && !entry.isSymbolicLink()) bytes += directorySize(path)
    else bytes += lstatSync(path).size
  }
  return bytes
}

function mib(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

mkdirSync(distDir, { recursive: true })
rmSync(stagingDir, { recursive: true, force: true })
rmSync(packsDir, { recursive: true, force: true })
mkdirSync(stagingDir, { recursive: true })
mkdirSync(packsDir, { recursive: true })

try {
  const plugins = findPlugins()
  const pluginArchives = new Map(plugins.map(plugin => [plugin.manifest.name, packPlugin(plugin)]))

  for (const entry of webManifest.files) copy(join(webDir, entry), join(stagingDir, entry))
  for (const entry of ['package.json', 'package-lock.json', 'README.md']) {
    copy(join(webDir, entry), join(stagingDir, entry))
  }

  run(npm, [
    'ci',
    '--omit=dev',
    '--include=optional',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    `--os=${targetPlatform}`,
    `--cpu=${targetArch}`,
  ], stagingDir)
  for (const plugin of plugins) installPlugin(plugin, pluginArchives.get(plugin.manifest.name))

  materializeLanAuth()
  pruneNodePty()

  writeFileSync(join(stagingDir, 'start.sh'), `#!/bin/sh
set -eu
APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$APP_DIR"
export DSH_LOCAL_PLUGINS_DIR="$APP_DIR/node_modules"
exec node "$APP_DIR/bin.mjs" "$@"
`)
  chmodSync(join(stagingDir, 'start.sh'), 0o755)
  writeFileSync(join(stagingDir, 'start.cmd'), `@echo off\r\nset "APP_DIR=%~dp0"\r\ncd /d "%APP_DIR%"\r\nset "DSH_LOCAL_PLUGINS_DIR=%APP_DIR%node_modules"\r\nnode "%APP_DIR%bin.mjs" %*\r\n`)

  const nativeTargetMatchesHost = target === `${process.platform}-${process.arch}`
  assertPortable(stagingDir, plugins.map(plugin => plugin.manifest.name), nativeTargetMatchesHost)
  if (nativeTargetMatchesHost) run(process.execPath, ['./check.mjs'], stagingDir)
  else console.log(`\n==> 跳过 ${target} 的本机原生模块运行检查`)

  rmSync(outputDir, { recursive: true, force: true })
  rmSync(archivePath, { force: true })
  renameSync(stagingDir, outputDir)
  run('tar', ['-czf', archivePath, artifactName], distDir)

  console.log(`\n完成：${outputDir}`)
  console.log(`文件总大小：${mib(directorySize(outputDir))}`)
  console.log(`压缩包：${archivePath} (${mib(statSync(archivePath).size)})`)
} finally {
  rmSync(stagingDir, { recursive: true, force: true })
  rmSync(packsDir, { recursive: true, force: true })
}
