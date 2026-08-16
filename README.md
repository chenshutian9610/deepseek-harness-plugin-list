# DeepSeek Harness Monorepo

DeepSeek Harness Web 定制版及相关插件的统一代码仓库。各项目保留原有包管理器、锁文件和独立构建方式。

| 项目 | 路径 | 说明 |
| --- | --- | --- |
| `deepseek-harness-web` | [`packages/deepseek-harness-web`](packages/deepseek-harness-web/README.md) | 支持局域网登录与移动端适配的 Web 定制版 |
| `dsh-chat-process-visibility` | [`packages/deepseek-harness-chat-plugin`](packages/deepseek-harness-chat-plugin/README.md) | 按会话控制过程详情显隐 |
| `dsh-project-mcp` | [`packages/deepseek-harness-mcp-plugin`](packages/deepseek-harness-mcp-plugin/README.md) | 加载项目级 `.mcp.json` |
| `dsh-web-mermaid` | [`packages/deepseek-harness-mermaid-plugin`](packages/deepseek-harness-mermaid-plugin/README.md) | 在 Web UI 中渲染 Mermaid 代码块 |
| `dsh-web-terminal` | [`packages/deepseek-harness-terminal-plugin`](packages/deepseek-harness-terminal-plugin/README.md) | 在 Web UI 中提供交互式终端 |

## Web 定制版

在官方版本基础上：

- 增加局域网支持，包含登录页面和移动端 UI 适配
- 去除 DeepSeek Web Search
- 去除 OpenAI、Anthropic 以外的供应商支持
- 去除 sandbox，避免模型频繁因 sandbox 报错

## 插件预览

### Mermaid

![](img/mermaid.png)

### Terminal

![](img/terminal.png)

### Chat

![](img/chat.png)

## 开发技能

插件开发可使用独立的 [`deepseek-harness-plugin-skill`](skills/deepseek-harness-plugin-skill/README.md)。

进入对应项目目录后，使用该项目 README 中记录的安装、检查和构建命令。Web 项目使用 npm，插件项目使用 pnpm。
