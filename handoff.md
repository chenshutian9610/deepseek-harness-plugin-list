# Handoff

## 当前状态

本仓库已整理为 DeepSeek Harness monorepo。原 `deepseek-harness-plugin-list` 内容保留在根目录，其他仓库按原仓库名放入 `packages/`：

- `packages/deepseek-harness-chat-plugin`：来源提交 `f33c206d8f2728291b5b9b93d8bc200b155a5510`
- `packages/deepseek-harness-mcp-plugin`：来源提交 `fb2fc1eac7c9bdf894dd6ac3929ffc8efbf5dba4`
- `packages/deepseek-harness-mermaid-plugin`：来源提交 `f6853b7fbc90405d670dc55c4198f0b0511536e7`
- `packages/deepseek-harness-terminal-plugin`：来源提交 `919b3110cad00c78ad4748bd7d77f419c99056be`
- `packages/deepseek-harness-web`：来源提交 `718ac106995621f9a927c9c7e7064a0dd9f2ba38`

各项目的 `AGENTS.md`、`handoff.md`、源码、测试、资源、锁文件和配置均原样保留。导入范围仅包含来源仓库已跟踪文件，未复制 `node_modules`、`lib` 等生成物，来源仓库本身未修改。

## 仓库约定

- Web 项目继续使用 npm 和自己的 `package-lock.json`。
- 插件项目继续使用 pnpm 和各自的 `pnpm-lock.yaml`。
- MCP 插件依赖项目级 `pnpm-workspace.yaml` 中的 `patchedDependencies`，不要在未迁移该补丁配置前删除它。
- 根目录新增轻量 `package.json` 与 `scripts/bootstrap.mjs`，但仍未启用根级 workspace 或统一锁文件，避免改变现有安装、发布及补丁语义。
- `npm run bootstrap` 会扫描 `packages/` 中声明了 `dsh.bundle` 的项目，逐个执行 pnpm 安装与构建，然后执行 Web 的生产依赖安装。
- `npm run web` 与 `npm run web_lan` 分别转发到 Web 项目的 `start.sh` 与 `start_lan.sh`；两个脚本会让 Web 自动加载同级目录下已构建的本地插件，无需安装到 `$DSH_HOME`。
- 初始导入时未接入各来源仓库的提交历史；如需保留跨仓库历史，后续需明确采用 merge/subtree 方式处理。

## 最近功能调整

- `packages/deepseek-harness-chat-plugin` 新增全局快捷键：`Cmd/Ctrl + Shift + O` 进入新会话；`Cmd/Ctrl + K` 打开会话内容搜索弹窗，可用方向键选择、回车或鼠标双击进入结果会话；实现直接复用 Harness `workspaces.startSession()`、`sessions.search()` 和 `sessions.open()`。为使全文搜索实际可用，`packages/deepseek-harness-web/cordis.yml` 已将 `session-query-sqlite.openAt` 从 `never` 调整为 `first-search`。
- `packages/deepseek-harness-chat-plugin` 新增浏览器本地对话收藏，并把侧栏改为“工作区／收藏”双 Tab：工作区 Tab 保留宿主 WorkspaceBrowser，收藏 Tab 平铺收藏会话、显示所属工作区并可直接打开；收藏与 Tab 选择均持久化到 `localStorage`，不修改宿主会话数据和排序。
- 已在该插件目录运行 `pnpm run check`，类型检查、5 个测试文件（6 个测试）和生产构建均通过；并在 `http://127.0.0.1:3081` 验证收藏切换、双 Tab、会话打开、刷新恢复及侧栏收起／展开均正常；切换收藏前后 Tab 组横向位移为 0。
- 当前 `http://127.0.0.1:3080` 是另一套未加载本地插件的旧 Web 进程；本仓库 `start_lan.sh` 启动的实例在 3081。

## 验证

快捷键功能已在 `packages/deepseek-harness-chat-plugin` 运行 `pnpm run typecheck` 与 `pnpm run build`，均通过；未新增或运行测试用例，也未做浏览器自动化验证。

会话搜索配置修复已使用隔离临时 `DSH_HOME` 在 `127.0.0.1:31877` 启动 Standalone Web，并直接调用 `session.search` RPC；查询成功返回 `{ items: [], hasMore: false }`，不再出现 `SESSION_QUERY_SEARCH_DISABLED`。

实际 `$DSH_HOME` 首次建索引时又发现历史会话 `session-eac95f4d-817d-4d61-990d-4b38539f1a9a` 存在重复旧分支：已提交到 seq 4613 后再次从 seq 4604 写入，导致全局搜索以 `SESSION_QUERY_PERSISTENCE_FAILED` 失败。已备份原始 Zstd 日志为同目录 `session.jsonl.zstd.corrupt-20260820-023104.bak`，删除物理 JSONL 第 1150–1159 行的旧失败分支并原子替换；候选文件先在隔离 Web 中验证可被索引，随后 3081 的实时 `session.search("继续")` 成功返回 5 条结果并包含该修复会话。

初始导入时已逐文件比较导入目录与各来源仓库 HEAD 的全部 Git tracked 文件，内容一致。

本地插件自动集成改动仅执行了脚本语法、JSON 和 Shell 静态检查；未运行 `npm run bootstrap`，也未执行插件构建或 Web 启动。
