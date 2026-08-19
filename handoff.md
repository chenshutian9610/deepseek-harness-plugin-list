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

- `packages/deepseek-harness-chat-plugin` 新增浏览器本地对话收藏，并把侧栏改为“工作区／收藏”双 Tab：工作区 Tab 保留宿主 WorkspaceBrowser，收藏 Tab 平铺收藏会话、显示所属工作区并可直接打开；收藏与 Tab 选择均持久化到 `localStorage`，不修改宿主会话数据和排序。
- 已在该插件目录运行 `pnpm run check`，类型检查、5 个测试文件（6 个测试）和生产构建均通过；并在 `http://127.0.0.1:3081` 验证收藏切换、双 Tab、会话打开、刷新恢复及侧栏收起／展开均正常；切换收藏前后 Tab 组横向位移为 0。
- 当前 `http://127.0.0.1:3080` 是另一套未加载本地插件的旧 Web 进程；本仓库 `start_lan.sh` 启动的实例在 3081。

## 验证

初始导入时已逐文件比较导入目录与各来源仓库 HEAD 的全部 Git tracked 文件，内容一致。

本地插件自动集成改动仅执行了脚本语法、JSON 和 Shell 静态检查；未运行 `npm run bootstrap`，也未执行插件构建或 Web 启动。
