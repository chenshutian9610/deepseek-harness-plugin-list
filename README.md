# DeepSeek Harness Monorepo

DeepSeek Harness Web 定制版及相关插件的统一代码仓库。各项目保留原有包管理器、锁文件和独立构建方式。

| 项目 | 路径 | 说明 |
| --- | --- | --- |
| `deepseek-harness-web` | [`packages/deepseek-harness-web`](packages/deepseek-harness-web/README.md) | 支持局域网登录、移动端适配与内置项目级 MCP 的 Web 定制版 |
| `dsh-chat-process-visibility` | [`packages/deepseek-harness-chat-plugin`](packages/deepseek-harness-chat-plugin/README.md) | 按会话控制过程详情显隐 |
| `dsh-web-mermaid` | [`packages/deepseek-harness-mermaid-plugin`](packages/deepseek-harness-mermaid-plugin/README.md) | 在 Web UI 中渲染 Mermaid 代码块 |
| `dsh-web-terminal` | [`packages/deepseek-harness-terminal-plugin`](packages/deepseek-harness-terminal-plugin/README.md) | 在 Web UI 中提供交互式终端 |

## Web 定制版

在官方版本基础上：

- 增加局域网支持，包含登录页面和移动端 UI 适配
- 去除 DeepSeek Web Search
- 去除 OpenAI、Anthropic 以外的供应商支持
- 去除 sandbox，避免模型频繁因 sandbox 报错
- 内置项目级 `.mcp.json` 加载，并携带 Agent 作用域的官方 rc.8 MCP client fork

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

## 一键准备与启动

首次拉取仓库或插件依赖变化后，在仓库根目录运行：

```sh
npm run bootstrap
```

该命令会扫描 `packages/` 中声明了 `dsh.bundle` 的插件，分别执行 `pnpm install --frozen-lockfile` 和 `pnpm run build`，然后安装 Web 的生产依赖。它不会向 `$DSH_HOME` 安装插件。

启动方式：

```sh
npm run web      # packages/deepseek-harness-web/start.sh
npm run web_lan  # packages/deepseek-harness-web/start_lan.sh
```

两个启动脚本会自动加载同级 `packages/` 下已构建的插件 bundle；本地插件与 `$DSH_HOME/profiles/web` 中同名的 bundle 同时存在时，优先使用仓库中的本地版本。

## 构建发行包

构建当前平台：

```sh
npm run dist
```

构建全部支持的平台／架构：

```sh
npm run build:all
```

`build:all` 会依次生成 `darwin-arm64`、`darwin-x64`、`linux-arm64`、`linux-x64`、`win32-arm64` 和 `win32-x64` 六套发行包。

构建命令会构建所有同级插件，在临时目录安装目标平台的 Web 生产依赖并组装插件 tarball，裁剪 `node-pty` 的其他系统／架构预构建文件，然后生成：

```text
dist/deepseek-harness-web-<version>-<platform>-<arch>/
dist/deepseek-harness-web-<version>-<platform>-<arch>.tar.gz
```

发行目录不包含 Node.js，也不需要在部署位置执行 `npm install`。目标机器需要安装项目声明的兼容 Node.js。Linux 包同时携带 glibc 与 musl 的 Sharp 依赖，但仍建议在目标环境做启动验证。解压后运行 `start.sh`，Windows 使用 `start.cmd`；目录可以整体移动，不依赖原仓库或同级插件路径。跨平台构建时只能在当前机器运行纯 JavaScript 与插件入口检查；目标平台的原生模块和完整 `check.mjs` 检查需要在对应系统／架构运行。
