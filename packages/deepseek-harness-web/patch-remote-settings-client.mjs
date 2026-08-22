import { readFile, writeFile } from 'node:fs/promises'

const SETTINGS_CLIENT = new URL('./node_modules/@deepseek-ai/dsh-client-ui-settings/lib/client.js', import.meta.url)
const ORIGINAL_GATE = 'connection.isLoopback ? "host" : "memory"'
const PATCHED_GATE = 'connection.isLoopback || globalThis.__DSH_REMOTE_SETTINGS__ === true ? "host" : "memory"'
const EXPECTED_GATES = 2

export function patchRemoteSettingsSource(source) {
  const originalCount = source.split(ORIGINAL_GATE).length - 1
  const patchedCount = source.split(PATCHED_GATE).length - 1
  if (originalCount === 0 && patchedCount === EXPECTED_GATES) return source
  if (originalCount !== EXPECTED_GATES || patchedCount !== 0) {
    throw new Error(`remote settings client patch: expected ${EXPECTED_GATES} unpatched gates, found ${originalCount} unpatched and ${patchedCount} patched`)
  }
  return source.replaceAll(ORIGINAL_GATE, PATCHED_GATE)
}

export async function patchRemoteSettingsClient() {
  const source = await readFile(SETTINGS_CLIENT, 'utf8')
  const patched = patchRemoteSettingsSource(source)
  if (patched === source) return false
  await writeFile(SETTINGS_CLIENT, patched)
  return true
}
