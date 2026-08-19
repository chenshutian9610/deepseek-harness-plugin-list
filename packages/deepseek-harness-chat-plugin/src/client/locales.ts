/** Locale namespace for the chat process-detail switch. */
export const NS = 'chat.processVisibility'

/** Translation keys owned by the plugin. */
export type ProcessVisibilityKey =
  | 'label'
  | 'show'
  | 'hide'
  | 'shown'
  | 'hidden'
  | 'favorite.add'
  | 'favorite.remove'

/** Simplified Chinese dictionary. */
export const zh: Record<ProcessVisibilityKey, string> = {
  label: '过程详情',
  show: '显示工具调用、思考与上下文等过程信息',
  hide: '隐藏工具调用、思考与上下文等过程信息',
  shown: '过程详情已显示',
  hidden: '过程详情已隐藏',
  'favorite.add': '收藏此对话',
  'favorite.remove': '取消收藏此对话',
}

/** English dictionary. */
export const en: Record<ProcessVisibilityKey, string> = {
  label: 'Process details',
  show: 'Show tool calls, reasoning, context, and other process details',
  hide: 'Hide tool calls, reasoning, context, and other process details',
  shown: 'Process details are visible',
  hidden: 'Process details are hidden',
  'favorite.add': 'Favorite this conversation',
  'favorite.remove': 'Remove this conversation from favorites',
}
