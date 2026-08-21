---
name: doco
description: Use Doco as a block-addressable knowledge base with evidence-aware search and version-protected writes.
---

# Doco 操作协议

Doco 是人与 Agent 协同编辑的知识库。默认先读后写，任何写入都必须保护并发版本。

## 接入

MCP server 名称是 `doco`，由插件自动启动：

```bash
claude mcp add doco -- npx -y --package doco-agent-cli doco mcp
```

## 黄金循环

1. 先用 `doco_search_v2`、`doco_outline` 或 `doco_get_blocks` 定位目标，并记录文档 `version`。
2. 写入优先使用块级工具；携带 `base_version`，让客户端发送 `If-Match`。
3. 遇到 `409 conflict`，重新读取最新版，合并改动后重试；绝不盲目覆盖。
4. 写入后重新读取权威正文，确认目标块、版本和相关投影状态。

## 证据边界

- `projection.complete=false`、`stale`、`dangling` 不能包装成确定事实。
- 候选概念必须人工接受后才算规范概念。
- Token 只由本地登录配置提供；不要打印、复制或写入文档。
