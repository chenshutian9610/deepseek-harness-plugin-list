# Handoff

## 当前状态

已实现 `dsh-project-mcp`，目标 Harness `0.1.0-rc.6` / Cordis `4.0.1`。插件在每个 `agent/created` 时从 `agent.session.header.cwd` 读取 Claude Code 风格 `.mcp.json`，在 `agent.ctx` 下挂载 MCP client，因此工具只对对应 Agent 可见并随其作用域清理。

## 已解决问题

1. 项目目录：原实现错误使用 Web Host 的 `process.cwd()`；现默认使用每个 Agent 的 `session.header.cwd`。
2. Claude Code 兼容：接受 `directTools: boolean`，只做类型校验；Harness MCP 工具本身已是直接工具。
3. 环境代理：HTTP MCP 依赖环境代理时，Node 进程启动阶段必须有 `NODE_USE_ENV_PROXY=1`，并继承 `http_proxy` / `https_proxy`。当前定制 Web 的 `bin.mjs` 会在变量缺失时以该变量自动派生子进程。
4. 多 Agent 同名 MCP：官方 `@deepseek-ai/dsh-mcp-client@0.1.0-rc.6` 使用 `ctx.root` 做 `serverName` 进程级占用，导致第二个 ai-ops Agent 的 `dynamic-ops` / `bytebase` 加载失败。现已通过 pnpm patch 将 reservation owner 改为 `ctx.agent ?? ctx.root`。

## pnpm patch

- 声明：`pnpm-workspace.yaml` 的 `patchedDependencies`。
- 补丁：`patches/@deepseek-ai__dsh-mcp-client@0.1.0-rc.6.patch`。
- 行为：
  - 不同 Agent 可以同时使用相同 `serverName` 和相同模型可见工具名。
  - 同一个 Agent 内重复 `serverName` 仍失败。
  - 无 Agent 的全局实例仍按 Host root 保持唯一。
  - 每个 Agent dispose 只释放自己的名称占用和工具，不影响另一个 Agent。
- 当前 Web Profile 使用 `link:` 指向此项目，因此 Node 从本项目真实路径解析已 patch 的 MCP client。单独安装 `dsh-project-mcp-0.1.0.tgz` 时，消费者不会自动继承本项目根的 pnpm patch。

## 主要文件

- `src/index.ts`：Agent 生命周期、`.mcp.json` 校验和 MCP client 配置映射。
- `tests/project-mcp.test.ts`：包括两个 Agent 同时加载相同 `fixture` namespace，并分别清理的回归测试。
- `patches/@deepseek-ai__dsh-mcp-client@0.1.0-rc.6.patch`：Agent-scoped server name reservation。
- `pnpm-workspace.yaml`、`pnpm-lock.yaml`：补丁声明和解析锁定。
- `README.md`：安装、代理和 patch 限制说明。
- `dsh-project-mcp-0.1.0.tgz`：最新重新构建的插件 tarball；注意它不携带安装根的 patch 语义。

## 验证记录

- `pnpm run check` 通过：TypeScript、5 个测试、构建和 declaration。
- 多 Agent 回归测试通过：两个 Agent 同时拥有 `mcp__fixture__fixture_ping`；销毁 A 后 B 的同名工具仍存在；销毁 B 后清理。
- 独立直接加载 patched MCP client 通过：Agent A/B 各自可注册同名 namespace；dispose A 后 A=0、B=1。
- `pnpm pack --pack-destination .` 通过。
- 真实 ai-ops MCP 在正确代理环境下曾验证 `dynamic-ops` 8 个工具、`bytebase` 3 个工具。

## 待实际 Web 验证

当前 3081 进程在 patch 生成前已经加载旧的 MCP client 内存模块。用户明确要求不要由 Agent 停止或重启 3081；必须告知用户由其自行重启。

用户重启后：

1. 同时打开/新建至少两个 ai-ops 会话。
2. 每个会话都应出现 11 个 `mcp__dynamic-ops__*` / `mcp__bytebase__*` 工具。
3. 关闭其中一个会话不应影响另一个会话的工具。

`.mcp.json` 含明文 Authorization token，不要在输出中复述，建议用户轮换并使用安全注入。
