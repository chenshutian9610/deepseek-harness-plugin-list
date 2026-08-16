/** Host half of the chat-process visibility plugin. */
import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name. */
export const name = 'chat-process-visibility'

/** The Host half is intentionally empty; the package contributes its browser half through dsh.client. */
export function apply(_ctx: Context): void {}
