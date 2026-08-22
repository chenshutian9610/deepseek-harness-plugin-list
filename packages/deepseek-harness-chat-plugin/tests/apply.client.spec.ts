import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { PROCESS_DETAILS_HIDDEN_ATTRIBUTE } from '../src/client/dom-visibility.ts'
import { ProcessDetailsSwitch } from '../src/client/ProcessDetailsSwitch.tsx'
import { ReadOnlySessionGuard } from '../src/client/ReadOnlySessionGuard.tsx'
import { apply, inject } from '../src/client/index.ts'
import { installMemoryStorage } from './storage.ts'

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declaration = declare(slots)
  ctx.provide('locale', {
    register: () => () => {},
    bind: () => (key: string) => key,
  } as never)
  ctx.provide('conversation', {
    blocks: { set: () => {} },
  } as never)
  ctx.provide('sessions', {
    list: {
      getSnapshot: () => ({ ids: [], byId: {}, current: undefined }),
      subscribe: () => () => {},
    },
  } as never)
  ctx.provide('workspaces', {
    list: {
      getSnapshot: () => ({ items: [], archivedSessionIds: [] }),
      subscribe: () => () => {},
    },
  } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, declaration, fiber }
}

describe('chat-process visibility browser plugin', () => {
  beforeEach(() => { installMemoryStorage() })

  it('registers Header utilities and removes every owned resource on disposal', async () => {
    const b = await bench()
    expect(inject).toEqual(['slots', 'locale', 'sessions', 'workspaces', 'conversation'])
    const entries = b.slots.entries('conversation.session.header.utilities')
    expect(entries).toHaveLength(4)
    expect(entries[0]?.component).toBe(ReadOnlySessionGuard)
    expect(entries[0]?.options).toMatchObject({ id: 'chat-readonly-session', order: -20 })
    const entry = entries[1]
    expect(entry?.component).toBe(ProcessDetailsSwitch)
    expect(entry?.options).toMatchObject({ id: 'chat-process-visibility', order: -10 })
    expect(document.querySelectorAll('style[data-plugin="dsh-chat-process-visibility"]')).toHaveLength(1)

    expect(entry?.store).toBeDefined()
    document.documentElement.setAttribute(PROCESS_DETAILS_HIDDEN_ATTRIBUTE, '')

    await b.fiber.dispose()
    expect(b.slots.entries('conversation.session.header.utilities')).toHaveLength(0)
    expect(document.querySelectorAll('style[data-plugin="dsh-chat-process-visibility"]')).toHaveLength(0)
    expect(document.documentElement.hasAttribute(PROCESS_DETAILS_HIDDEN_ATTRIBUTE)).toBe(false)
    b.declaration()
    await b.ctx.fiber.dispose()
  })
})
