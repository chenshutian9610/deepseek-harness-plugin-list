# 交接

## 当前状态

- “过程详情”通过 `conversation.session.header.utilities` slot 显示在会话标题栏。
- 开关使用 Harness session-scoped `defineStore`，每个会话独立保存显隐偏好；切换会话、刷新页面或重启 Web 不会串改其他会话。
- `src/client/styles.css` 中开关高度为 32px、圆角为 16px，与相邻的 Session log、Terminal 胶囊按钮保持一致。
- DOM 标记和过程行过滤规则未改动。

## 验证

- 交付前运行 `pnpm run check`。
