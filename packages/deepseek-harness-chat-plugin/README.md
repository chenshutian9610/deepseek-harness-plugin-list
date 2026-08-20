# dsh-chat-process-visibility

`dsh-chat-process-visibility` 是面向 DeepSeek Harness `0.1.0-rc.6` Web UI 的浏览器插件，在每个会话标题栏右上角增加“过程详情”和收藏控件，并把侧栏改为“工作区／收藏”双 Tab，同时保留未读完成提醒。

- `Cmd/Ctrl + Shift + O` 直接进入新会话，复用 Harness 当前／最近工作区的新会话流程。
- `Cmd/Ctrl + K` 打开会话内容搜索弹窗；空格分隔的关键词按 AND 匹配，可跨消息命中，支持忽略空白／标点的子串模糊匹配、全拼和拼音首字母；支持方向键选择、回车进入，以及鼠标单击选择后双击进入会话。
- 侧栏顶部提供“工作区／收藏”两个同级 Tab；收藏 Tab 按最近更新时间列出全部收藏会话，并显示所属工作区。
- 点击收藏 Tab 的会话会直接打开对应对话；Tab 选择会保存在浏览器，刷新后继续保留。
- 标题栏星标可收藏／取消收藏当前对话；工作区 Tab 的对话行悬停时也会显示星标按钮，收藏后金色实心星会常驻显示。
- 收藏状态仅保存在当前浏览器 `localStorage`，刷新页面或重启 Web 后仍会保留。
- 每条已完成的 AI 回复底部提供“回到回复开头”按钮，长回复读到底部后可直接平滑滚回该条回复的第一行。
- AI 回复结束时，如果该会话不是当前正在查看的会话，对话行会显示红点。
- 浏览器标签页图标按“任意会话运行中 > 存在未读 > 普通”显示：运行中叠加蓝色省略号，没有运行中会话但存在可见未读时叠加红点，否则恢复原始图标。
- 工作区行会显示该目录下未读完成对话的红色数量；数字采用紧凑的 14px 徽标，打开对应对话后自动递减，归零后消失。
- 默认开启过程详情，显示聊天中的工具调用、Think／reasoning、上下文注入、压缩／重试和工作流运行等内部过程信息。
- 关闭后隐藏完整过程卡片，但运行期间会保留一条不可展开的最新过程摘要，以 loading 圆环提示当前正在执行的工具、思考或其他内部步骤；工具仍会执行，所有事件仍会写入会话日志，普通用户消息、用户指令、助手正文和错误保持可见。
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

Host 半注册同源 `/api/chat.session-search` 路由，通过 `ctx.sessionQuery.filterEvents()` 读取 Harness 的语义会话文本，并使用 `pinyin-pro` 建立按会话缓存的规范文本／全拼／首字母索引；空格关键词可在同一会话的不同事件中分别命中。缓存会在当前进程追加或释放 Session 时失效，单个损坏历史日志会被跳过，不会阻断其他会话搜索。浏览器半通过官方 `conversation.session.header.utilities` slot 注册过程详情和收藏控件，使用 Harness session-scoped `defineStore` 按会话持久化偏好，并给页面根节点同步 `data-dsh-process-details-hidden`。

新会话快捷键调用 Harness 的 `workspaces.startSession()`；搜索弹窗使用浏览器原生 `<dialog>` 请求插件 Host 路由，并以 `sessions.open()` 导航结果会话。回复回顶按钮通过官方 `conversation.chat.assistant-actions` slot 注册，按 `messageId` 从当前会话快照定位对应 `assistant-step`，再滚动宿主 `[data-conversation-scroll]`。

收藏状态按会话持久化到 `dsh.chat.favoriteSessions.v1.<sessionId>`，侧栏 Tab 选择保存在 `dsh.chat.sidebarTab.v1`。rc.6 没有 Session 行附加控件或 WorkspaceBrowser 内部 Tab slot，因此标题栏使用官方 slot，侧栏通过 `[data-slot='sidebar.workspaces']` 下的语义结构幂等挂载 Tab、收藏列表和星标按钮；工作区 Tab 仍直接使用宿主 WorkspaceBrowser，不修改会话数据或宿主排序。

未读状态复用 Harness Session Runtime 的 `completed` 提醒，并将会话 id 列表持久化到 `dsh.chat.unreadSessions.v1`：非当前会话从运行中变为空闲时置为未读，打开会话时清除。插件通过侧栏语义节点恢复持久化红点，工作区数字按 Workspace 的 `sessionIds` 聚合；归档会话和 subagent 子会话不计入工作区数字。浏览器 favicon 复用同一份运行中／未读状态，在原始 SVG 上生成蓝色省略号和红点两个静态变体；红点与侧栏使用相同的可见会话范围，归档、空白和 subagent 会话不会让红点残留，状态恢复普通或插件卸载时还原原始地址。

显隐样式使用官方 Chat flow 的 `data-chat-flow-kind` 区分 `tool-call`、`context`、`compaction`、`manual-compaction`、`model-retry` 与 `workflow-run`，并使用 `assistant-step` 内 reasoning disclosure 的 `data-variant="think"` 隐藏思考行。插件会持续标记只包含 Think 的 Assistant flow item，并在关闭时隐藏整条 flow item，避免仅隐藏内部内容后仍由消息列的 `gap` 留下一大片空白；包含普通正文或图片的 Assistant 行仍然保留。运行中的 turn 会从当前用户消息之后的最后一个隐藏节点提取折叠摘要，以无按钮、无展开行为的单行 loading 提示替代宿主状态行；错误、最大 token 警告和未知节点不会被开关吞掉。

`data-variant="think"` 是与 Harness `0.1.0-rc.6` 展示实现绑定的适配点；升级 Harness 后需要重新验证，但插件不会修改会话数据、模型请求、工具执行或 agent loop。

## 开发与验证

```bash
pnpm run typecheck
pnpm run test
pnpm run build
pnpm pack --dry-run
```

`pnpm run check` 会依次执行类型检查、测试和生产 bundle 构建。
