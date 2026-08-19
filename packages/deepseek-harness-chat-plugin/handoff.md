# 交接

## 当前状态

- “过程详情”通过 `conversation.session.header.utilities` slot 显示在会话标题栏。
- 开关使用 Harness session-scoped `defineStore`，每个会话独立保存显隐偏好；切换会话、刷新页面或重启 Web 不会串改其他会话。
- `src/client/styles.css` 中开关高度为 32px、圆角为 16px，与相邻的 Session log、Terminal 胶囊按钮保持一致。
- DOM 标记和过程行过滤规则未改动。
- 侧栏复用 Session Runtime 的 `completed` 状态：非当前会话结束后，对话完成点显示为红色；工作区行按未读会话数显示紧凑的 14px 红色数字。
- 未读会话 id 持久化在 `localStorage` 的 `dsh.chat.unreadSessions.v1`，刷新或重启 Web 后仍会恢复；打开对应会话会清除未读，工作区数字随之递减。
- 归档会话与 subagent 不计入工作区数字。
- 工作区数字通过 `[data-slot='sidebar.workspaces']` 和 Workspace treeitem 语义节点挂载，不替换宿主 WorkspaceBrowser。
- 已修复工作区徽标导致页面卡死的问题：`MutationObserver` 回调不再无条件重写徽标文本，避免观察器被自身 DOM 变更持续触发形成微任务死循环。

## 验证

- 已运行 `pnpm run check`：类型检查、6 个测试和生产构建均通过。
- 已运行 `pnpm pack --dry-run`，发布包包含新增的未读通知声明与客户端 bundle。
