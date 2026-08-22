import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const targets = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-arm64',
  'win32-x64',
]

for (const target of targets) {
  console.log(`\n${'='.repeat(72)}\n构建 ${target}\n${'='.repeat(72)}`)
  execFileSync(process.execPath, [join(root, 'scripts', 'dist.mjs'), `--target=${target}`], {
    cwd: root,
    stdio: 'inherit',
  })
}

console.log(`\n全部完成：${targets.length} 个系统／架构发行包已输出到 ${join(root, 'dist')}`)
