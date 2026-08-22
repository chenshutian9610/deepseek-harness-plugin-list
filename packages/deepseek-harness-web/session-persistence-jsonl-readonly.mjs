import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { decodeStorageRecord, snapshotSessionEvent } from '@deepseek-ai/dsh-session'

const CORRUPT_LOG_PREFIX = 'corrupt session log:'

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

      console.warn(`[session-persistence-jsonl-readonly] serving read-only history prefix for ${id}: ${error.message}`)
      return { meta: raw.meta, events }
    }
  }
}

export default ReadOnlyFallbackJsonlSessionPersistence
