import { createInterface } from 'node:readline'

const lines = createInterface({ input: process.stdin })

for await (const line of lines) {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    reply(message.id, {
      protocolVersion: message.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'project-mcp-fixture', version: '1.0.0' },
    })
    continue
  }
  if (message.method === 'notifications/initialized') continue
  if (message.method === 'tools/list') {
    reply(message.id, {
      tools: [{
        name: 'fixture_ping',
        description: 'Returns pong.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      }],
    })
    continue
  }
  if (message.method === 'tools/call') {
    reply(message.id, { content: [{ type: 'text', text: 'pong' }] })
    continue
  }
  if (message.id !== undefined) {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: `Unsupported method: ${message.method}` },
    })}\n`)
  }
}

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}
