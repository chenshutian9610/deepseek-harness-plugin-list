import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { decodeStorageRecord, snapshotSessionEvent } from '@deepseek-ai/dsh-session'
import { z } from 'zod'

const CORRUPT_LOG_PREFIX = 'corrupt session log:'
export const READ_ONLY_HISTORY_EVENT = 'deployment/read-only-history'
export const READ_ONLY_HISTORY_PROJECTION = 'readOnlyHistory'

function isCorruptSessionLog(error) {
  return error instanceof Error && error.message.startsWith(CORRUPT_LOG_PREFIX)
}

function eventEnvelope(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.type === 'string'
    && Number.isSafeInteger(value.seq)
    && value.seq >= 0
    && Number.isSafeInteger(value.time)
    && value.time >= 0
}

/**
 * Decode only the contiguous, fully committed conversation prefix from a raw
 * JSONL artifact. Corruption and duplicate branches are never repaired or
 * skipped: the view stops at the last complete turn before the first bad row.
 */
export function readOnlyHistoryPrefix(content) {
  const firstNewline = content.indexOf('\n')
  if (firstNewline < 0) return []

  const events = []
  let lastCompleteTurnLength = 0
  const lines = content.slice(firstNewline + 1).split('\n')

  for (const line of lines) {
    if (line.length === 0) continue

    let decoded
    try {
      decoded = decodeStorageRecord(JSON.parse(line))
    } catch {
      break
    }

    const rowStart = events.length
    let valid = true
    for (const candidate of decoded) {
      if (!eventEnvelope(candidate) || candidate.seq !== events.length) {
        valid = false
        break
      }
      try {
        events.push(snapshotSessionEvent(candidate))
      } catch {
        valid = false
        break
      }
    }
    if (!valid) {
      events.length = rowStart
      break
    }
    if (decoded.some(event => event.type === 'turn/end')) lastCompleteTurnLength = events.length
  }

  return events.slice(0, lastCompleteTurnLength)
}

/**
 * Deployment-owned JSONL backend extension. Normal inspection remains exactly
 * upstream. If and only if a committed log is corrupt, history gets a detached
 * prefix parsed from readRaw(); prepare/load/append remain strict, so the
 * damaged session cannot be resumed or modified through this fallback.
 */
export class ReadOnlyFallbackJsonlSessionPersistence extends JsonlSessionPersistence {
  static inject = ['sessions', 'sessionProjections']

  constructor(ctx, config) {
    super(ctx, config)
    ctx.sessionProjections.register({
      key: READ_ONLY_HISTORY_PROJECTION,
      schema: z.boolean(),
      init: () => false,
      apply: (state, event) => event.type === READ_ONLY_HISTORY_EVENT ? true : state,
      view: state => state,
      stateVersion: 1,
    })
  }

  async inspect(id, signal) {
    try {
      return await super.inspect(id, signal)
    } catch (error) {
      signal?.throwIfAborted()
      if (!isCorruptSessionLog(error)) throw error

      const raw = await this.readRaw(id, signal)
      if (raw === undefined) throw error
      const events = readOnlyHistoryPrefix(raw.content)
      if (events.length === 0) throw error
      events.push(snapshotSessionEvent({
        type: READ_ONLY_HISTORY_EVENT,
        seq: events.length,
        time: Date.now(),
        data: { readOnly: true },
        ignorable: true,
      }))

      console.warn(`[session-persistence-jsonl-readonly] serving read-only history prefix for ${id}: ${error.message}`)
      return { meta: raw.meta, events }
    }
  }
}

export default ReadOnlyFallbackJsonlSessionPersistence
