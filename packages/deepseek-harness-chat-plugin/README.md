# dsh-chat-process-visibility

`dsh-chat-process-visibility` 是面向 DeepSeek Harness `0.1.0-rc.6` Web UI 的浏览器插件，在每个会话标题栏右上角增加“过程详情”开关，并在侧栏显示未读完成提醒。

- AI 回复结束时，如果该会话不是当前正在查看的会话，对话行会显示红点。
- 工作区行会显示该目录下未读完成对话的红色数量；数字采用紧凑的 14px 徽标，打开对应对话后自动递减，归零后消失。
- 默认开启过程详情，显示聊天中的工具调用、Think／reasoning、上下文注入、压缩／重试和工作流运行等内部过程信息。
- 关闭后只隐藏 Chat 视图中的这些过程展示；工具仍会执行，所有事件仍会写入会话日志，普通用户消息、用户指令、助手正文、状态和错误保持可见。
- 再次开启会立即恢复已有内容，不需要重新加载会话。
- 过程详情偏好与未读会话列表均保存在浏览器 `localStorage`，会跨刷新和 Web 进程重启保留。
- 独立的“轨迹”视图不受影响，仍可用于完整诊断。

## 安装

```bash
cd <插件目录>
pnpm install
pnpm run check

dsh plugin --profile web add <插件目录>
dsh --profile web --dump-config
```

然后重启当前 `dsh web`／Standalone Web 进程，并刷新页面。卸载：

```bash
dsh plugin --profile web remove dsh-chat-process-visibility
```

## 实现

Host 半是无状态函数插件，仅用于让 Loader 扫描同包的 `dsh.client` manifest。浏览器半通过官方 `conversation.session.header.utilities` slot 注册开关，使用 Harness session-scoped `defineStore` 按会话持久化偏好，并给页面根节点同步 `data-dsh-process-details-hidden`。

未读状态复用 Harness Session Runtime 的 `completed` 提醒，并将会话 id 列表持久化到 `dsh.chat.unreadSessions.v1`：非当前会话从运行中变为空闲时置为未读，打开会话时清除。插件通过侧栏语义节点恢复持久化红点，工作区数字按 Workspace 的 `sessionIds` 聚合；归档会话和 subagent 子会话不计入工作区数字。

显隐样式使用官方 Chat flow 的 `data-chat-flow-kind` 区分 `tool-call`、`context`、`compaction`、`manual-compaction`、`model-retry` 与 `workflow-run`，并使用 `assistant-step` 内 reasoning disclosure 的 `data-variant="think"` 隐藏思考行。插件会持续标记只包含 Think 的 Assistant flow item，并在关闭时隐藏整条 flow item，避免仅隐藏内部内容后仍由消息列的 `gap` 留下一大片空白；包含普通正文或图片的 Assistant 行仍然保留。错误、最大 token 警告和未知节点不会被开关吞掉。

`data-variant="think"` 是与 Harness `0.1.0-rc.6` 展示实现绑定的适配点；升级 Harness 后需要重新验证，但插件不会修改会话数据、模型请求、工具执行或 agent loop。

## 开发与验证

```bash
pnpm run typecheck
pnpm run test
pnpm run build
pnpm pack --dry-run
```

`pnpm run check` 会依次执行类型检查、测试和生产 bundle 构建。
