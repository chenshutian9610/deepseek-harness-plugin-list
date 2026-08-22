# Handoff

## 当前状态

本仓库已整理为 DeepSeek Harness monorepo。原 `deepseek-harness-plugin-list` 内容保留在根目录，其他仓库按原仓库名放入 `packages/`：

- `packages/deepseek-harness-chat-plugin`：来源提交 `f33c206d8f2728291b5b9b93d8bc200b155a5510`
- `packages/deepseek-harness-mermaid-plugin`：来源提交 `f6853b7fbc90405d670dc55c4198f0b0511536e7`
- `packages/deepseek-harness-terminal-plugin`：来源提交 `919b3110cad00c78ad4748bd7d77f419c99056be`
- `packages/deepseek-harness-web`：来源提交 `718ac106995621f9a927c9c7e7064a0dd9f2ba38`

各项目的 `AGENTS.md`、`handoff.md`、源码、测试、资源、锁文件和配置均原样保留。导入范围仅包含来源仓库已跟踪文件，未复制 `node_modules`、`lib` 等生成物，来源仓库本身未修改。

## 仓库约定

- Web 项目继续使用 npm 和自己的 `package-lock.json`。
- 插件项目继续使用 pnpm 和各自的 `pnpm-lock.yaml`。
- 原独立 MCP 插件已迁入 `packages/deepseek-harness-web/project-mcp`；官方 rc.8 MCP client 源码 fork 与 Agent 作用域修改直接包含在 Web 发布物中，不再依赖 pnpm `patchedDependencies`。
- 根目录新增轻量 `package.json` 与 `scripts/bootstrap.mjs`，但仍未启用根级 workspace 或统一锁文件，避免改变现有安装、发布及补丁语义。
- `npm run bootstrap` 会扫描 `packages/` 中声明了 `dsh.bundle` 的项目，逐个执行 pnpm 安装与构建，然后执行 Web 的生产依赖安装。
- `npm run web` 与 `npm run web_lan` 分别转发到 Web 项目的 `start.sh` 与 `start_lan.sh`；两个脚本会让 Web 自动加载同级目录下已构建的本地插件，无需安装到 `$DSH_HOME`。
- `npm run dist` 会构建所有同级 bundle，在临时目录按 Web 锁文件安装当前平台的生产依赖，将插件 tarball 与缺失的直接运行时依赖复制进最终 `node_modules`，再只保留目标系统／架构的 `node-pty` 预构建文件。`npm run build:all` 复用同一流程，依次构建 darwin/linux/win32 的 arm64 与 x64 六套产物。产物包含可移动目录与 `.tar.gz`，不包含 Node.js，也不会引用仓库内插件路径。
- 初始导入时未接入各来源仓库的提交历史；如需保留跨仓库历史，后续需明确采用 merge/subtree 方式处理。

## 最近功能调整

- `deepseek-harness-web` 已整体升级到官方 `0.1.0-rc.8`，同步 rc.8 Web renderer、brand、attachment、reference 与 preset 组合。原 `packages/deepseek-harness-mcp-plugin` 已删除并迁入 `packages/deepseek-harness-web/project-mcp`；内置 fork 基于官方 `@deepseek-ai/dsh-mcp-client@0.1.0-rc.8` / commit `141eb6fef83422698aef7a981029e843e8161534`，仅将 `serverName` 占用范围改为 `ctx.agent ?? ctx.root`，同时由 Web wrapper 显式持有并清理每个 Agent 的 MCP child Fibers。Profile loader 会忽略遗留的 `dsh-project-mcp` bundle 层，避免旧 profile 与内置行产生重复 `project-mcp` loader id，但不会自动改写用户 profile manifest。

- `packages/deepseek-harness-chat-plugin` 为每条已完成的 AI 回复新增“回到回复开头”按钮，通过官方 `conversation.chat.assistant-actions` slot 挂载，点击后按回复 `messageId` 定位对应 Assistant 行并在会话滚动容器内平滑回到第一行；已在 3081 实例验证。
- `packages/deepseek-harness-chat-plugin` 在原生“加载更早”旁新增“加载全部”：逐页触发原生分页，保留宿主的每页 50 条、连续性检查和滚动锚点恢复；会话切换、分页无进展、单页超时或插件卸载时停止，不新增 Host RPC 或日志格式。已修复同步按钮文案时无条件写入 `textContent` 触发 `MutationObserver` 微任务死循环、导致页面卡死的问题。
- `packages/deepseek-harness-chat-plugin` 新增全局快捷键：`Cmd/Ctrl + Shift + O` 进入新会话；`Cmd/Ctrl + K` 打开会话内容搜索弹窗，可用空格分隔关键词进行跨消息 AND 模糊匹配，支持全拼和拼音首字母，并可用方向键选择、回车或鼠标双击进入结果会话。插件 Host 通过 `sessionQuery.filterEvents()` 提供独立的同源搜索路由，不依赖 SQLite FTS；`packages/deepseek-harness-web/cordis.yml` 的 `session-query-sqlite.openAt: first-search` 仍供宿主原生搜索使用。
- `packages/deepseek-harness-chat-plugin` 新增浏览器本地对话收藏，并把侧栏改为“工作区／收藏”双 Tab：工作区 Tab 保留宿主 WorkspaceBrowser，收藏 Tab 平铺收藏会话、显示所属工作区并可直接打开；收藏与 Tab 选择均持久化到 `localStorage`，不修改宿主会话数据和排序。
- 已在该插件目录运行 `pnpm run check`，类型检查、5 个测试文件（6 个测试）和生产构建均通过；并在 `http://127.0.0.1:3081` 验证收藏切换、双 Tab、会话打开、刷新恢复及侧栏收起／展开均正常；切换收藏前后 Tab 组横向位移为 0。
- 当前 `http://127.0.0.1:3080` 是另一套未加载本地插件的旧 Web 进程；本仓库 `start_lan.sh` 启动的实例在 3081。

## 验证

“加载全部”改动此前已在 `packages/deepseek-harness-chat-plugin` 运行完整 `pnpm run check`：Host/Client TypeScript 检查、8 个 Vitest 文件 / 11 个测试以及 Host/Client 生产构建全部通过。页面卡死修复后运行 `pnpm exec vitest run tests/load-all-history.client.spec.ts`，3 个测试通过，并运行 `pnpm run build` 重新生成 `lib/client.js`；此前仅修改源码未构建，导致重启后仍加载含死循环的旧 bundle。当前未运行 `pnpm run dev:web` watcher，也未再次重启 3081 服务。

Web rc.8 + 内置 MCP 迁移已通过 `npm run check`、全新 `npm ci --omit=dev`、生产依赖树检查、预构建 MCP 模块导入、`npm pack --dry-run` 内容检查，以及隔离 `DSH_HOME` 的 31987 启动／关闭验证。`agent-browser` 在 390×844 完成无 Key onboarding 并进入 rc.8 App shell，页面、body 与 viewport 宽度均为 390，无横向溢出；未发送模型请求，未使用 `playwright-cli`。另使用仍包含旧 `dsh-project-mcp` bundle 的真实 Web profile 运行 `sh start_lan.sh`，3081 启动成功且 loopback HTTP 返回 200。

回复回顶按钮已在 `packages/deepseek-harness-chat-plugin` 运行 `pnpm run check`，类型检查、5 个测试文件（6 个测试）和生产构建均通过；在 `http://127.0.0.1:3081` 实测按钮显示及平滑滚动落点正确。

快捷键与空格模糊／拼音搜索功能已在 `packages/deepseek-harness-chat-plugin` 运行 `pnpm run typecheck` 与 `pnpm run build`，均通过；未新增或运行测试用例，也未做浏览器自动化验证。隔离真实会话验证 `继续`、`jixu`、`ji xu`、`kaifa peizhi`、`开发 助手` 均可命中；复制实际 89 个会话的冷缓存首次查询约 5.1 秒，缓存查询约 0.02–0.09 秒；路由边界验证 GET=405、跨源 POST=403、纯标点查询=400。

会话搜索配置修复已使用隔离临时 `DSH_HOME` 在 `127.0.0.1:31877` 启动 Standalone Web，并直接调用 `session.search` RPC；查询成功返回 `{ items: [], hasMore: false }`，不再出现 `SESSION_QUERY_SEARCH_DISABLED`。

实际 `$DSH_HOME` 首次建索引时又发现历史会话 `session-eac95f4d-817d-4d61-990d-4b38539f1a9a` 存在重复旧分支：已提交到 seq 4613 后再次从 seq 4604 写入，导致全局搜索以 `SESSION_QUERY_PERSISTENCE_FAILED` 失败。已备份原始 Zstd 日志为同目录 `session.jsonl.zstd.corrupt-20260820-023104.bak`，删除物理 JSONL 第 1150–1159 行的旧失败分支并原子替换；候选文件先在隔离 Web 中验证可被索引，随后 3081 的实时 `session.search("继续")` 成功返回 5 条结果并包含该修复会话。

初始导入时已逐文件比较导入目录与各来源仓库 HEAD 的全部 Git tracked 文件，内容一致。

本地插件自动集成改动仅执行了脚本语法、JSON 和 Shell 静态检查；未运行 `npm run bootstrap`，也未执行插件构建或 Web 启动。

当前平台发行包功能已在 macOS arm64 执行 `npm run dist`：三个插件均完成生产构建，临时 Web 生产安装与 `node ./check.mjs` 通过，输出目录文件逻辑总量为 102.9 MiB（macOS `du` 磁盘占用 133 MiB）、gzip 包为 31.4 MiB。隔离 `DSH_HOME` 启动后 HTTP 200，首页同时声明 `dsh-chat-process-visibility`、`dsh-web-mermaid`、`dsh-web-terminal` 三个 Client 模块；随后将 tarball 解压到新的系统临时目录再次启动，HTTP 与插件模块均正常，验证产物不依赖原仓库绝对路径。

全架构发行包已在 macOS arm64 执行 `npm run build:all`，成功生成 darwin/linux/win32 的 arm64 与 x64 六套目录和 tarball。逐套检查确认只保留匹配的 `node-pty/prebuilds/<target>`，Darwin `spawn-helper` 可执行、Windows `.pdb` 已裁剪，并安装了匹配目标的 Sharp、Koffi 与 ripgrep 可选包。宿主 darwin-arm64 运行了 `node-pty` 导入及完整 `check.mjs`；其余五套跨构建产物完成纯 JavaScript/插件入口与可移动链接检查，原生模块仍需在对应目标系统和架构运行验证。
