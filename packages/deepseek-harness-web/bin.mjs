#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { once } from 'node:events'
if (process.env.NODE_USE_ENV_PROXY === undefined && !process.execArgv.includes('--use-env-proxy')) {
  const child = spawn(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  })
  const signals = ['SIGHUP', 'SIGINT', 'SIGTERM']
  const forwardSignal = signal => child.kill(signal)
  for (const signal of signals) process.once(signal, forwardSignal)
  const [code, signal] = await once(child, 'exit')
  for (const signal of signals) process.off(signal, forwardSignal)
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
} else {
  const [
    { fileURLToPath },
    { boot, installFailLoud, loadLayeredEnv },
    { provideCmdline },
    { DSH_LAUNCH_ENVIRONMENT_KEY },
    { loadWebProfilePatches },
    { renderStartupError },
  ] = await Promise.all([
    import('node:url'),
    import('@deepseek-ai/dsh-app-boot'),
    import('@deepseek-ai/dsh-cmdline'),
    import('@deepseek-ai/dsh-launch-environment'),
    import('./profile-config.mjs'),
    import('./startup-diagnostics.mjs'),
  ])
  const name = 'deepseek-harness-web'
  const configPath = fileURLToPath(new URL('./cordis.yml', import.meta.url))
  const installAnchor = fileURLToPath(new URL('./package.json', import.meta.url))
  const moduleBaseUrl = new URL('./', import.meta.url).href
  const environment = loadLayeredEnv(name)
  const profilePatches = loadWebProfilePatches({
    configPath,
    installAnchor,
    localPackagesDir: process.env.DSH_LOCAL_PLUGINS_DIR,
  })
  let ctx
  let stopping

  function stop(code) {
    process.exitCode = code
    return stopping ??= ctx?.fiber.dispose() ?? Promise.resolve()
  }

  process.once('SIGINT', () => void stop(130))
  process.once('SIGTERM', () => void stop(0))
  installFailLoud(name, process, () => stop(1))

  try {
    ctx = await boot(name, configPath, profilePatches, (hostCtx) => {
      ctx = hostCtx
      hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
      provideCmdline(hostCtx, {
        args: process.argv.slice(2),
        exit: code => void stop(code),
      })
    }, moduleBaseUrl)
  } catch (error) {
    process.stderr.write(`${renderStartupError(error)}\n`)
    await stop(1)
  }
}
