import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isTrustedTerminalUpgrade,
  parseTerminalInput,
  parseTerminalOpenRequest,
} from '../src/host/protocol.ts'

test('accepts only same-origin local-network browser upgrades', () => {
  assert.equal(isTrustedTerminalUpgrade({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }, '127.0.0.1'), true)
  assert.equal(isTrustedTerminalUpgrade({ host: 'localhost:3080', origin: 'http://localhost:3080' }, '::ffff:127.0.0.1'), true)
  assert.equal(isTrustedTerminalUpgrade({ host: '192.168.1.8:3080', origin: 'http://192.168.1.8:3080' }, '192.168.1.20'), true)
  assert.equal(isTrustedTerminalUpgrade({ host: '100.66.0.8:3080', origin: 'http://100.66.0.8:3080' }, '100.66.0.20'), true)
  assert.equal(isTrustedTerminalUpgrade({ host: 'evil.test:3080', origin: 'http://evil.test:3080' }, '127.0.0.1'), false)
  assert.equal(isTrustedTerminalUpgrade({ host: '127.0.0.1:3080', origin: 'http://evil.test' }, '127.0.0.1'), false)
  assert.equal(isTrustedTerminalUpgrade({ host: '127.0.0.1:3080' }, '127.0.0.1'), false)
  assert.equal(isTrustedTerminalUpgrade({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }, '192.0.2.1'), false)
  assert.equal(isTrustedTerminalUpgrade({
    host: '127.0.0.1:3080',
    origin: 'http://127.0.0.1:3080',
    'sec-fetch-site': 'cross-site',
  }, '127.0.0.1'), false)
})

test('bounds terminal allocation and input at the wire boundary', () => {
  assert.deepEqual(
    parseTerminalOpenRequest('/web-terminal?session=s1&cols=120&rows=30', 400, 200),
    { sessionId: 's1', cols: 120, rows: 30 },
  )
  assert.throws(() => parseTerminalOpenRequest('/web-terminal?session=s1&cols=401&rows=30', 400, 200))
  assert.throws(() => parseTerminalOpenRequest('/web-terminal?session=&cols=80&rows=24', 400, 200))
  assert.deepEqual(parseTerminalInput('{"type":"input","data":"你好"}', 6), { type: 'input', data: '你好' })
  assert.throws(() => parseTerminalInput('{"type":"input","data":"你好"}', 5), /too large/)
  assert.throws(() => parseTerminalInput('{"type":"resize","data":"x"}', 10), /invalid/)
})
