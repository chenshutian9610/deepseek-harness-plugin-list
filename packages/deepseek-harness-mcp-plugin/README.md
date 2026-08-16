# dsh-project-mcp

DeepSeek Harness 插件：每个 Agent 创建时读取该会话工作目录（`session.header.cwd`）中的 Claude Code 风格 `.mcp.json`，并为 `mcpServers` 中的每个条目挂载 Agent 作用域内的 `@deepseek-ai/dsh-mcp-client` 子插件。

## 支持范围

支持 Claude Code 项目级配置的以下语法：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "env": {
        "OPTIONAL_VALUE": "value"
      }
    },
    "remote": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer token"
      }
    }
  }
}
```

- stdio：`command`、可选 `args`、`env`、`cwd`，`type` 可省略或设为 `stdio`。
- HTTP：`url`、可选 `headers`，`type` 可省略、设为 `http` 或 `sse`。Harness 统一使用 Streamable HTTP 客户端连接。如果 endpoint 依赖 `HTTP_PROXY` / `HTTPS_PROXY`，需要在 Node 进程启动时设置 `NODE_USE_ENV_PROXY=1`。
- 接受 Claude Code 配置中的 `directTools: true/false`；Harness MCP 工具本身就是直接工具，因此该字段只做兼容校验，不改变行为。
- stdio 的默认工作目录是 Agent 会话的项目根目录；相对 `cwd` 也相对该目录解析。
- `mcpServers` 的 key 会成为工具 namespace，必须满足 `[A-Za-z0-9_-]{1,32}`。模型最终看到的工具名形如 `mcp__filesystem__read_file`。
- 文件缺失默认不报错；文件存在但 JSON 或服务器条目不合法时会在插件加载阶段明确失败。

`.mcp.json` 可以启动任意本机程序，并且不经过 agent 的工具沙箱。只应在可信项目中启用、审查命令与参数，并避免提交密钥。

## 安装

在插件目录执行：

```sh
dsh plugin --profile web add .
```

启动 Harness 后，在 Web UI 中为会话选择目标项目目录。Web Host 自身可以从其他目录启动；插件以每个会话的工作目录定位 `.mcp.json`。需要环境代理时，应像下面这样从进程启动阶段启用 Node 环境代理：

```sh
NODE_USE_ENV_PROXY=1 dsh web
```

插件组合包会自动插入：

```yaml
- id: project-mcp
  name: dsh-project-mcp
```

确认 profile 组合：

```sh
dsh --profile web --dump-config
```

如果通过 Git 安装，pnpm 可能要求在 profile 的 `pnpm-workspace.yaml` 中允许该包执行 `prepare` 构建。发布后的 npm 包或本地 tarball 不需要此授权。

## 配置

可在 profile 的 `cordis.patch.yml` 覆盖整行配置：

```yaml
- id: project-mcp
  name: dsh-project-mcp
  config:
    projectRoot: ''
    configPath: .mcp.json
    requireConfig: false
    toolCallTimeoutMs: 60000
    failOnStartupError: false
    reconnect: true
```

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `projectRoot` | `''` | 空字符串表示每个 Agent 的会话工作目录；仅无 cwd 的非标准 Agent 才回退到 Host 的 `process.cwd()`。配置非空值会强制所有 Agent 使用同一个目录 |
| `configPath` | `.mcp.json` | 相对 `projectRoot` 的路径，也可使用绝对路径 |
| `requireConfig` | `false` | 文件不存在时是否拒绝插件加载 |
| `toolCallTimeoutMs` | `60000` | 每个 MCP 工具调用的超时 |
| `failOnStartupError` | `false` | 任一 MCP server 初始连接或工具同步失败时是否拒绝加载 |
| `reconnect` | `true` | 连接丢失后是否由 MCP client 自动重连 |

配置文件在 Agent 创建时读取。修改 `.mcp.json` 后，新建或重新打开一个会话即可使用新配置；当前存活 Agent 不会自动重载。

## 多会话同名 MCP

官方 `@deepseek-ai/dsh-mcp-client@0.1.0-rc.6` 默认把 `serverName` 作为整个 Host 进程内的唯一名称，会导致第二个 Agent 无法加载同一个项目的 `bytebase`、`dynamic-ops` 等 namespace。本项目通过 `pnpm patch` 将名称占用范围调整为 `ctx.agent ?? ctx.root`：不同 Agent 可以注册相同 namespace，同一 Agent或全局层内部仍拒绝重复名称。

补丁声明和文件位于：

- `pnpm-workspace.yaml` 的 `patchedDependencies`
- `patches/@deepseek-ai__dsh-mcp-client@0.1.0-rc.6.patch`

源码 `link:` 开发时，在本项目执行 `pnpm install` 即会应用补丁。该补丁属于安装根项目配置，单独发布的插件 tarball 不会自动要求消费者应用它。

## 开发

```sh
pnpm install
pnpm run check
pnpm pack
```

本项目目标版本是 DeepSeek Harness `0.1.0-rc.6`、Cordis `4.0.1` 和 `@deepseek-ai/dsh-mcp-client` `0.1.0-rc.6`。
