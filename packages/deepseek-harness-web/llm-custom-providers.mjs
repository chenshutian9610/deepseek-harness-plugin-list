import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import {
  CallId,
  CONTEXT_WINDOW_EXCEEDED_CODE,
  EMPTY_RESPONSE_CODE,
  INVALID_CREDENTIAL_CODE,
  LlmAdapter,
  LlmError,
  QUOTA_EXCEEDED_CODE,
  ReasoningEffortId,
  RetryPolicySchema,
  assertUsableApiKey,
  attributionHeaders,
  isContextWindowExceededError,
  isQuotaExceededError,
  normalizeApiKey,
  resolveRetryPolicy,
} from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import z from '@deepseek-ai/schemastery'

const NS = settingsNamespace('llm-pi-ai')
const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages']
const EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const MODALITIES = ['text', 'image']
const DEFAULT_CONTEXT_WINDOW = 262_144
const DEFAULT_MAX_TOKENS = 32_768
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000
const MAX_TIMER_DELAY_MS = 2_147_483_647
const LISTABLE_PROTOCOLS = new Set(['openai-completions', 'openai-responses'])
const MAX_DISCOVERY_BYTES = 4 * 1024 * 1024
const CUSTOM_TEMPLATE_PROVIDER = 'custom-provider'

const reasoningEfforts = z.dict(z.union([z.string(), z.const(null)]), z.union(EFFORTS))
const modelProfile = z.object({
  id: z.string().required(),
  name: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  input: z.array(z.union(MODALITIES)),
  reasoningEfforts,
})
const providerProfile = z.object({
  apiKeyEnv: z.string().role('credential-ref'),
  displayName: z.string(),
  api: z.union(PROTOCOLS).required(),
  baseURL: z.string().required(),
  models: z.array(modelProfile).required(),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  defaultMaxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),
  defaultInput: z.array(z.union(MODALITIES)).default(['text']),
  headers: z.dict(z.string()),
  reasoning: z.union(EFFORTS),
  timeoutMs: z.natural(),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  retryPolicy: RetryPolicySchema,
})
export const Config = z.object({ providers: z.dict(providerProfile).default({}) })
export const name = 'llm-pi-ai'
export const inject = ['llm']

function resolveProfiles(providers) {
  if (Array.isArray(providers)) throw new Error('llm-pi-ai: providers must be a dict keyed by provider route')
  const result = new Map()
  for (const [provider, source] of Object.entries(providers ?? {})) {
    if (!/^[a-z][a-z0-9-]*$/.test(provider)) throw new Error(`llm-pi-ai: provider ${JSON.stringify(provider)} must start with a lowercase letter and contain only lowercase letters, digits, or hyphens`)
    if (!PROTOCOLS.includes(source.api)) throw new Error(`llm-pi-ai: provider "${provider}" must name one of: ${PROTOCOLS.join(', ')}`)
    if (typeof source.baseURL !== 'string' || source.baseURL.length === 0) throw new Error(`llm-pi-ai: provider "${provider}" needs a non-empty baseURL`)
    try {
      const url = new URL(source.baseURL)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
    } catch {
      throw new Error(`llm-pi-ai: provider "${provider}" baseURL must be an HTTP(S) URL`)
    }
    if (!Array.isArray(source.models) || source.models.length === 0) throw new Error(`llm-pi-ai: provider "${provider}" needs at least one configured model`)
    if (source.displayName !== undefined && source.displayName.length === 0) throw new Error(`llm-pi-ai: provider "${provider}" has an empty displayName`)
    const defaultInput = [...(source.defaultInput ?? ['text'])]
    if (defaultInput.length === 0) throw new Error(`llm-pi-ai: provider "${provider}" defaultInput must not be empty`)
    const seen = new Set()
    const models = source.models.map(model => {
      if (model.id.length === 0 || seen.has(model.id)) throw new Error(`llm-pi-ai: provider "${provider}" has an empty or duplicate model id ${JSON.stringify(model.id)}`)
      seen.add(model.id)
      if (model.name !== undefined && model.name.length === 0) throw new Error(`llm-pi-ai: provider "${provider}" model "${model.id}" has an empty name`)
      const input = model.input?.length ? [...model.input] : [...defaultInput]
      const efforts = model.reasoningEfforts === undefined || Object.keys(model.reasoningEfforts).length === 0
        ? undefined
        : { ...model.reasoningEfforts }
      return {
        id: model.id,
        name: model.name ?? model.id,
        contextWindow: model.contextWindow ?? source.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
        maxTokens: model.maxTokens ?? source.defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
        input,
        efforts,
      }
    })
    const reasoning = source.reasoning
    if (reasoning !== undefined && models.every(model => !(reasoning in (model.efforts ?? {})))) {
      throw new Error(`llm-pi-ai: provider "${provider}" default reasoning "${reasoning}" is unsupported by every configured model`)
    }
    const streamIdleTimeoutMs = source.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
    if (!Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0 || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
      throw new Error(`llm-pi-ai: provider "${provider}" streamIdleTimeoutMs must be a positive finite timer interval`)
    }
    result.set(provider, {
      provider,
      displayName: source.displayName ?? provider,
      api: source.api,
      baseURL: source.baseURL.replace(/\/+$/, ''),
      models,
      modelMap: new Map(models.map(model => [model.id, model])),
      ...(source.apiKeyEnv === undefined ? {} : { apiKeyEnv: credentialRef(source.apiKeyEnv) }),
      ...(source.headers === undefined ? {} : { headers: { ...source.headers } }),
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(source.timeoutMs === undefined ? {} : { timeoutMs: source.timeoutMs }),
      streamIdleTimeoutMs,
      retryPolicy: resolveRetryPolicy(source.retryPolicy, `llm-pi-ai: provider "${provider}" retryPolicy`),
    })
  }
  return result
}

function assertServiceable(config) {
  resolveProfiles(config.providers)
}

function textOf(blocks) {
  return blocks.map(block => block.type === 'text'
    ? block.text
    : block.type === 'reasoning'
      ? block.text
      : block.type === 'tool-result'
        ? textOf(block.content)
        : '').join('')
}

async function imageData(block, attachments, signal) {
  if (attachments === undefined) throw new LlmError('custom provider image input requires the attachment service', 'UNSUPPORTED_CONTENT')
  const stored = await attachments.readImage(block.attachment, signal)
  return `data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString('base64')}`
}

async function openAIUserContent(blocks, attachments, signal) {
  const content = []
  for (const block of blocks) {
    if (block.type === 'text' && block.text.length > 0) content.push({ type: 'text', text: block.text })
    if (block.type === 'image') content.push({ type: 'image_url', image_url: { url: await imageData(block, attachments, signal) } })
  }
  if (content.every(part => part.type === 'text')) return content.map(part => part.text).join('')
  return content
}

async function chatMessages(options, attachments, signal) {
  const messages = []
  if (options.system !== undefined) messages.push({ role: 'system', content: options.system })
  for (const message of options.messages) {
    if (message.role === 'system') {
      messages.push({ role: 'system', content: textOf(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('')
      const reasoning = message.content.filter(block => block.type === 'reasoning').map(block => block.text).join('')
      const toolCalls = message.content.filter(block => block.type === 'tool-call').map(block => ({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: block.arguments },
      }))
      messages.push({
        role: 'assistant',
        content: text || null,
        ...(reasoning ? { reasoning_content: reasoning } : {}),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      })
      continue
    }
    const ordinary = message.content.filter(block => block.type !== 'tool-result')
    if (ordinary.length > 0) messages.push({ role: 'user', content: await openAIUserContent(ordinary, attachments, signal) })
    for (const block of message.content) if (block.type === 'tool-result') {
      messages.push({ role: 'tool', tool_call_id: block.toolCallId, content: textOf(block.content) || '(no output)' })
    }
  }
  return messages
}

async function responsesInput(options, attachments, signal) {
  const input = []
  for (const message of options.messages) {
    if (message.role === 'system') {
      input.push({ role: 'system', content: textOf(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('')
      if (text) input.push({ role: 'assistant', content: text })
      for (const block of message.content) if (block.type === 'tool-call') {
        input.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: block.arguments })
      }
      continue
    }
    const ordinary = message.content.filter(block => block.type !== 'tool-result')
    if (ordinary.length > 0) {
      const content = []
      for (const block of ordinary) {
        if (block.type === 'text' && block.text.length > 0) content.push({ type: 'input_text', text: block.text })
        if (block.type === 'image') content.push({ type: 'input_image', detail: 'auto', image_url: await imageData(block, attachments, signal) })
      }
      if (content.length) input.push({ role: 'user', content })
    }
    for (const block of message.content) if (block.type === 'tool-result') {
      input.push({ type: 'function_call_output', call_id: block.toolCallId, output: textOf(block.content) || '(no output)' })
    }
  }
  return input
}

function anthropicReplay(message, index) {
  const state = message.source?.kind === 'model' ? message.source.replayState : undefined
  if (state?.kind !== 'custom-anthropic' || state.version !== 1 || typeof state.reasoning !== 'object' || state.reasoning === null) return undefined
  return state.reasoning[index]
}

async function anthropicContent(blocks, attachments, signal) {
  const content = []
  for (const block of blocks) {
    if (block.type === 'text' && block.text.length > 0) content.push({ type: 'text', text: block.text })
    if (block.type === 'image') {
      const url = await imageData(block, attachments, signal)
      const match = /^data:([^;]+);base64,(.*)$/.exec(url)
      content.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } })
    }
  }
  return content
}

function pushAnthropic(messages, role, content) {
  if (content.length === 0) return
  const last = messages.at(-1)
  if (last?.role === role) last.content.push(...content)
  else messages.push({ role, content })
}

async function anthropicMessages(options, attachments, signal) {
  const messages = []
  const system = [options.system]
  for (const message of options.messages) {
    if (message.role === 'system') {
      system.push(textOf(message.content))
      continue
    }
    if (message.role === 'assistant') {
      const content = []
      for (const [index, block] of message.content.entries()) {
        if (block.type === 'text' && block.text.length > 0) content.push({ type: 'text', text: block.text })
        if (block.type === 'reasoning') {
          const replay = anthropicReplay(message, index)
          if (typeof replay?.signature === 'string') content.push({ type: 'thinking', thinking: block.text, signature: replay.signature })
          else if (typeof replay?.redacted === 'string') content.push({ type: 'redacted_thinking', data: replay.redacted })
        }
        if (block.type === 'tool-call') content.push({ type: 'tool_use', id: block.id, name: block.name, input: parseArguments(block.arguments) })
      }
      pushAnthropic(messages, 'assistant', content)
      continue
    }
    const content = await anthropicContent(message.content.filter(block => block.type !== 'tool-result'), attachments, signal)
    for (const block of message.content) if (block.type === 'tool-result') {
      content.push({
        type: 'tool_result',
        tool_use_id: block.toolCallId,
        is_error: block.isError ?? false,
        content: await anthropicContent(block.content, attachments, signal),
      })
    }
    pushAnthropic(messages, 'user', content)
  }
  return { system: system.filter(Boolean).join('\n\n'), messages }
}

function parseArguments(raw) {
  try {
    const value = JSON.parse(raw)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

class ChunkAssembler {
  blocks = new Map()
  order = []
  nextIndex = 0

  start(key, type, initial = {}) {
    let block = this.blocks.get(key)
    if (block !== undefined) return { block, chunks: [] }
    block = { key, type, index: this.nextIndex++, text: '', arguments: '', id: '', name: '', ...initial }
    this.blocks.set(key, block)
    this.order.push(block)
    return { block, chunks: [{ type: 'block-start', index: block.index, blockType: type }] }
  }

  text(key, type, delta) {
    if (!delta) return []
    const { block, chunks } = this.start(key, type)
    block.text += delta
    chunks.push({ type: type === 'reasoning' ? 'reasoning-delta' : 'text-delta', index: block.index, text: delta })
    return chunks
  }

  tool(key, update = {}) {
    const { block, chunks } = this.start(key, 'tool-call', update)
    if (update.id) block.id = update.id
    if (update.name) block.name = update.name
    if (update.argumentsDelta) block.arguments += update.argumentsDelta
    if (update.id || update.name || update.argumentsDelta) chunks.push({
      type: 'tool-call-delta',
      index: block.index,
      id: CallId(block.id),
      ...(block.name ? { name: block.name } : {}),
      argumentsDelta: update.argumentsDelta ?? '',
    })
    return chunks
  }

  backfillTool(key, update) {
    const { block, chunks } = this.start(key, 'tool-call', update)
    if (update.id) block.id = update.id
    if (update.name) block.name = update.name
    if (!block.arguments && update.arguments) block.arguments = update.arguments
    return chunks
  }

  closeAll() {
    return this.order.map(block => ({
      type: 'block-end',
      index: block.index,
      block: block.type === 'tool-call'
        ? { type: 'tool-call', id: CallId(block.id), name: block.name, arguments: block.arguments || '{}' }
        : { type: block.type, text: block.text },
    }))
  }

  get hasContent() {
    return this.order.length > 0
  }

  get hasToolCalls() {
    return this.order.some(block => block.type === 'tool-call')
  }
}

function toolsForChat(tools) {
  return tools?.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }))
}

function toolsForResponses(tools) {
  return tools?.map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, strict: false }))
}

function toolsForAnthropic(tools) {
  return tools?.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }))
}

function usage(input, output, cacheRead = 0, cacheWrite = 0, reasoning = 0) {
  return {
    inputTokens: Math.max(0, input - cacheRead - cacheWrite),
    outputTokens: Math.max(0, output - reasoning),
    ...(cacheRead ? { cacheReadTokens: cacheRead } : {}),
    ...(cacheWrite ? { cacheWriteTokens: cacheWrite } : {}),
    ...(reasoning ? { reasoningTokens: reasoning } : {}),
  }
}

function stopReason(reason, hasContent) {
  if (reason === 'tool_calls' || reason === 'function_call' || reason === 'tool_use') return { kind: 'tool-calls' }
  if (reason === 'length' || reason === 'max_tokens' || reason === 'max_output_tokens') return { kind: 'max-tokens' }
  if (!hasContent) return { kind: 'error', failure: { message: 'provider completed with no content', code: EMPTY_RESPONSE_CODE } }
  if (reason === undefined || reason === null || reason === 'stop' || reason === 'end_turn' || reason === 'stop_sequence') return { kind: 'stop' }
  return { kind: 'error', failure: { message: `provider stopped with unsupported reason ${JSON.stringify(reason)}`, code: 'PROVIDER_FINISH' } }
}

function configuredReasoning(profile, model, requested) {
  const effort = requested ?? profile.reasoning
  if (effort === undefined) return {}
  if (!(effort in (model.efforts ?? {}))) throw new LlmError(`provider "${profile.provider}" model "${model.id}" does not support reasoning effort "${effort}"`, 'UNSUPPORTED_REASONING_EFFORT')
  const wire = model.efforts[effort]
  return { effort, ...(wire === null ? {} : { wire }) }
}

function providerFetch(profile, apiKey) {
  const configured = Object.entries(profile.headers ?? {})
  const attribution = Object.entries(attributionHeaders())
  return async (input, init = {}) => {
    const headers = new Headers(init.headers)
    if (apiKey === undefined) {
      headers.delete('authorization')
      headers.delete('x-api-key')
    }
    for (const [key, value] of configured) {
      if (apiKey !== undefined && /^(authorization|x-api-key)$/i.test(key)) continue
      headers.set(key, value)
    }
    for (const [key, value] of attribution) headers.set(key, value)
    return fetch(input, { ...init, headers })
  }
}

function openAIClient(profile, apiKey) {
  return new OpenAI({
    apiKey: apiKey ?? 'unused',
    organization: null,
    project: null,
    webhookSecret: null,
    baseURL: profile.baseURL,
    maxRetries: 0,
    ...(profile.timeoutMs === undefined ? {} : { timeout: profile.timeoutMs }),
    fetch: providerFetch(profile, apiKey),
  })
}

function anthropicClient(profile, apiKey) {
  return new Anthropic({
    apiKey: apiKey ?? 'unused',
    authToken: null,
    baseURL: profile.baseURL,
    maxRetries: 0,
    ...(profile.timeoutMs === undefined ? {} : { timeout: profile.timeoutMs }),
    fetch: providerFetch(profile, apiKey),
  })
}

async function* streamCompletions(profile, model, options, apiKey, attachments, signal) {
  const reasoning = configuredReasoning(profile, model, options.reasoningEffort)
  const stream = await openAIClient(profile, apiKey).chat.completions.create({
    model: model.id,
    messages: await chatMessages(options, attachments, signal),
    stream: true,
    stream_options: { include_usage: true },
    ...(options.tools?.length ? { tools: toolsForChat(options.tools) } : {}),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
    ...(options.stop === undefined ? {} : { stop: options.stop }),
    ...(reasoning.wire === undefined ? {} : { reasoning_effort: reasoning.wire }),
  }, { signal })
  const assembler = new ChunkAssembler()
  let counts = usage(0, 0)
  let finish
  for await (const chunk of stream) {
    if (chunk.usage) {
      const cache = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0
      const thought = chunk.usage.completion_tokens_details?.reasoning_tokens ?? 0
      counts = usage(chunk.usage.prompt_tokens ?? 0, chunk.usage.completion_tokens ?? 0, cache, 0, thought)
    }
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? {}
      for (const value of assembler.text('reasoning', 'reasoning', delta.reasoning_content ?? delta.reasoning ?? '')) yield value
      for (const value of assembler.text('text', 'text', typeof delta.content === 'string' ? delta.content : '')) yield value
      for (const call of delta.tool_calls ?? []) {
        for (const value of assembler.tool(`tool:${call.index}`, {
          id: call.id,
          name: call.function?.name,
          argumentsDelta: call.function?.arguments,
        })) yield value
      }
      if (choice.finish_reason !== null) finish = choice.finish_reason
    }
  }
  yield* assembler.closeAll()
  yield { type: 'usage', usage: counts }
  yield { type: 'finish', reason: stopReason(finish, assembler.hasContent) }
}

async function* streamResponses(profile, model, options, apiKey, attachments, signal) {
  if (options.stop !== undefined) throw new LlmError('openai-responses does not support stop sequences', 'UNSUPPORTED_OPTION')
  const reasoning = configuredReasoning(profile, model, options.reasoningEffort)
  const stream = await openAIClient(profile, apiKey).responses.create({
    model: model.id,
    input: await responsesInput(options, attachments, signal),
    stream: true,
    ...(options.system === undefined ? {} : { instructions: options.system }),
    ...(options.tools?.length ? { tools: toolsForResponses(options.tools) } : {}),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxTokens === undefined ? {} : { max_output_tokens: options.maxTokens }),
    ...(reasoning.wire === undefined ? {} : { reasoning: { effort: reasoning.wire, summary: 'auto' } }),
  }, { signal })
  const assembler = new ChunkAssembler()
  let counts = usage(0, 0)
  let terminal
  for await (const event of stream) {
    if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
      for (const value of assembler.tool(`tool:${event.output_index}`, { id: event.item.call_id, name: event.item.name })) yield value
    } else if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
      for (const value of assembler.text(`text:${event.output_index}:${event.content_index ?? 0}`, 'text', event.delta)) yield value
    } else if (event.type === 'response.reasoning_summary_text.delta') {
      for (const value of assembler.text(`reasoning:${event.output_index}:${event.summary_index}`, 'reasoning', event.delta)) yield value
    } else if (event.type === 'response.reasoning_text.delta') {
      for (const value of assembler.text(`reasoning:${event.output_index}:${event.content_index}`, 'reasoning', event.delta)) yield value
    } else if (event.type === 'response.function_call_arguments.delta') {
      for (const value of assembler.tool(`tool:${event.output_index}`, { argumentsDelta: event.delta })) yield value
    } else if (event.type === 'response.function_call_arguments.done') {
      yield* assembler.backfillTool(`tool:${event.output_index}`, { name: event.name, arguments: event.arguments })
    } else if (event.type === 'response.completed' || event.type === 'response.incomplete' || event.type === 'response.failed') {
      terminal = event
      const raw = event.response?.usage
      if (raw) counts = usage(
        raw.input_tokens ?? 0,
        raw.output_tokens ?? 0,
        raw.input_tokens_details?.cached_tokens ?? 0,
        0,
        raw.output_tokens_details?.reasoning_tokens ?? 0,
      )
    } else if (event.type === 'error') {
      throw new LlmError(event.message ?? 'openai-responses stream error', 'PROVIDER_ERROR')
    }
  }
  yield* assembler.closeAll()
  yield { type: 'usage', usage: counts }
  if (terminal?.type === 'response.failed') {
    const detail = terminal.response?.error?.message ?? 'openai-responses request failed'
    yield { type: 'finish', reason: { kind: 'error', failure: { message: detail, code: 'PROVIDER_ERROR' } } }
    return
  }
  const incomplete = terminal?.type === 'response.incomplete' ? terminal.response?.incomplete_details?.reason : undefined
  yield { type: 'finish', reason: assembler.hasToolCalls && incomplete === undefined
    ? { kind: 'tool-calls' }
    : stopReason(incomplete, assembler.hasContent) }
}

async function* streamAnthropic(profile, model, options, apiKey, attachments, signal) {
  const reasoning = configuredReasoning(profile, model, options.reasoningEffort)
  const converted = await anthropicMessages(options, attachments, signal)
  const params = {
    model: model.id,
    messages: converted.messages,
    max_tokens: options.maxTokens ?? model.maxTokens,
    stream: true,
    ...(converted.system ? { system: converted.system } : {}),
    ...(options.tools?.length ? { tools: toolsForAnthropic(options.tools) } : {}),
    ...(options.stop === undefined ? {} : { stop_sequences: options.stop }),
  }
  if (reasoning.effort === 'off') params.thinking = { type: 'disabled' }
  else if (reasoning.wire !== undefined) {
    params.thinking = { type: 'adaptive' }
    params.output_config = { effort: reasoning.wire }
  } else if (options.temperature !== undefined) params.temperature = options.temperature
  const stream = await anthropicClient(profile, apiKey).messages.create(params, { signal })
  const assembler = new ChunkAssembler()
  const reasoningState = {}
  let input = 0
  let output = 0
  let cacheRead = 0
  let cacheWrite = 0
  let reasoningTokens = 0
  let finish
  const apiBlocks = new Map()
  for await (const event of stream) {
    if (event.type === 'message_start') {
      input = event.message.usage.input_tokens ?? 0
      cacheRead = event.message.usage.cache_read_input_tokens ?? 0
      cacheWrite = event.message.usage.cache_creation_input_tokens ?? 0
    } else if (event.type === 'content_block_start') {
      const block = event.content_block
      if (block.type === 'text') {
        const started = assembler.start(`block:${event.index}`, 'text')
        apiBlocks.set(event.index, started.block)
        yield* started.chunks
        for (const value of assembler.text(`block:${event.index}`, 'text', block.text)) yield value
      } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        const started = assembler.start(`block:${event.index}`, 'reasoning')
        apiBlocks.set(event.index, started.block)
        yield* started.chunks
        if (block.type === 'thinking') for (const value of assembler.text(`block:${event.index}`, 'reasoning', block.thinking)) yield value
        else {
          for (const value of assembler.text(`block:${event.index}`, 'reasoning', '[Reasoning redacted]')) yield value
          reasoningState[started.block.index] = { redacted: block.data }
        }
      } else if (block.type === 'tool_use') {
        const started = assembler.start(`block:${event.index}`, 'tool-call', { id: block.id, name: block.name })
        apiBlocks.set(event.index, started.block)
        yield* started.chunks
      }
    } else if (event.type === 'content_block_delta') {
      const delta = event.delta
      if (delta.type === 'text_delta') for (const value of assembler.text(`block:${event.index}`, 'text', delta.text)) yield value
      if (delta.type === 'thinking_delta') for (const value of assembler.text(`block:${event.index}`, 'reasoning', delta.thinking)) yield value
      if (delta.type === 'input_json_delta') for (const value of assembler.tool(`block:${event.index}`, { argumentsDelta: delta.partial_json })) yield value
      if (delta.type === 'signature_delta') {
        const block = apiBlocks.get(event.index)
        if (block) reasoningState[block.index] = { signature: `${reasoningState[block.index]?.signature ?? ''}${delta.signature}` }
      }
    } else if (event.type === 'message_delta') {
      finish = event.delta.stop_reason
      output = event.usage.output_tokens ?? output
      reasoningTokens = event.usage.output_tokens_details?.thinking_tokens ?? reasoningTokens
    }
  }
  yield* assembler.closeAll()
  yield { type: 'usage', usage: usage(input, output, cacheRead, cacheWrite, reasoningTokens) }
  const reason = stopReason(finish, assembler.hasContent)
  yield {
    type: 'finish',
    reason,
    ...(reason.kind === 'stop' || reason.kind === 'tool-calls'
      ? { replayState: { kind: 'custom-anthropic', version: 1, reasoning: reasoningState } }
      : {}),
  }
}

function classifyError(error) {
  if (error instanceof LlmError) return error
  const status = Number.isInteger(error?.status) ? error.status : undefined
  const message = error instanceof Error ? error.message : String(error)
  let code = 'TRANSPORT'
  if (status === 401 || status === 403) code = 'AUTH'
  else if (status === 429) code = isQuotaExceededError(message) ? QUOTA_EXCEEDED_CODE : 'RATE_LIMIT'
  else if (status === 400) code = isContextWindowExceededError(message) ? CONTEXT_WINDOW_EXCEEDED_CODE : 'INVALID_REQUEST'
  else if (status !== undefined && status >= 500) code = 'SERVER'
  else if (/time(?:d)?\s*out|timeout/i.test(message)) code = 'TIMEOUT'
  return new LlmError(message || 'provider request failed', code, { ...(status === undefined ? {} : { status }), cause: error })
}

export class CustomProviderAdapter extends LlmAdapter {
  constructor(config) {
    super()
    this.config = config
  }

  profile(provider) {
    const profile = this.config.profiles().get(provider)
    if (profile === undefined) throw new LlmError(`custom provider adapter does not own provider "${provider}"`, 'NO_ADAPTER')
    return profile
  }

  model(profile, id) {
    const model = profile.modelMap.get(id)
    if (model === undefined) throw new LlmError(`provider "${profile.provider}" has no configured model "${id}"`, 'UNKNOWN_MODEL')
    return model
  }

  providerInfo(provider) {
    return { id: provider, name: this.profile(provider).displayName }
  }

  providerRetryPolicy(provider) {
    return this.profile(provider).retryPolicy
  }

  async listModels(provider) {
    return this.profile(provider).models.map(model => ({ provider, id: model.id, name: model.name, inputModalities: [...model.input] }))
  }

  async resolveModel(provider, id) {
    const profile = this.profile(provider)
    const model = this.model(profile, id)
    const efforts = Object.keys(model.efforts ?? {})
    return {
      provider,
      id,
      name: model.name,
      inputModalities: [...model.input],
      context: { contextWindow: model.contextWindow },
      defaultMaxTokens: model.maxTokens,
      ...(efforts.length === 0 ? {} : { reasoning: {
        efforts: efforts.map(effort => ({ id: ReasoningEffortId(effort), name: effort.charAt(0).toUpperCase() + effort.slice(1) })),
        ...(profile.reasoning !== undefined && efforts.includes(profile.reasoning) ? { defaultEffort: ReasoningEffortId(profile.reasoning) } : {}),
      } }),
    }
  }

  async *stream(options) {
    const profile = this.profile(options.provider)
    const model = this.model(profile, options.model)
    const containsImage = options.messages.some(message => message.content.some(block => block.type === 'image' || block.type === 'tool-result' && block.content.some(nested => nested.type === 'image')))
    if (containsImage && !model.input.includes('image')) throw new LlmError(`provider "${profile.provider}" model "${model.id}" does not support image input`, 'UNSUPPORTED_CONTENT')
    const apiKey = await this.config.resolveApiKey(profile)
    const attachments = containsImage ? this.config.attachments() : undefined
    const consumer = new AbortController()
    const upstream = options.signal === undefined ? consumer.signal : AbortSignal.any([options.signal, consumer.signal])
    const watchdog = idleWatchdog(upstream, profile.streamIdleTimeoutMs, 'LLM_STREAM_IDLE_TIMEOUT')
    const source = profile.api === 'openai-completions'
      ? streamCompletions(profile, model, options, apiKey, attachments, watchdog.signal)
      : profile.api === 'openai-responses'
        ? streamResponses(profile, model, options, apiKey, attachments, watchdog.signal)
        : streamAnthropic(profile, model, options, apiKey, attachments, watchdog.signal)
    const iterator = source[Symbol.asyncIterator]()
    let exhausted = false
    try {
      for (;;) {
        const result = await watchdog.next(iterator)
        const timeout = timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT')
        if (timeout !== undefined) throw new LlmError(`provider stream idle timeout after ${profile.streamIdleTimeoutMs}ms`, 'TIMEOUT', { cause: timeout })
        if (result.done) {
          exhausted = true
          return
        }
        yield result.value
      }
    } catch (error) {
      if (timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT') !== undefined) throw new LlmError(`provider stream idle timeout after ${profile.streamIdleTimeoutMs}ms`, 'TIMEOUT', { cause: error })
      if (options.signal?.aborted) throw new LlmError('provider request aborted by caller', 'ABORTED', { cause: error })
      throw classifyError(error)
    } finally {
      consumer.abort('custom provider stream stopped')
      watchdog[Symbol.dispose]()
      if (!exhausted) await iterator.return?.().catch(() => {})
    }
  }
}

function usableProbeKey(raw) {
  const checked = normalizeApiKey(raw)
  if (checked.ok) return checked.value
  throw new LlmError(checked.reason === 'empty' ? 'the API key is blank' : 'the API key contains characters no HTTP header can carry', INVALID_CREDENTIAL_CODE)
}

async function readBounded(response, url) {
  const declared = Number(response.headers.get('content-length') ?? NaN)
  if (Number.isFinite(declared) && declared > MAX_DISCOVERY_BYTES) throw new LlmError(`${url} answered with more than ${MAX_DISCOVERY_BYTES} bytes`, 'DISCOVERY_FAILED')
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_DISCOVERY_BYTES) throw new LlmError(`${url} answered with more than ${MAX_DISCOVERY_BYTES} bytes`, 'DISCOVERY_FAILED')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), total))
}

async function discoverModels(request, storedApiKey) {
  if (!LISTABLE_PROTOCOLS.has(request.api)) throw new LlmError(`protocol "${request.api ?? ''}" has no model listing this plugin can read; enter models by hand`, 'DISCOVERY_UNSUPPORTED')
  if (!request.baseURL) throw new LlmError('a custom provider needs baseURL for model discovery', 'DISCOVERY_FAILED')
  const url = `${request.baseURL.replace(/\/+$/, '')}/models`
  const supplied = request.apiKey ?? await storedApiKey(request.provider)
  const apiKey = supplied === undefined ? undefined : usableProbeKey(supplied)
  let response
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json', ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }), ...attributionHeaders() },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
  } catch (error) {
    if (request.signal?.aborted) throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    throw new LlmError(`could not reach ${url}`, 'DISCOVERY_FAILED', { cause: error })
  }
  if (!response.ok) throw new LlmError(`${url} answered ${response.status}${response.status === 401 || response.status === 403 ? '; check the API key' : ''}`, 'DISCOVERY_FAILED', { status: response.status })
  let body
  try {
    body = JSON.parse(await readBounded(response, url))
  } catch (error) {
    if (error instanceof LlmError) throw error
    throw new LlmError(`${url} did not answer with JSON`, 'DISCOVERY_FAILED', { cause: error })
  }
  if (!Array.isArray(body?.data)) throw new LlmError('the endpoint model listing has no "data" array', 'DISCOVERY_FAILED')
  return body.data.flatMap(entry => typeof entry?.id !== 'string' || entry.id.length === 0 ? [] : [{
    id: entry.id,
    ...(typeof entry.name === 'string' && entry.name ? { name: entry.name } : {}),
    ...(Number.isInteger(entry.context_window) && entry.context_window > 0 ? { contextWindow: entry.context_window } : {}),
    ...(Number.isInteger(entry.max_output_tokens) && entry.max_output_tokens > 0 ? { maxTokens: entry.max_output_tokens } : {}),
  }])
}

export function apply(ctx, config) {
  let current = () => config
  let raw
  let memoized
  const profiles = () => {
    const next = current()
    if (next === raw && memoized !== undefined) return memoized
    raw = next
    return memoized = resolveProfiles(next.providers)
  }
  profiles()
  const resolveApiKey = async profile => {
    if (profile.apiKeyEnv === undefined) return undefined
    const credentials = ctx.get('credentials')
    const hit = credentials === undefined
      ? launchEnvironmentOf(ctx).get(profile.apiKeyEnv)?.value
      : (await credentials.resolve(profile.apiKeyEnv))?.value
    if (hit !== undefined && hit.length > 0) return assertUsableApiKey(hit, 'llm-pi-ai', profile.apiKeyEnv)
    throw new LlmError(`llm-pi-ai: no credential for provider "${profile.provider}" at ${profile.apiKeyEnv}`, 'MISSING_CREDENTIAL')
  }
  const adapter = new CustomProviderAdapter({ profiles, resolveApiKey, attachments: () => ctx.get('attachments') })
  let registration
  let registrationFacts
  let directory
  let directoryFacts
  const refresh = () => {
    const entries = new Map([[CUSTOM_TEMPLATE_PROVIDER, {
      provider: CUSTOM_TEMPLATE_PROVIDER,
      displayName: 'Custom Provider',
      settingsNs: NS,
      settingsPath: ['providers', CUSTOM_TEMPLATE_PROVIDER],
      declared: true,
    }]])
    for (const profile of profiles().values()) entries.set(profile.provider, {
      provider: profile.provider,
      displayName: profile.displayName,
      settingsNs: NS,
      settingsPath: ['providers', profile.provider],
      declared: true,
    })
    const directoryEntries = [...entries.values()]
    if (!deepEqualJson(directoryEntries, directoryFacts)) {
      if (directory === undefined) directory = ctx.llm.registerConfigurableProviders(directoryEntries)
      else directory.replace(directoryEntries)
      directoryFacts = directoryEntries
    }
    const facts = [...profiles().values()].map(profile => ({ provider: profile.provider, retryPolicy: profile.retryPolicy }))
    if (!deepEqualJson(facts, registrationFacts)) {
      const routes = facts.map(fact => fact.provider)
      if (registration === undefined) {
        if (routes.length) registration = ctx.llm.registerAdapter(routes, adapter)
      } else registration.replace(routes)
      registrationFacts = facts
    }
  }
  refresh()
  ctx.llm.registerModelDiscovery(NS, request => discoverModels(request, async provider => {
    const profile = provider === undefined ? undefined : profiles().get(provider)
    return profile === undefined ? undefined : resolveApiKey(profile)
  }))
  installSettingsSection(ctx, NS, Config, config, {
    validate: assertServiceable,
    setSource(source) { current = source },
    onChange() { refresh() },
  })
}

export default { name, inject, Config, apply }
