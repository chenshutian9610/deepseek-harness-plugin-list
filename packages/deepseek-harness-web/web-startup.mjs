import { Command } from 'commander'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

export const AUTH_PROXY_HOST = 'dsh-auth.invalid'
export const name = 'web-startup'
export const inject = ['cmdlineArgs']

export function apply(ctx) {
  const program = new Command()
    .name('deepseek-harness-web')
    .description('Serve the DeepSeek Harness browser UI.')
    .helpOption('-h, --help', 'show this help')
    .option('--host <host>', 'bind host (127.0.0.1 or 0.0.0.0)')
    .option('--port <port>', 'listen port; pass 0 to let the OS pick a free one')
    .option('--trusted-host <authority...>', 'legacy explicit authority (no longer required for authenticated same-origin domains)')
    .option('--context-path <path>', 'URL context path; use / to disable the default /dsh prefix', '/dsh')
    .option('--allow-remote-settings', 'allow authenticated trusted LAN clients to manage settings and credentials')

  program.action(() => {
    const options = program.opts()
    if (options.port !== undefined && !/^\d+$/.test(options.port)) {
      program.error(`error: --port must be a number, got ${JSON.stringify(options.port)}`)
    }
    ctx.provide('webStartup', {
      ...(options.host === undefined ? {} : { host: options.host }),
      ...(options.port === undefined ? {} : { port: Number(options.port) }),
      trustedHosts: options.trustedHost ?? [],
      contextPath: options.contextPath,
      authProxyHost: AUTH_PROXY_HOST,
      allowRemoteSettings: options.allowRemoteSettings ?? false,
    })
  })

  parseCmdline(ctx, program)
}

