import type { IncomingHttpHeaders } from 'node:http'
import { BlockList } from 'node:net'

/** Fixed same-origin WebSocket endpoint owned by this plugin. */
export const TERMINAL_SOCKET_PATH = '/web-terminal'

/** Validated terminal allocation request carried in the upgrade URL. */
export interface TerminalOpenRequest {
  readonly sessionId: string
  readonly cols: number
  readonly rows: number
}

/** Browser input accepted after the PTY is ready. */
export interface TerminalInputMessage {
  readonly type: 'input'
  readonly data: string
}

const localAddresses = new BlockList()
localAddresses.addSubnet('127.0.0.0', 8, 'ipv4')
localAddresses.addSubnet('10.0.0.0', 8, 'ipv4')
localAddresses.addSubnet('100.64.0.0', 10, 'ipv4')
localAddresses.addSubnet('172.16.0.0', 12, 'ipv4')
localAddresses.addSubnet('192.168.0.0', 16, 'ipv4')
localAddresses.addSubnet('169.254.0.0', 16, 'ipv4')
localAddresses.addSubnet('::1', 128, 'ipv6')
localAddresses.addSubnet('fc00::', 7, 'ipv6')
localAddresses.addSubnet('fe80::', 10, 'ipv6')

function isLocalAddress(value: string): boolean {
  if (value === 'localhost') return true
  const address = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
  return localAddresses.check(address, address.includes(':') ? 'ipv6' : 'ipv4')
}

/**
 * Accept same-origin browser upgrades over loopback, private, or shared addresses.
 * Requiring a literal local address also blocks DNS-rebinding hostnames.
 */
export function isTrustedTerminalUpgrade(headers: IncomingHttpHeaders, remoteAddress: string | undefined): boolean {
  const host = headers.host
  const origin = headers.origin
  if (host === undefined || origin === undefined || remoteAddress === undefined || headers['sec-fetch-site'] === 'cross-site') return false
  try {
    const hostUrl = new URL(`http://${host}`)
    const originUrl = new URL(origin)
    return isLocalAddress(remoteAddress)
      && isLocalAddress(hostUrl.hostname)
      && (originUrl.protocol === 'http:' || originUrl.protocol === 'https:')
      && originUrl.host === hostUrl.host
  } catch {
    return false
  }
}

/** Parse and bound the session identity and initial terminal dimensions. */
export function parseTerminalOpenRequest(
  url: string | undefined,
  maxCols: number,
  maxRows: number,
): TerminalOpenRequest {
  const parsed = new URL(url ?? '', 'http://localhost')
  const sessionId = parsed.searchParams.get('session') ?? ''
  const cols = Number(parsed.searchParams.get('cols'))
  const rows = Number(parsed.searchParams.get('rows'))
  if (sessionId.length === 0 || sessionId.length > 256) throw new Error('invalid session id')
  if (!Number.isSafeInteger(cols) || cols < 2 || cols > maxCols) throw new Error('invalid terminal columns')
  if (!Number.isSafeInteger(rows) || rows < 1 || rows > maxRows) throw new Error('invalid terminal rows')
  return { sessionId, cols, rows }
}

/** Decode one bounded browser-to-PTY message. */
export function parseTerminalInput(value: string, maxInputBytes: number): TerminalInputMessage {
  const parsed: unknown = JSON.parse(value)
  if (parsed === null || typeof parsed !== 'object') throw new Error('invalid terminal message')
  const record = parsed as Record<string, unknown>
  if (record.type !== 'input' || typeof record.data !== 'string') throw new Error('invalid terminal message')
  if (Buffer.byteLength(record.data, 'utf8') > maxInputBytes) throw new Error('terminal input is too large')
  return { type: 'input', data: record.data }
}
