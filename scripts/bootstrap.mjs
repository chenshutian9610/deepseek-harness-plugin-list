import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packagesDir = join(root, 'packages')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

for (const entry of readdirSync(packagesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory()) continue
  const cwd = join(packagesDir, entry.name)
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  } catch {
    continue
  }
  if (!manifest.dsh?.bundle?.patch) continue

  console.log(`\n==> 准备 ${manifest.name}`)
  execFileSync(pnpm, ['install', '--frozen-lockfile'], { cwd, stdio: 'inherit' })
  execFileSync(pnpm, ['run', 'build'], { cwd, stdio: 'inherit' })
}

console.log('\n==> 安装 deepseek-harness-web')
execFileSync(npm, ['ci', '--omit=dev'], {
  cwd: join(packagesDir, 'deepseek-harness-web'),
  stdio: 'inherit',
})
