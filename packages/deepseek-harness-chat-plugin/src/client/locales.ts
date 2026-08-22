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
  | 'reply.toStart'
  | 'notification.enable'
  | 'notification.disable'
  | 'notification.unsupported'
  | 'readonly.badge'
  | 'readonly.composer'
  | 'history.loadAll'
  | 'history.loadingAll'

/** Simplified Chinese dictionary. */
export const zh: Record<ProcessVisibilityKey, string> = {
  label: '过程详情',
  show: '显示工具调用、思考与上下文等过程信息',
  hide: '隐藏工具调用、思考与上下文等过程信息',
  shown: '过程详情已显示',
  hidden: '过程详情已隐藏',
  'favorite.add': '收藏此对话',
  'favorite.remove': '取消收藏此对话',
  'reply.toStart': '回到回复开头',
  'notification.enable': '开启 AI 回复完成浏览器通知',
  'notification.disable': '关闭 AI 回复完成浏览器通知',
  'notification.unsupported': '当前浏览器或非安全来源不支持系统通知',
  'readonly.badge': '只读',
  'readonly.composer': '会话日志已损坏，仅可查看历史记录',
  'history.loadAll': '加载全部',
  'history.loadingAll': '正在加载全部…',
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
  'reply.toStart': 'Back to start of reply',
  'notification.enable': 'Enable browser notifications for completed AI replies',
  'notification.disable': 'Disable browser notifications for completed AI replies',
  'notification.unsupported': 'System notifications require browser support and a secure origin',
  'readonly.badge': 'Read-only',
  'readonly.composer': 'The session log is damaged; history is read-only',
  'history.loadAll': 'Load all',
  'history.loadingAll': 'Loading all…',
}
