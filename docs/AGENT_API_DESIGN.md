# Doco 开放 API 设计

本文件原先记录的是基于 Python、`ydoc_updates` 增量表和位置型块 ID 的早期草案，已经不适用于当前架构。

当前正式设计见：[开放API-v1设计方案.md](./开放API-v1设计方案.md)。

实现时禁止继续使用旧草案中的以下方案：

- 不使用 `paragraph_5` 一类随位置变化的块 ID。
- 不恢复已经移除的 Python/FastAPI 协同后端。
- 不向 `ydoc_updates` 追加增量；当前持久化模型是 `ydoc_state` 合并快照。
- 不把增量 update 应用到空白 `Y.Doc` 后再重编码。
- 不让开放 API 直接复用页面 Session Cookie 或页面内部路由。
