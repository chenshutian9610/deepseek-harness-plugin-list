import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import {
  loadOptionalPatches,
  loadOverlayPatches,
  readProfileManifest,
  resolveProfileDir,
} from '@deepseek-ai/dsh-app-boot'
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'

const EXCLUDED_BUNDLES = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
const SUPERSEDED_BUNDLES = new Set(['dsh-project-mcp'])

function rowsById(entries) {
  const rows = new Map()
  const visit = list => {
    for (const entry of list) {
      if (entry.id) rows.set(entry.id, entry)
      if (entry.group && Array.isArray(entry.config)) visit(entry.config)
    }
  }
  visit(entries)
  return rows
}

function withoutUndefined(value) {
  if (Array.isArray(value)) return value.map(withoutUndefined)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .map(([key, item]) => [key, withoutUndefined(item)]))
}

function replacementPatch(existing, desired) {
  if (existing.name !== desired.name) {
    throw new Error(`deepseek-harness-web: profile insert id ${JSON.stringify(desired.id)} conflicts with ${JSON.stringify(existing.name)} (got ${JSON.stringify(desired.name)})`)
  }
  const reset = Object.fromEntries(Object.keys(existing)
    .filter(key => key !== 'id' && key !== 'name' && !(key in desired))
    .map(key => [key, undefined]))
  return { id: desired.id, name: desired.name, ...reset, ...desired }
}

export function dedupeProfilePatches(entries, patches) {
  let state = structuredClone(entries)
  const result = []
  const apply = patch => {
    result.push(patch)
    state = applyEntryPatches(state, [patch], () => {})
  }

  for (const patch of patches) {
    if (!patch.insert) {
      apply(patch)
      continue
    }
    for (const entry of patch.insert) {
      const existing = rowsById(state).get(entry.id)
      if (existing === undefined) {
        apply({ ...(patch.id === undefined ? {} : { id: patch.id }), insert: [entry] })
      } else if (!isDeepStrictEqual(withoutUndefined(existing), withoutUndefined(entry))) {
        apply(replacementPatch(existing, entry))
      }
    }
  }
  return result
}

function packageName(specifier) {
  if (typeof specifier !== 'string' || specifier.startsWith('.') || specifier.startsWith('cordis:') || specifier.startsWith('node:') || isAbsolute(specifier)) return
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function insertedPackageNames(patches) {
  const names = new Set()
  const visit = entries => {
    for (const entry of entries) {
      const name = packageName(entry.name)
      if (name) names.add(name)
      if (entry.group && Array.isArray(entry.config)) visit(entry.config)
    }
  }
  for (const patch of patches) if (patch.insert) visit(patch.insert)
  return names
}

function bridgePackage(installAnchor, profileDir, appPackages, name, knownDir) {
  if (appPackages.has(name)) return
  const target = knownDir ?? join(profileDir, 'node_modules', name)
  if (!existsSync(join(target, 'package.json'))) return
  const link = join(dirname(installAnchor), 'node_modules', name)
  mkdirSync(dirname(link), { recursive: true })
  try {
    const stat = lstatSync(link)
    if (!stat.isSymbolicLink()) return
    try {
      if (realpathSync(link) === realpathSync(target)) return
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    unlinkSync(link)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
}

function loadLocalBundleLayers(binName, packagesDir) {
  if (!packagesDir) return []
  const root = resolve(packagesDir)
  if (!existsSync(root)) throw new Error(`${binName}: local plugins directory does not exist: ${root}`)

  const layers = []
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name)
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (SUPERSEDED_BUNDLES.has(manifest.name)) continue
    const bundle = manifest.dsh?.bundle
    if (!bundle?.patch) continue
    if (manifest.main && !existsSync(join(dir, manifest.main))) {
      throw new Error(`${binName}: local bundle ${JSON.stringify(manifest.name)} is not built; run 'npm run bootstrap' from the repository root`)
    }
    layers.push({
      name: manifest.name,
      dir,
      patches: loadOverlayPatches(binName, join(dir, bundle.patch)),
    })
  }
  return layers
}

export function loadWebProfilePatches({
  binName = 'deepseek-harness-web',
  configPath,
  installAnchor,
  home,
  localPackagesDir,
} = {}) {
  const profileDir = resolveProfileDir('web', home)
  const profileAnchor = join(profileDir, 'package.json')
  const localLayers = loadLocalBundleLayers(binName, localPackagesDir)
  const localNames = new Set(localLayers.map(layer => layer.name))
  const profileLayers = []

  if (existsSync(profileAnchor)) {
    const manifest = readProfileManifest(binName, profileDir)
    for (const name of manifest.dsh?.profile?.bundles ?? []) {
      if (EXCLUDED_BUNDLES.has(name) || SUPERSEDED_BUNDLES.has(name) || localNames.has(name)) continue
      const dir = join(profileDir, 'node_modules', name)
      if (!existsSync(join(dir, 'package.json'))) {
        throw new Error(`${binName}: cannot resolve profile bundle ${JSON.stringify(name)} from ${profileDir}; run 'dsh plugin --profile web install'`)
      }
      const bundle = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dsh?.bundle
      if (bundle?.patch === undefined) throw new Error(`${binName}: profile bundle ${JSON.stringify(name)} declares no dsh.bundle`)
      profileLayers.push({ name, dir, patches: loadOverlayPatches(binName, join(dir, bundle.patch)) })
    }
  }

  const layers = [...localLayers, ...profileLayers]
  const bundlePatches = layers.flatMap(layer => layer.patches)
  const baseEntries = loadOverlayPatches(binName, configPath)
  const afterBundles = applyEntryPatches(baseEntries, bundlePatches, () => {})
  const userPatches = existsSync(profileAnchor)
    ? dedupeProfilePatches(
        afterBundles,
        loadOptionalPatches(binName, join(profileDir, 'cordis.patch.yml')) ?? [],
      )
    : []
  const patches = [...bundlePatches, ...userPatches]

  const appManifest = JSON.parse(readFileSync(installAnchor, 'utf8'))
  const appPackages = new Set([
    ...Object.keys(appManifest.dependencies ?? {}),
    ...Object.keys(appManifest.peerDependencies ?? {}),
  ])
  const knownDirs = new Map(layers.map(layer => [layer.name, layer.dir]))
  for (const name of new Set([...knownDirs.keys(), ...insertedPackageNames(patches)])) {
    bridgePackage(installAnchor, profileDir, appPackages, name, knownDirs.get(name))
  }
  return patches
}
