# Handoff

## 当前状态

`dsh-web-terminal` MVP 已实现并通过真实 Harness 组合验证，兼容范围为 DeepSeek Harness `>=0.1.0-rc.5 <0.2.0`。独立开发环境固定使用 npm 已发布的 `0.1.0-rc.6` 类型与构建依赖，不再依赖相邻的 Harness 源码目录。

功能：
- 在 `dsh-web` 的 `conversation.input.dock` 注册 xterm.js 终端，只占当前 Session 的中间对话栏；CSS `order: 1` 将它放到同一 composer flex 栈的输入框之后。
- 终端位于输入框下方并参与正常布局；打开时输入框向上移动，不再覆盖页面。空白 Session 的 Hero 状态会在终端打开时改为底部对齐，并清除 Hero 原有的 32px foot，使其与已有对话时的终端贴底样式一致。终端面板在 Hero／Active 阶段都以 composer seat 为宽度容器，边框距左侧和底部均为 10px、距右侧为 3px，高度保持一致。
- 会话标题栏最右侧通过官方 `conversation.session.header.utilities` slot 显示 12px 的“Terminal”按钮；点击可打开／关闭终端，按钮通过 `aria-pressed` 同步状态。
- `Cmd+J` / `Ctrl+J` 仍可切换显示并聚焦；`Alt+←` / `Alt+→` 会发送 shell 通用的 `Esc+b` / `Esc+f`，按单词移动光标，避免 xterm 默认修饰箭头序列在 shell 中显示为 `;3D` / `;3C`。终端内按 `Home` / `End`，以及 macOS 的 `Fn+←` / `Fn+→` / `Fn+↑` / `Fn+↓`，不再带动外部对话窗口滚动。
- 通过官方 `theme` 服务读取网页实际解析后的 `light`／`dark` 配色，并监听 `theme/change`；xterm 背景、前景、光标与选区会立即同步，浅色背景为白色。输入位置使用 2px 竖线光标，聚焦时闪烁，失焦时仍保持可见。
- 当前 Session 对应一个页面本地终端连接；切换 Session 会关闭旧 PTY。
- Host 通过 `/web-terminal` WebSocket 和 `ctx.subprocess.spawnTerminal()` 启动交互式 PTY。
- PTY 遵循当前 Session 的 sandbox policy；sandbox 模式变更会在终端打开期间被拒绝。
- 页面、Session、插件或 Host 销毁时终止 PTY。
- 限制输入大小、WebSocket 待发送缓冲，并拒绝非同源连接；Host 与 TCP 客户端仅允许回环、私有局域网或 `100.64.0.0/10` 共享地址（如 Tailscale），同时阻断公网地址、域名与 DNS 重绑定。

## 关键实现

- Host：`src/index.ts`
- 协议与信任边界：`src/host/protocol.ts`
- Client 注册：`src/client/index.ts`；终端面板通过官方 `conversation.input.dock` slot 挂载，标题栏按钮通过 `conversation.session.header.utilities` slot 挂载，并直接订阅 `ctx.sessions.list` 保证 dock 未挂载时切换 Session 仍会关闭旧 PTY。不能使用 `conversation.composer.dock`：它在空白新会话（Hero）阶段不渲染，快捷键会改变状态但页面没有终端。
- xterm 控制器：`src/client/controller.ts`；支持 session-scoped dock 卸载后把既有 xterm DOM 重新挂到新容器，并通过 `setColorScheme()` 更新 canvas 配色。配色常量位于 `src/client/theme.ts`。
- UI：`src/client/TerminalPanel.tsx`、`src/client/styles.css`
- Bundle：`cordis.patch.yml`
- 构建：`tsdown.config.ts`

终端尺寸只在首次连接时传给 PTY。Harness `0.1.0-rc.5` 的 `SubprocessTerminalHandle` 没有 resize seam，因此当前不实现动态 resize；`vim`、`top` 等全屏程序在窗口尺寸变化后可能不完美。

没有 Session 时不显示终端；空白 Session 的 Hero 状态可以显示。审批、提问等 composer takeover 期间，终端随普通输入栏一起隐藏。若要求 takeover 期间也始终显示，需要 Harness 新增 composer chain 外侧的专用 slot，不要用 DOM 定位绕过。

## 已修复问题

首次布局调整使用 `conversation.composer.dock`，在空白新会话按快捷键后终端不出现。根因是 ConversationRoot 的 Hero 分支不渲染该 slot。现改用 Hero/Active 都渲染的 `conversation.input.dock`，并以 `order: 1` 放到输入框之后；面板设置 `flex: none`，防止 Hero 栈把 440px 高度压缩。

真实 WebSocket 测试曾在收到 `ready` 后立即以 1006 断开。根因是 `ws` 的发送回调成功时运行时传入 `null`，而代码用 `error !== undefined` 将其误判为错误并调用 `terminate()`。现改为 truthy 检查：

```ts
socket.send(body, (error) => { if (error) socket.terminate() })
```

通过局域网 IP 打开网页时终端连接被 403 拒绝。根因是 `isTrustedTerminalUpgrade()` 同时强制 Host 和 TCP 客户端必须为 loopback。现使用 Node `BlockList` 允许回环、RFC1918 IPv4、`100.64.0.0/10` 共享地址、IPv4 link-local、IPv6 ULA/link-local，仍要求严格同源并拒绝域名和公网地址。

`100.64.0.0/10` 源码修改后若直接部署旧 `lib/` 或旧 tarball，Host 仍会按旧网段拒绝。`lib/` 被 `.gitignore` 忽略，不会随源码提交自动更新；部署前必须重新 build／pack 并重装插件、重启 Host。

终端启用 `screenReaderMode` 后，xterm 不会默认取消未带修饰键的键盘事件。macOS 的 `Fn+←` / `Fn+→` 会映射为 `Home` / `End`，`Fn+↑` / `Fn+↓` 会映射为 `PageUp` / `PageDown`，均可能继续触发外部页面滚动。现由 xterm 的自定义键盘处理器取消这四个导航键的浏览器默认行为并阻止冒泡，同时返回 `true` 保留 xterm 自身的按键处理。

## 验证结果

通过：
- `Home` / `End` / `PageUp` / `PageDown` 页面滚动修复后执行 `pnpm typecheck` 与 `pnpm build`：Host／Client TypeScript 检查及构建通过，`lib/client.js` 已更新。
- 局域网访问修复后执行 `pnpm test`：2 个协议测试通过，包含 `192.168.x.x` 与 `100.66.x.x` 同源 Host／客户端放行；公网地址、域名、跨源连接仍拒绝。
- 局域网访问修复后执行 `pnpm typecheck`：Host／Client TypeScript 检查通过。
- 重新执行 `pnpm build` 与 `pnpm pack --pack-destination /tmp`，并从 tarball 内检查 `package/lib/index.js`，确认包含 `100.64.0.0/10`。
- `pnpm check`：使用 npm 发布的 Harness `0.1.0-rc.6` 依赖完成 Host/Client typecheck、2 个协议测试、Host/Client build。
- 将项目复制到不存在相邻 `deepseek-harness` 的临时目录后执行 `pnpm install --frozen-lockfile`：安装并运行 `prepare` 构建成功，确认仓库可独立克隆开发。
- 在 Harness 仓库执行 `DSH_HOME=/tmp/dsh-web-terminal-home pnpm dsh --profile web --dump-config`：包含 `web-terminal`。
- 实际启动 Web 后，首页 boot graph 包含 `dsh-web-terminal`，其依赖边已从 `ui-layout` 改为 `ui-conversation`；构建后的 client bundle 路由返回 200。
- 使用 `agent-browser`（Chrome CDP，未使用 Playwright）在 1280×633 的真实 Web 中验证：活动 Session 右上角 12px 的“Terminal”按钮与 `Session log` 同行；点击后 `aria-pressed` 从 `false` 变为 `true` 且出现一个打开的终端面板，再次点击恢复为 `false` 且面板关闭。打开态截图：`/tmp/dsh-terminal-button-open-2.png`。
- 使用 `agent-browser` 在 1280×633 的真实 Web 中验证空白 Hero Session：相对 992px 宽的 composer seat，终端边框距左侧 10px、右侧 3px、底部 10px；此前已验证 Hero／Active 共用同一容器尺寸规则。
- 在真实 Web 设置中把外观从深色切到浅色：终端保持打开并立即从背景 `rgb(21, 21, 23)`／前景 `rgb(249, 250, 251)` 切到背景 `rgb(255, 255, 255)`／前景 `rgb(15, 17, 21)`；xterm 6 的 legacy viewport 也同步，浅色截图：`/tmp/dsh-terminal-light-theme-final.png`。
- 真实 `dsh web` + Node `ws`：收到 `ready`，执行命令并读回当前工作目录标记，客户端关闭后 PTY 退出。
- 非同源 WebSocket 实际返回 HTTP 403。
- Host SIGTERM 时，已打开的 PTY 正常退出。
- `pnpm pack --pack-destination /tmp` 后，将 `/tmp/dsh-web-terminal-0.1.0.tgz` 安装到全新 profile；bundle layer、`./client` entry、`@deepseek-ai/dsh-client-ui-theme` peer 与 client inject 均存在。

未使用 Playwright 完成最终验证；后续也不要使用 `playwright-cli`，除非用户明确改口。

## 临时环境

- 本地链接 profile：`DSH_HOME=/tmp/dsh-web-terminal-home`
- 当前预览服务器：`http://127.0.0.1:3099`，父进程 PID 记录在 `/tmp/dsh-web-terminal-dock.pid`
- 当前预览日志：`/tmp/dsh-web-terminal-dock.log`
- 当前 tarball：`/tmp/dsh-web-terminal-0.1.0.tgz`（包含主题同步及 `100.64.0.0/10` 放行）
- 当前 tarball 安装 profile：`/tmp/dsh-web-terminal-theme-artifact-home`
- 共享 `~/.dsh/profiles/web` 已重新链接到当前 monorepo 包目录；此前仍指向旧的 `/Users/chenshutian/Documents/Code/deepseek-harness-terminal-plugin`，所以在当前目录 build 不会影响运行中的 3081 服务。重启 Host 并硬刷新浏览器后才会加载新的 `lib/client.js`。

## 后续可选项

MVP 已完成。只有 Harness 新增 PTY resize seam 后，才值得增加动态 resize；不要在插件内绕过 subprocess provider 直接依赖 `node-pty`。
