# Handoff

## 当前状态

`dsh-web-mermaid` MVP 已完成，目标版本为 DeepSeek Harness `0.1.0-rc.6`，并兼容已核对相同 Markdown 代码块 DOM 的 `0.1.0-rc.5`。

功能：
- 把 Web UI Markdown 中已定稿的 `````mermaid`` 围栏渲染为 SVG。
- 回复流式输出时 Harness 不发布围栏语言，因此仍显示普通代码；定稿后由 MutationObserver 自动渲染。
- Mermaid 语法错误时不隐藏原代码块。
- Mermaid 使用 `securityLevel: 'strict'`、`suppressErrorRendering: true` 和 neutral 主题，生成的 SVG 通过图片 data URL 隔离展示。
- 插件自有图表卡片提供放大预览和 SVG 下载；宽图可横向滚动。
- 插件自有放大预览在固定头部提供 `−`／`+` 控件，以 25% 为步进在 50%～300% 之间缩放；支持 Escape／遮罩／关闭按钮退出、焦点恢复和无障碍标签，`+` 字形上移 1px 做视觉居中。
- 插件卸载时移除 observer、样式、图表卡片和打开的预览，并恢复原代码块显示状态。

## 关键实现

- Host 空入口：`src/index.ts`
- Client：`src/client/index.ts`
- Bundle：`cordis.patch.yml`
- 单文件 Client 构建：`tsdown.config.ts`；必须保留 `outputOptions.codeSplitting: false`，Harness 每个插件只提供一个 `client.js` 路由，不能产生 Mermaid lazy diagram chunks。
- 安装说明：`README.md`

插件不提供配置或服务。Host 空 `apply` 仅让 Loader 发现 package；Client 通过一个 `ctx.effect()` 持有 Mermaid 渲染、图表卡片、body portal 预览、下载、DOM observer、样式和全部清理。`package.json#dsh.client.inject` 声明对 `@deepseek-ai/dsh-client-ui-primitives` 的模块图依赖，Client Cordis 插件本身没有 service inject。

Harness `rc.5`／`rc.6` 的 `MarkdownText` 没有围栏 renderer slot，因此当前实现依赖其公开全局类 `.md-code-block`，并从代码块 banner 的既有 DOM 结构读取最终语言。放大预览和下载均由插件生成，不依赖 Harness 的 Mermaid 组件或 CSS Module 类名。Harness 后续提供官方围栏扩展点时应迁移。

## 验证结果

通过：
- 本次功能迁移后执行 `pnpm run build`，Host、Client 与 Client 类型声明构建通过，Client 仍为单个 `lib/client.js`。
- 使用 `agent-browser` 在真实 Harness 页面注入 rc.6 `CodeBlock` 语义 DOM：插件生成带“放大预览”／“下载图片”的卡片；预览弹窗包含 `−`／`+`／关闭按钮，点击 `+` 后图片宽度由 100% 变为 125%；下载得到有效 SVG 文件。
- `../deepseek-harness/node_modules/.bin/tsc -p tsconfig.host.json --noEmit`
- `../deepseek-harness/node_modules/.bin/tsc -p tsconfig.client.json --noEmit`
- 使用 lock 对应的 tsdown `0.22.14` 构建；产物只有 `lib/client.js`，无相对 chunk require，压缩后约 3.44 MB。
- `../deepseek-harness/node_modules/.bin/tsc -p tsconfig.client.build.json`
- `npm pack --ignore-scripts --pack-destination /tmp`：`/tmp/dsh-web-mermaid-0.1.0.tgz`，约 916 KB，包含 Host／Client 入口、类型和 bundle patch。
- 将最终 tarball 安装到 `/tmp/dsh-web-mermaid-final-home` 的全新 `web` profile；`--dump-config` 包含 `dsh-web-mermaid` 层和 `web-mermaid` 行。
- 启动真实 Harness Web 后，boot manifest 包含 `dsh-web-mermaid/client.js`，该路由返回 200。
- 使用 `agent-browser` 在真实页面注入与 Harness `CodeBlock` 相同结构：有效 flowchart 生成一个 SVG 并隐藏原代码；无效 Mermaid 保留原代码；插件样式存在。未使用 Playwright。
- Web 验证进程已停止。

未写自动化测试文件（项目规则要求用户未明确提出时不新增测试）。首次 `pnpm install` 遭遇 npm registry `ECONNRESET`；随后基于本机 Harness 已安装依赖完成验证，并用 `pnpm install --lockfile-only --offline --ignore-scripts` 生成 `pnpm-lock.yaml`。新环境正常执行 `pnpm install` 即可。

## 后续可选项

- Harness 提供 Markdown fence renderer slot 后，删除 DOM observer 并改用官方扩展点。
- 只有用户明确需要时再做跟随深浅主题重渲染；当前 neutral SVG 固定在白色卡片中以保证两种主题下可读。
