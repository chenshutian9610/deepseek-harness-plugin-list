# deepseek-harness-web-project-mcp

`deepseek-harness-web` 的内置 Host 插件。每个 Agent 创建时，它会读取该会话工作目录（`session.header.cwd`）中的 Claude Code 风格 `.mcp.json`，并在 `agent.ctx` 下挂载 MCP client，因此 MCP 工具只对对应 Agent 可见。Wrapper 显式持有所有 child Fibers；Agent 销毁、wrapper 卸载、启动失败或 Host 关闭时都会等待相应连接、工具与子进程完成清理。构建后的 ESM 由 Web 的 Cordis composition 通过 `./project-mcp/lib/index.js` 直接加载，运行时依赖声明在 Web 根 manifest 中，不使用嵌套 `file:` dependency。

## 内置 MCP client fork

`src/mcp-client/` fork 自官方 `@deepseek-ai/dsh-mcp-client@0.1.0-rc.8`，上游源码为 DeepSeek Harness revision `141eb6fef83422698aef7a981029e843e8161534`。本地唯一有意的行为差异是将存活 `serverName` 的占用范围从 `ctx.root` 改为 `ctx.agent ?? ctx.root`：

- 不同 Agent 可以同时挂载相同 MCP namespace；
- 同一个 Agent 内重复 namespace 仍然失败；
- 没有 Agent 作用域的全局实例仍按 Host root 保持唯一；
- dispose 一个 Agent 只释放该 Agent 的名称占用和工具。

这份 fork 直接包含在 Web 发布物中，不依赖 pnpm `patchedDependencies`，也不作为通用替代包发布。同步官方 MCP client 时，应从上述上游版本比较 `src/`，重新应用这一处作用域差异，并运行 Web 的 MCP 回归检查。

上游和本地修改均按随附的 MIT `LICENSE` 分发。

## `.mcp.json`

支持 stdio 和 Streamable HTTP：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
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

`mcpServers` 的 key 必须满足 `[A-Za-z0-9_-]{1,32}`，模型看到的工具名形如 `mcp__filesystem__read_file`。文件不存在时默认不报错；修改配置后，新建或重新打开会话即可加载新配置。

`.mcp.json` 可以启动任意本机程序，且该启动不经过 Agent 工具沙箱。只应在可信项目中使用，并避免把明文凭据提交到仓库。
