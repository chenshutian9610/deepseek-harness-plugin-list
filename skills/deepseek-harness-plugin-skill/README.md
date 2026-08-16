# DeepSeek Harness 插件开发 Skill

`deepseek-harness-plugin-skill` 用于创建、修改、调试、测试、打包和发布 DeepSeek Harness/Cordis 插件。Skill 内置一份版本化文档快照，离线且没有 Harness 源码 checkout 时也能完成文档路由；目标项目的 TypeScript 导出负责版本敏感的 API 签名。

## 文档快照版本

| 项目 | 当前记录 |
|---|---|
| 仓库 | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) |
| 项目版本 | `0.1.0-rc.5` |
| 快照提交 | [`47f943859bef60e4160492346772ded9b24f765a`](https://github.com/deepseek-ai/deepseek-harness/commit/47f943859bef60e4160492346772ded9b24f765a) |
| 提交时间 | `2026-08-13T19:38:46+08:00` |
| 快照记录时间 | `2026-08-15` |
| 上游文档入口 | [`docs/user/develop/`](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a/docs/user/develop) |
| 本地快照入口 | `references/deepseek-harness/docs/user/develop/` |
| 上游许可证 | MIT，副本见 `references/deepseek-harness/LICENSE` |

快照固定在表中的完整提交，Skill 默认读取该副本，不需要联网或另行设置 Harness 仓库。若目标项目依赖其他 Harness 版本，以目标项目安装的 TypeScript 声明和源码为准；Skill 会指出与快照不兼容的部分，而不是假设旧 API 仍然有效。

快照包含完整的中英文插件开发入口，以及流程直接需要的 cookbook、subsystem、Cordis 教程、架构、生命周期防御规则、能力与事件参考、CLI 参考和相关配置示例。实现源码没有复制进 Skill；需要核对未公开实现时，可使用目标依赖中的源码或可选的 Harness checkout。

## 安装与使用

安装结构：

```text
~/.agents/skills/deepseek-harness-plugin-skill/
├── SKILL.md
├── README.md
└── references/
    └── deepseek-harness/
        ├── LICENSE
        ├── README.md
        ├── docs/
        ├── apps/cli/reference/
        └── packages/
```

支持模型自动调用，也可以通过名称 `deepseek-harness-plugin-skill` 显式调用。`$DEEPSEEK_HARNESS_REPO` 是可选的，仅用于核对当前源码或修改 Harness 本仓库：

```sh
export DEEPSEEK_HARNESS_REPO=/path/to/deepseek-harness
```

Skill 文件和文档快照没有运行时依赖。执行插件开发和验证时，需要目标项目要求的 Node.js、pnpm、`dsh` 以及相应凭据；Skill 不读取或保存凭据。

## 快照范围

以下路径从同一提交原样复制，并保留上游目录结构：

- `README.md`、`LICENSE`
- `docs/user/develop/`
- `docs/cookbook/`
- `docs/subsystems/`
- `docs/cordis-tutorial/`
- `docs/architecture.md`
- `docs/defensive-patterns.md`
- `docs/capability-seams.md`
- `docs/event-producer-consumer.md`
- `apps/cli/reference/`
- `packages/boot/cmdline/README.md`
- `packages/bundle/web-app/cordis.patch.yml`

快照中的链接如果指向范围外的源码或文档，需要从目标项目依赖或可选 checkout 读取。

## 维护

Harness 文档或版本升级后，在 Harness 仓库根目录执行以下同步；不要直接修改快照文件：

```sh
snapshot="$HOME/.agents/skills/deepseek-harness-plugin-skill/references/deepseek-harness"
rm -rf "$snapshot"
mkdir -p "$snapshot"
rsync -aR \
  README.md LICENSE \
  docs/user/develop docs/cookbook docs/subsystems docs/cordis-tutorial \
  docs/architecture.md docs/defensive-patterns.md \
  docs/capability-seams.md docs/event-producer-consumer.md \
  apps/cli/reference packages/boot/cmdline/README.md \
  packages/bundle/web-app/cordis.patch.yml \
  "$snapshot/"
```

随后：

1. 检查 `docs/user/develop/` 及其引用目标的变更；如果新增了必要目标，把它加入快照范围。
2. 当入口、任务分支、插件生命周期或验证流程变化时更新 `SKILL.md`。
3. 用新快照完成一次相关插件的文档路由和最小验证流程。
4. 更新本页的项目版本、完整提交 SHA、提交时间和记录时间。
5. 确认 `SKILL.md` 的 YAML Frontmatter 可解析，所有 Markdown 文件以一个换行结尾。

版本信息可在 Harness 仓库根目录获取：

```sh
git rev-parse HEAD
git show -s --format='%cI' HEAD
node -p "require('./package.json').version"
```
