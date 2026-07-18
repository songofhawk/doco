# Doco 开放 API v1

Doco 开放 API 面向 Agent、脚本和第三方应用，用于管理知识库、文件夹、文档正文、块和附件。

- API 根地址：`{DOCO_ORIGIN}/api/v1`
- 鉴权方式：`Authorization: Bearer <API_TOKEN>`
- OpenAPI 3.1 规范：`{DOCO_ORIGIN}/api/openapi.json`
- 本文 Markdown 原文：`{DOCO_ORIGIN}/api-docs.md`

> 将 `{DOCO_ORIGIN}` 替换为 Doco 实例地址，例如 `https://doco-editor.showme.talk`。开放 API 使用 Bearer Token；浏览器页面使用的 Session Cookie 不能调用 `/api/v1/*`。

## 快速开始

### 1. 创建 Token

登录 Doco 后，在右上角账户菜单中打开「API 管理」，创建只读或读写 Token。完整 Token 只显示一次，请勿提交到代码仓库或日志。

### 2. 验证身份

```bash
export DOCO_BASE_URL="https://doco-editor.showme.talk"
export DOCO_API_TOKEN="doco_tok_xxx_secret"

curl --fail-with-body \
  -H "Authorization: Bearer $DOCO_API_TOKEN" \
  "$DOCO_BASE_URL/api/v1/me"
```

成功响应统一包含 `data` 和 `request_id`：

```json
{
  "data": {
    "user": {
      "id": "user_123",
      "email": "agent@example.com",
      "name": "Agent User"
    },
    "scopes": ["documents:read", "documents:write"],
    "token_id": "tok_01..."
  },
  "request_id": "req_01..."
}
```

### 3. 创建知识库和文档

```bash
KB_RESPONSE=$(curl --fail-with-body -sS \
  -X POST \
  -H "Authorization: Bearer $DOCO_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: create-agent-kb-001" \
  -d '{"name":"Agent 知识库"}' \
  "$DOCO_BASE_URL/api/v1/knowledge-bases")

# 把下方 123 替换为上一步 data.id
curl --fail-with-body \
  -X POST \
  -H "Authorization: Bearer $DOCO_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: create-agent-doc-001" \
  -d '{
    "title": "API 创建的文档",
    "knowledge_base_id": 123,
    "content": {
      "format": "markdown",
      "content": "# Hello Doco\n\n这篇文档由 API 创建。"
    }
  }' \
  "$DOCO_BASE_URL/api/v1/documents"
```

## 鉴权与权限

Token 支持以下 scopes：

| Scope | 能力 |
| --- | --- |
| `documents:read` | 读取文档、正文和块 |
| `documents:write` | 创建、修改、移动和删除文档与块 |
| `knowledge-bases:read` | 读取知识库、文件夹和目录树 |
| `knowledge-bases:write` | 创建、修改和删除知识库与文件夹 |
| `attachments:read` | 下载附件和读取附件元数据 |
| `attachments:write` | 上传和删除附件 |

每个请求都应携带：

```http
Authorization: Bearer doco_tok_xxx_secret
```

Token 缺失或失效返回 `401`，scope 不足返回 `403`。为避免越权泄露，不属于当前账户的资源通常返回 `404`。

## 通用约定

### 响应结构

单资源成功响应：

```json
{
  "data": {},
  "request_id": "req_01..."
}
```

列表成功响应：

```json
{
  "data": [],
  "page": {
    "cursor": null,
    "next_cursor": null,
    "has_more": false
  },
  "request_id": "req_01..."
}
```

错误响应：

```json
{
  "error": {
    "type": "request_error",
    "code": "invalid_request",
    "message": "可读的错误信息",
    "details": {}
  },
  "request_id": "req_01..."
}
```

### 请求追踪与限频

- 可传 `X-Request-Id`；服务端也会在响应中返回 `X-Request-Id`。
- 限频信息通过 `X-RateLimit-Limit`、`X-RateLimit-Remaining`、`X-RateLimit-Reset` 返回。
- 超过限频返回 `429`，同时提供 `Retry-After`。

### 分页

列表接口使用游标分页：

```http
GET /api/v1/documents?limit=50&cursor=<next_cursor>
```

`limit` 范围为 `1` 到 `100`。继续请求时使用上一页 `page.next_cursor`。

### 幂等写入

创建资源、上传附件和批量操作支持：

```http
Idempotency-Key: <最多 128 个字符的稳定键>
```

相同 Token、方法、路径和请求体使用相同键时会返回首次结果；同一个键配合不同请求体返回 `409`。

### 并发控制

正文和块读取响应会返回 `ETag`。替换整篇正文必须通过 `If-Match` 提交当前版本：

```bash
curl -i \
  -H "Authorization: Bearer $DOCO_API_TOKEN" \
  "$DOCO_BASE_URL/api/v1/documents/doc_123/content?format=markdown"

curl --fail-with-body \
  -X PUT \
  -H "Authorization: Bearer $DOCO_API_TOKEN" \
  -H 'If-Match: "sha256:从上一步响应取得"' \
  -H "Content-Type: application/json" \
  -d '{"format":"markdown","content":"# 新正文"}' \
  "$DOCO_BASE_URL/api/v1/documents/doc_123/content"
```

缺少必须的 `If-Match` 返回 `428`，版本冲突返回 `409`。收到冲突后应重新读取正文、合并改动，再重试；不要盲目覆盖。

## API 一览

### 身份

| 方法 | 路径 | Scope | 说明 |
| --- | --- | --- | --- |
| `GET` | `/me` | 任一有效 Token | 返回调用者和 Token scopes |

### 知识库

| 方法 | 路径 | Scope | 说明 |
| --- | --- | --- | --- |
| `GET` | `/knowledge-bases` | `knowledge-bases:read` | 列出知识库 |
| `POST` | `/knowledge-bases` | `knowledge-bases:write` | 创建知识库 |
| `GET` | `/knowledge-bases/{id}` | `knowledge-bases:read` | 获取知识库 |
| `PATCH` | `/knowledge-bases/{id}` | `knowledge-bases:write` | 重命名知识库 |
| `DELETE` | `/knowledge-bases/{id}` | `knowledge-bases:write` | 删除知识库及其内容，正文需传 `confirm_id` |
| `GET` | `/knowledge-bases/{id}/tree` | `knowledge-bases:read` | 获取完整文件夹与文档树 |
| `GET` | `/knowledge-bases/{id}/export` | `knowledge-bases:read` + `documents:read` | 导出 ZIP |

创建知识库：

```json
{ "name": "产品知识库" }
```

删除知识库：

```json
{ "confirm_id": "kb_123" }
```

### 文件夹

| 方法 | 路径 | Scope | 说明 |
| --- | --- | --- | --- |
| `POST` | `/folders` | `knowledge-bases:write` | 创建文件夹 |
| `GET` | `/folders/{id}` | `knowledge-bases:read` | 获取文件夹 |
| `PATCH` | `/folders/{id}` | `knowledge-bases:write` | 重命名或移动文件夹 |
| `DELETE` | `/folders/{id}` | `knowledge-bases:write` | 删除文件夹及其内容 |
| `GET` | `/folders/{id}/children` | `knowledge-bases:read` + `documents:read` | 获取直接子文件夹和文档 |

创建或移动文件夹：

```json
{
  "name": "接口设计",
  "knowledge_base_id": 123,
  "parent_id": null
}
```

### 文档

| 方法 | 路径 | Scope | 说明 |
| --- | --- | --- | --- |
| `GET` | `/documents` | `documents:read` | 搜索或筛选文档 |
| `POST` | `/documents` | `documents:write` | 创建文档，可同时写入正文 |
| `GET` | `/documents/{id}` | `documents:read` | 获取文档元数据 |
| `PATCH` | `/documents/{id}` | `documents:write` | 修改标题、位置和设置 |
| `DELETE` | `/documents/{id}` | `documents:write` | 删除文档、正文和附件 |
| `GET` | `/documents/{id}/path` | `documents:read` | 获取知识库与文件夹路径 |

文档列表支持：

```http
GET /documents?q=关键词&knowledge_base_id=123&folder_id=456&limit=50
```

创建文档请求：

```json
{
  "title": "接口设计",
  "knowledge_base_id": 123,
  "folder_id": null,
  "document_type": "document",
  "heading_numbered": false,
  "background_color": "#faf9f5",
  "collapsed_block_ids": [],
  "content": {
    "format": "markdown",
    "content": "# 接口设计\n\n正文"
  }
}
```

`document_type` 可为 `document` 或 `spreadsheet`。

### 正文

| 方法 | 路径 | Scope | 说明 |
| --- | --- | --- | --- |
| `GET` | `/documents/{id}/content` | `documents:read` | 读取正文 |
| `PUT` | `/documents/{id}/content` | `documents:write` | 替换整篇正文，必须传 `If-Match` |

读取时可通过 `format` 选择：

- `tiptap-json`：无损标准格式，适合结构化编辑。
- `markdown`：便于 Agent 阅读与生成，复杂节点可能返回降级警告。
- `html`：经过服务端清洗的 HTML。

写入 Markdown：

```json
{
  "format": "markdown",
  "content": "# 标题\n\n- 第一项\n- 第二项"
}
```

写入 Tiptap JSON：

```json
{
  "format": "tiptap-json",
  "document": {
    "type": "doc",
    "content": [
      {
        "type": "paragraph",
        "attrs": { "id": "block_01JXYZ0123456789ABCDEFGHJK" },
        "content": [{ "type": "text", "text": "Hello" }]
      }
    ]
  }
}
```

服务端会为缺少 ID 的块补充稳定 ID。块 ID 格式为 `block_<ULID>`。

### 块

| 方法 | 路径 | Scope | 说明 |
| --- | --- | --- | --- |
| `GET` | `/documents/{id}/blocks` | `documents:read` | 获取顶层块；`recursive=true` 返回所有层级 |
| `GET` | `/documents/{id}/blocks/{blockId}` | `documents:read` | 获取指定块 |
| `POST` | `/documents/{id}/blocks` | `documents:write` | 插入一个或多个块 |
| `PATCH` | `/documents/{id}/blocks/{blockId}` | `documents:write` | 替换节点、属性或内容 |
| `DELETE` | `/documents/{id}/blocks/{blockId}` | `documents:write` | 删除块 |
| `POST` | `/documents/{id}/batch` | `documents:write` | 在单个 Yjs 事务内执行最多 100 个操作 |

插入块时，`position` 必须且只能指定一种定位方式：`document_start`、`document_end`、`before_block_id`、`after_block_id` 或 `parent_block_id`。

```json
{
  "position": { "document_end": true },
  "nodes": [
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "追加内容" }]
    }
  ]
}
```

批量操作：

```json
{
  "base_version": "sha256:当前版本",
  "operations": [
    {
      "op": "insert",
      "position": { "document_end": true },
      "nodes": [{ "type": "paragraph", "content": [{ "type": "text", "text": "新增段落" }] }]
    },
    {
      "op": "delete",
      "block_id": "block_01JXYZ0123456789ABCDEFGHJK"
    }
  ]
}
```

批量操作支持 `insert`、`delete` 和 `replace`。`replace` 需提交 `block_id` 与完整 `node`。整个批次要么全部成功，要么全部失败；修改单个块的属性或内容可使用块 `PATCH` 接口。

### 附件

| 方法 | 路径 | Scope | 说明 |
| --- | --- | --- | --- |
| `POST` | `/attachments` | `attachments:write` | 以 `multipart/form-data` 上传附件 |
| `GET` | `/attachments/{id}` | `attachments:read` | 下载附件 |
| `GET` | `/attachments/{id}/metadata` | `attachments:read` | 读取附件元数据 |
| `DELETE` | `/attachments/{id}` | `attachments:write` + `documents:write` | 删除附件；被正文引用时需 `force=true` |

```bash
curl --fail-with-body \
  -X POST \
  -H "Authorization: Bearer $DOCO_API_TOKEN" \
  -H "Idempotency-Key: upload-cover-001" \
  -F "document_id=doc_123" \
  -F "file=@cover.png" \
  "$DOCO_BASE_URL/api/v1/attachments"
```

正文图片节点应保存 `attachmentId`。服务端会把 `src` 规范化为 `/api/v1/attachments/{id}`。强制删除被引用附件时，服务端也会移除相应图片节点。

## Agent 使用建议

1. 启动时先调用 `/me`，确认 Token 有效及 scopes 足够。
2. 优先通过 `/knowledge-bases/{id}/tree` 获取结构，减少多次遍历。
3. 阅读正文时使用 `format=markdown`；需要无损结构化修改时使用 `tiptap-json` 或块 API。
4. 修改前保存 `ETag`；遇到 `409` 重新读取并合并，不要覆盖他人的更新。
5. 对可重试的创建、上传和批量请求使用稳定的 `Idempotency-Key`。
6. 记录 `request_id`，排查问题时可关联服务端审计日志。
7. 读取列表直到 `has_more=false`，不要假设第一页包含全部数据。

## 机器可读规范

完整字段、Schema、状态码和约束以运行时 OpenAPI 3.1 文档为准：

```bash
curl --fail-with-body "$DOCO_BASE_URL/api/openapi.json"
```

如果本文与机器可读规范不一致，应以 `/api/openapi.json` 和实际响应为准，并提交文档修正。
