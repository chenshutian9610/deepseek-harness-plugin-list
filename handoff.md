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
- 暂未增加根级 workspace 或统一锁文件，避免改变现有安装、发布及补丁语义。
- 本次按规则未创建 Git 提交，因此只合并了代码树，没有把来源仓库提交历史接入当前分支；如需保留跨仓库历史，后续需明确允许创建 merge/subtree 提交后再处理。

## 验证

已逐文件比较导入目录与各来源仓库 HEAD 的全部 Git tracked 文件，内容一致。未执行构建或测试。
