# Doco 开放 API v1 设计方案

> 状态：已确认设计，待实现  
> 日期：2026-07-15  
> 适用架构：React + Tiptap v3 + Yjs + Hocuspocus + Express + SQLite

## 1. 背景

Doco 当前提供两类服务能力：

1. 页面通过 `/api/*` 调用知识库、文件夹和文档元数据接口，使用 Google 登录后的 httpOnly Session Cookie。
2. 页面通过 `/ws` 连接 Hocuspocus，以 Yjs 协议同步正文。

现有接口主要服务浏览器页面，存在以下限制：

- 外部程序必须模拟浏览器登录和 Cookie，无法使用长期、可撤销的 API 凭证。
- 页面 API 与未来开放 API 没有边界，无法独立进行版本管理、限频和错误格式演进。
- 文档正文只能导出 Markdown，没有无损的开放读写格式。
- Markdown 无法完整表达 Tiptap 文档中的表格属性、颜色、对齐、图片尺寸、Callout、折叠等能力。
- 旧版 Agent API 草案依赖已移除的 Python 后端和 `ydoc_updates` 表，块 ID 还会随文档位置变化，不能用于当前实现。

本次升级目标是提供一套独立、版本化、可限频、覆盖完整文档能力的开放 API，同时保持页面编辑和 API 编辑都通过同一个 Yjs 文档状态实时同步。

## 2. 设计目标

### 2.1 必须实现

- 页面内部 API 与开放 API 在路由、鉴权、中间件、错误格式和限频上明确分离。
- 开放 API 使用 Bearer Token，不接受页面 Session Cookie。
- Token 必须绑定用户，并复用现有工作区、知识库和文档权限边界。
- 开放 API 覆盖页面已有的知识库、文件夹、文档管理功能。
- 开放 API 支持无损读取和写入完整 Tiptap 文档。
- 支持 Markdown、HTML 的便捷导入导出，并明确返回有损转换警告。
- 支持稳定块 ID，以及块级插入、修改、删除和批量操作。
- API 正文写入必须成为正常 Yjs 事务，并同步到在线页面。
- 提供附件上传和图片节点引用能力。
- 提供限频、分页、统一错误、请求 ID、乐观并发控制和幂等创建。
- 提供 OpenAPI 3.1 规范和可执行调用示例。

### 2.2 非目标

- v1 不把 Hocuspocus/Yjs 二进制协议作为开放 API。
- v1 不允许 API Token 建立 `/ws` 协同连接。
- v1 不实现跨工作区共享或新角色模型；沿用当前用户可访问工作区的规则。
- v1 不承诺 Markdown 或 HTML 与 Tiptap JSON 之间完全无损互转。
- v1 不引入 Redis；当前生产为单后端进程，限频先使用进程内存储，并保留替换接口。

## 3. 总体架构

```text
浏览器页面
  ├─ /app-api/v1/* ─ Session Cookie ─┐
  └─ /ws ─ Session Cookie ───────────┤
                                      ├─ 共享业务服务 ─ 权限服务 ─ SQLite 元数据
外部调用方                           │                 └─ YDoc 服务
  └─ /api/v1/* ─ Bearer API Token ───┘                      ├─ 在线 Hocuspocus Y.Doc
                                                           └─ ydoc_state 快照
```

路由划分：

| 能力 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| 页面登录 | `/app-api/v1/auth/*` | Google Credential / Session Cookie | 页面登录、退出、当前用户 |
| 页面业务 | `/app-api/v1/*` | Session Cookie | Doco 页面专用 |
| Token 管理 | `/app-api/v1/api-tokens/*` | Session Cookie | 创建、查看、撤销开放 API Token |
| 开放 API | `/api/v1/*` | Bearer Token | 脚本、Agent、第三方系统 |
| API 规范 | `/api/openapi.json` | 无鉴权 | OpenAPI 3.1 文档 |
| 协同同步 | `/ws` | Session Cookie | 页面 Yjs/Hocuspocus 连接 |

迁移完成后，前端不再调用旧 `/api/*` 页面路由。旧路径在开发阶段可短期保留并记录弃用日志，正式发布前移除，避免形成永久兼容层。

## 4. 分层原则

不能复制两套业务实现。后端应拆分为四层：

```text
Router
  ├─ app-api router：Cookie 鉴权、页面响应适配
  └─ open-api router：Token 鉴权、限频、开放响应适配
          ↓
Service：知识库、文件夹、文档、正文、附件业务规则
          ↓
Repository / Permission：SQLite 查询和用户权限
          ↓
YDoc Service：加载、修改、广播、持久化 Y.Doc
```

Router 只负责协议层工作，不直接编写复杂 SQL 或操作 Yjs。页面 API 和开放 API 共享 Service，因此权限、删除级联、移动校验和正文行为保持一致。

## 5. API Token

### 5.1 Token 格式

```text
doco_<token_id>_<secret>
```

- `token_id` 用于快速定位数据库记录，可公开显示。
- `secret` 至少使用 32 字节安全随机数并以 base64url 编码。
- 完整 Token 只在创建成功时返回一次。
- 数据库只保存 `secret` 的 SHA-256 哈希，不保存明文。
- 日志、错误和审计信息只显示 Token 前缀和末四位。

### 5.2 数据表

```sql
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  scopes TEXT NOT NULL,
  expires_at INTEGER,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_api_tokens_user_id ON api_tokens(user_id);
```

`scopes` v1 支持：

- `documents:read`
- `documents:write`
- `knowledge-bases:read`
- `knowledge-bases:write`
- `attachments:read`
- `attachments:write`

页面创建 Token 时可以选择“只读”或“读写”，服务端展开为明确 scopes。任何写操作都不能因为用户拥有工作区而跳过 scope 检查。

### 5.3 Token 页面接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/app-api/v1/api-tokens` | 查询当前用户的 Token，不返回 secret |
| `POST` | `/app-api/v1/api-tokens` | 创建 Token，唯一一次返回完整 Token |
| `DELETE` | `/app-api/v1/api-tokens/:id` | 撤销 Token |

## 6. 开放 API 通用约定

### 6.1 请求头

```http
Authorization: Bearer doco_xxx
Content-Type: application/json
Accept: application/json
X-Request-Id: optional-client-id
Idempotency-Key: optional-create-key
```

### 6.2 成功响应

单对象直接放在 `data`：

```json
{
  "data": {
    "id": "doc_123",
    "title": "设计文档"
  },
  "request_id": "req_01JXYZ"
}
```

列表响应：

```json
{
  "data": [],
  "page": {
    "cursor": null,
    "next_cursor": "cursor_xxx",
    "has_more": true
  },
  "request_id": "req_01JXYZ"
}
```

默认 `limit=50`，最大 `limit=100`，采用游标分页，不使用会在并发新增时漂移的页码分页。

### 6.3 错误响应

```json
{
  "error": {
    "type": "conflict_error",
    "code": "document_version_conflict",
    "message": "文档已被其他调用方修改",
    "details": {
      "current_version": "v_02"
    }
  },
  "request_id": "req_01JXYZ"
}
```

主要状态码：

| 状态码 | 语义 |
|---|---|
| `400` | 请求格式或字段非法 |
| `401` | Token 缺失、非法、过期或已撤销 |
| `403` | scope 不足或用户无资源权限 |
| `404` | 资源不存在；无权访问的资源也返回 404，避免枚举 |
| `409` | 版本冲突、幂等键冲突、资源状态冲突 |
| `413` | 正文或附件超过限制 |
| `415` | 不支持的正文格式或媒体类型 |
| `422` | 文档结构不符合 Schema |
| `429` | 请求超过限频 |
| `500` | 未预期服务端错误 |

### 6.4 幂等

以下创建接口支持 `Idempotency-Key`：

- 创建知识库
- 创建文件夹
- 创建文档
- 上传附件
- 批量正文操作

同一 Token、同一路径、同一幂等键和相同请求体重复调用时返回首次结果；请求体不同时返回 `409 idempotency_key_conflict`。幂等记录默认保留 24 小时。

## 7. 资源接口

### 7.1 当前调用方

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/me` | 返回 Token 所属用户和 scopes |

### 7.2 知识库

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/knowledge-bases` | 列出可访问知识库 |
| `POST` | `/api/v1/knowledge-bases` | 创建知识库 |
| `GET` | `/api/v1/knowledge-bases/:id` | 获取知识库 |
| `PATCH` | `/api/v1/knowledge-bases/:id` | 重命名知识库 |
| `DELETE` | `/api/v1/knowledge-bases/:id` | 删除知识库及其内容 |
| `GET` | `/api/v1/knowledge-bases/:id/tree` | 一次获取文件夹和文档树 |
| `GET` | `/api/v1/knowledge-bases/:id/export` | 导出 ZIP |

删除知识库属于高风险操作，要求请求体显式携带：

```json
{ "confirm_id": "123" }
```

### 7.3 文件夹

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/folders/:id` | 获取文件夹 |
| `POST` | `/api/v1/folders` | 创建文件夹 |
| `PATCH` | `/api/v1/folders/:id` | 重命名或移动文件夹 |
| `DELETE` | `/api/v1/folders/:id` | 删除文件夹及其内容 |
| `GET` | `/api/v1/folders/:id/children` | 获取直接子文件夹和文档 |

移动文件夹必须校验：不能移动到自身或自身后代、目标知识库必须属于当前用户、整棵子树归属保持一致。

### 7.4 文档元数据

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/documents` | 搜索/筛选文档 |
| `POST` | `/api/v1/documents` | 创建文档，可同时提交初始正文 |
| `GET` | `/api/v1/documents/:id` | 获取元数据 |
| `PATCH` | `/api/v1/documents/:id` | 修改标题、位置和文档设置 |
| `DELETE` | `/api/v1/documents/:id` | 删除文档、正文状态和附件 |
| `GET` | `/api/v1/documents/:id/path` | 获取知识库/文件夹路径 |

可写文档设置包括：

- `title`
- `knowledge_base_id` / `folder_id`
- `heading_numbered`
- `background_color`
- `collapsed_block_ids`

## 8. 正文格式

### 8.1 标准格式：Tiptap JSON

开放 API 的无损标准格式是 Tiptap/ProseMirror JSON，媒体类型为：

```http
Content-Type: application/vnd.doco.document+json
```

根节点必须是：

```json
{
  "type": "doc",
  "content": []
}
```

支持的节点和 marks 必须与前端 `DocoEditor.tsx` 以及后端 `markdown.js` 的 Schema 保持同源。至少包括：

- 段落、标题、引用、分隔线、硬换行
- 有序列表、无序列表、列表项
- 任务列表、任务项
- 代码块及语言
- 表格、行、表头、单元格、`colspan`、`rowspan`、`colwidth`
- 图片、宽度、高度、替代文本、标题、对齐方式和附件引用
- Mermaid、PlantUML、Callout
- 链接、粗体、斜体、删除线、行内代码
- 文字样式、颜色、高亮、对齐

必须抽取一个后端共享 Schema 模块，正文验证、JSON 转 Yjs 和 Markdown 导出全部使用它。前端新增节点时，必须同步更新共享契约测试。

### 8.2 Markdown 和 HTML

Markdown 与 HTML 是便捷转换格式，不是存储格式：

- Markdown 导入后先解析为 ProseMirror JSON，再写入 Yjs。
- HTML 导入前必须执行白名单清洗，再解析为 ProseMirror JSON。
- 导出 Markdown/HTML 时返回 `warnings`，指出无法无损表达的属性。
- Mermaid 和 PlantUML 使用 fenced code block 表达。
- Callout 使用 Doco 扩展语法；调用方若要求通用 Markdown，可选择降级为引用块。

### 8.3 正文读取

```http
GET /api/v1/documents/:id/content?format=tiptap-json
```

响应：

```json
{
  "data": {
    "document_id": "doc_123",
    "format": "tiptap-json",
    "version": "sha256:abc...",
    "document": {
      "type": "doc",
      "content": []
    },
    "warnings": []
  },
  "request_id": "req_01JXYZ"
}
```

同时返回：

```http
ETag: "sha256:abc..."
```

`format` 支持 `tiptap-json`、`markdown`、`html`。

### 8.4 整文写入

```http
PUT /api/v1/documents/:id/content
If-Match: "sha256:abc..."
Content-Type: application/json
```

```json
{
  "format": "tiptap-json",
  "document": {
    "type": "doc",
    "content": []
  }
}
```

- 已存在正文时必须携带 `If-Match`，否则返回 `428 Precondition Required`。
- `If-Match` 与当前版本不一致时返回 `409 document_version_conflict`。
- 创建文档时提交初始正文不要求 `If-Match`。
- `PUT` 是语义上的整文替换，但底层必须通过正常 Yjs 事务更新共享 fragment，不能删除数据库历史表或绕过在线文档。

## 9. 稳定块 ID 与块级 API

### 9.1 块 ID

所有可单独操作的块节点增加 `attrs.id`：

```text
block_<ULID>
```

要求：

- 创建节点时生成，复制块时生成新 ID。
- 移动块保留原 ID。
- API 导入缺失 ID 时由服务端补齐。
- API 导入出现重复 ID 时返回 `422 duplicate_block_id`，不静默改写调用方提交的数据。
- 页面打开旧文档时，以一次 Yjs 迁移事务补齐缺失 ID；迁移必须幂等。
- ID 是节点属性的一部分，因此会随 Yjs 正常同步。

### 9.2 块接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/documents/:id/blocks` | 获取顶层块，可选择递归 |
| `GET` | `/api/v1/documents/:id/blocks/:blockId` | 获取指定块 |
| `POST` | `/api/v1/documents/:id/blocks` | 在指定位置插入一个或多个块 |
| `PATCH` | `/api/v1/documents/:id/blocks/:blockId` | 替换节点属性或内容 |
| `DELETE` | `/api/v1/documents/:id/blocks/:blockId` | 删除块 |
| `POST` | `/api/v1/documents/:id/batch` | 单个 Yjs 事务执行批量操作 |

插入位置使用稳定锚点：

```json
{
  "position": {
    "after_block_id": "block_01JXYZ"
  },
  "nodes": []
}
```

也支持 `before_block_id`、`parent_block_id + child_index`、`document_start`、`document_end`，但一次请求只能选择一种定位方式。

批量操作示例：

```json
{
  "base_version": "sha256:abc...",
  "operations": [
    {
      "op": "replace",
      "block_id": "block_01",
      "node": { "type": "paragraph", "attrs": { "id": "block_01" } }
    },
    {
      "op": "insert",
      "after_block_id": "block_02",
      "nodes": []
    },
    {
      "op": "delete",
      "block_id": "block_03"
    }
  ]
}
```

批量操作必须全部成功或全部失败，并只产生一个 Yjs transaction。

## 10. YDoc 服务

开放 API 不能直接操作 `ydoc_state` BLOB。新增统一 `YDocService`：

```text
loadLatest(documentId, user)
  1. 校验用户权限
  2. 优先返回 hocuspocus.documents 中的在线 Y.Doc
  3. 否则创建 Y.Doc 并应用 ydoc_state 快照
  4. 没有快照时才读取旧 ydoc_updates 并用 Y.mergeUpdates 懒迁移

transact(documentId, user, callback)
  1. loadLatest
  2. 在 Y.Doc transaction 内执行 callback
  3. 在线文档由 Yjs/Hocuspocus 广播 update
  4. 编码完整状态并 UPSERT ydoc_state
  5. 返回新 version
```

关键约束：

- 禁止对 Yjs update 做长度经验过滤。
- 禁止把单个增量应用到空白 Y.Doc 后再重编码。
- 合并历史增量只能使用 `Y.mergeUpdates`。
- API 修改在线文档时必须复用 Hocuspocus 当前内存实例，避免同一文档出现两个分叉 Y.Doc。
- API 写入完成后立即持久化，不等待 Hocuspocus 2 秒防抖。
- API 响应前必须确认 SQLite UPSERT 成功。

文档 `version` 使用当前完整状态 update 的 SHA-256，确保页面写入、API 写入和重启后计算一致。

## 11. 附件

### 11.1 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/v1/attachments` | `multipart/form-data` 上传附件 |
| `GET` | `/api/v1/attachments/:id` | 下载附件 |
| `GET` | `/api/v1/attachments/:id/metadata` | 获取元数据 |
| `DELETE` | `/api/v1/attachments/:id` | 删除未引用附件；强制删除需显式参数 |

上传时必须指定 `document_id`。服务端校验文档权限、扩展名、MIME、大小和实际文件特征，不能信任客户端文件名。

图片节点使用稳定附件引用：

```json
{
  "type": "image",
  "attrs": {
    "id": "block_01JXYZ",
    "attachmentId": "att_01JXYZ",
    "src": "/api/v1/attachments/att_01JXYZ",
    "alt": "架构图",
    "title": null,
    "width": 960,
    "height": null,
    "align": "center"
  }
}
```

服务端保存时以 `attachmentId` 为权威，`src` 是派生字段，避免调用方伪造本地文件路径。

## 12. 限频

限频分三层，全部生效时取最先达到的限制：

| 维度 | 默认值 | 目的 |
|---|---:|---|
| 未鉴权 IP | 30 次/分钟 | 防止 Token 猜测和无效请求攻击 |
| 每个 Token 总请求 | 120 次/分钟 | 控制常规调用量 |
| 每个 Token 写请求 | 30 次/分钟 | 保护 SQLite 和 Yjs 事务 |
| 每 Token + 每文档正文写入 | 10 次/分钟 | 防止高频覆盖和协同广播风暴 |

采用令牌桶算法，允许短时 burst，但不能超过桶容量。配置项：

```env
OPEN_API_RATE_LIMIT_PER_MINUTE=120
OPEN_API_WRITE_RATE_LIMIT_PER_MINUTE=30
OPEN_API_DOCUMENT_WRITE_RATE_LIMIT_PER_MINUTE=10
OPEN_API_UNAUTHENTICATED_RATE_LIMIT_PER_MINUTE=30
```

响应头：

```http
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1784044800
Retry-After: 12
```

限频键不能保存完整 Token，只使用 token ID。当前单进程实现内存存储；限频模块必须通过 Store 接口抽象，未来横向扩容时可替换 Redis。

## 13. 安全要求

- 开放 API 不读取 Session Cookie；页面 API 不读取 Bearer Token。
- 所有资源查询都必须带当前 Token 用户上下文，禁止只按资源 ID 查询。
- 无权限资源返回 404，降低 ID 枚举风险。
- Token 创建、撤销、鉴权失败和高风险删除写入结构化审计日志。
- 日志不记录 Authorization、Cookie、完整正文和附件内容。
- HTML 导入必须清洗脚本、事件属性、危险 URL 和未知标签。
- Markdown/JSON/HTML 正文限制默认 10 MiB，批量操作默认最多 100 项。
- 附件类型与大小使用白名单配置。
- CORS 继续只服务页面来源；服务端脚本不依赖 CORS。开放 API 不通过放宽 `*` Origin 获得可调用性。
- API Token 撤销后立即失效；过期 Token 不自动续期。

## 14. 数据迁移

### 14.1 数据库迁移

本次新增：

- `api_tokens`
- `idempotency_keys`
- 可选 `api_audit_logs`

迁移通过显式版本化 migration 执行，不能继续只依赖 `CREATE TABLE IF NOT EXISTS` 和零散 `ALTER TABLE`。引入 `schema_migrations` 后，现有建表逻辑也应纳入基线版本。

改动持久化代码前必须备份 `backend/doco.db`，并用备份副本验证升级和回滚。

### 14.2 文档块 ID 迁移

- 不离线批量重写全部 YDoc，避免一次性触碰所有正文。
- 页面或 API 第一次加载旧文档时检测缺失 ID。
- 在同一个 Yjs transaction 中为缺失块补齐 ULID。
- 立即持久化完整状态。
- 同一文档再次加载不产生任何 update。

### 14.3 页面路由迁移

- 将前端 `API_BASE` 改为 `/app-api/v1` 对应地址。
- 所有页面调用统一通过 `apiFetch`，禁止组件自行拼接开放 API 地址。
- 验证登录、知识库树、搜索、移动、删除、导入、导出和文档设置。

## 15. OpenAPI 与开发者体验

仓库新增：

```text
docs/openapi/doco-openapi-v1.yaml
docs/openapi/examples/
```

OpenAPI 规范必须覆盖：

- Bearer Token security scheme
- 所有请求/响应 Schema
- 统一错误格式
- 分页游标
- 限频响应头和 429
- ETag、If-Match、428、409
- multipart 附件上传
- Tiptap JSON 节点联合类型

后端提供 `GET /api/openapi.json`。规范文件是契约测试输入，路由变更未同步规范时测试失败。

最小调用示例：

```bash
curl https://example.com/api/v1/documents \
  -H "Authorization: Bearer $DOCO_API_TOKEN"
```

## 16. 测试策略

### 16.1 单元测试

- Token 生成、哈希、过期、撤销和 scope。
- 页面 Cookie 与开放 Bearer 严格隔离。
- 权限查询始终带用户边界。
- 限频令牌桶及响应头。
- Tiptap JSON Schema 验证。
- Markdown/HTML 转换和 warnings。
- 块 ID 生成、补齐、去重和移动保持。
- ETag/version 稳定计算。

### 16.2 API 集成测试

- 知识库、文件夹、文档全生命周期。
- 跨用户读取、写入、移动和删除全部失败。
- Token scope 不足返回 403。
- 幂等键重复请求返回相同资源。
- 版本冲突返回 409，缺少前置条件返回 428。
- 限频返回 429 和正确响应头。
- 附件上传、读取、引用和删除约束。

测试使用临时 SQLite 数据库，禁止读写真实 `backend/doco.db`。

### 16.3 协同集成测试

必须验证真实链路：

1. 建立 Hocuspocus 客户端并打开文档。
2. 通过开放 API 修改一个块。
3. 客户端收到 Yjs update 并显示新内容。
4. 客户端继续编辑。
5. API 读取获得合并后的最新内容。
6. 重启后端后再次读取，内容保持一致。

反向链路也要验证：页面在线编辑后，在 Hocuspocus 最长防抖窗口内调用 API，API 必须优先读取内存实时文档，而不是旧 SQLite 快照。

### 16.4 前端回归测试

Playwright 必须使用 headless 模式，覆盖：

- Google 登录状态恢复。
- 知识库、文件夹、文档 CRUD。
- 文档移动和搜索。
- Markdown/Word/PDF 导入。
- 页面编辑与刷新恢复。
- Token 创建、复制提示、列表和撤销。

## 17. 实施阶段

### Phase 1：后端基础重构

- 引入 migration 基线。
- 抽取权限、资源 Service 和 YDocService。
- 页面 API 迁移到 `/app-api/v1`，保持功能不变。
- 建立后端测试框架和临时数据库能力。

### Phase 2：Token 与开放元数据 API

- Token 表、创建/撤销页面接口与管理 UI。
- Bearer 鉴权、scopes、请求 ID、统一错误和限频。
- 知识库、文件夹、文档元数据开放 API。
- 分页、幂等和审计日志。

### Phase 3：完整正文与块 ID

- 统一 ProseMirror Schema。
- Tiptap JSON 读取、验证和整文写入。
- 稳定块 ID 扩展和懒迁移。
- 块级 CRUD、批量事务、ETag/If-Match。
- 在线 Y.Doc 实时更新和立即持久化。

### Phase 4：格式转换、附件和文档

- Markdown/HTML 导入导出及 warnings。
- 附件 API 和图片引用。
- OpenAPI 3.1 规范、示例和契约测试。
- 全链路协同测试、前端回归和生产迁移演练。

每个 Phase 都必须保持页面现有功能可运行，不能等到最后一次性修复页面 API。

## 18. 验收标准

以下条件全部满足才算完成：

1. `/app-api/v1/*` 只接受 Session Cookie，`/api/v1/*` 只接受 Bearer Token。
2. 两个用户之间不能通过任何开放 API 读取、修改、移动或删除对方资源。
3. 开放 API 覆盖知识库、文件夹、文档、正文、块和附件的完整生命周期。
4. Tiptap JSON 往返后所有受支持节点和属性保持不变。
5. API 修改在线文档时，页面无刷新收到更新。
6. 页面修改尚未防抖落库时，API 仍读取到内存最新版本。
7. API 写入在响应前已持久化，后端重启不丢失。
8. 版本冲突不会静默覆盖，返回明确的 409。
9. 四层默认限频均有自动化测试，超限返回 429 和标准响应头。
10. Token 明文不进入数据库、日志、测试快照或错误响应。
11. 旧文档块 ID 懒迁移幂等，不产生重复 update。
12. OpenAPI 规范与真实路由通过契约测试保持一致。
13. 所有测试使用临时数据库，持久化改动前已备份并验证真实数据库迁移副本。
14. 前端生产构建通过，页面关键流程 headless 回归通过。

## 19. 发布与回滚

发布顺序：

1. 备份生产 SQLite 数据库和附件目录。
2. 在数据库副本执行 migration 并运行一致性检查。
3. 部署兼容新旧页面路径的后端版本。
4. 部署使用 `/app-api/v1` 的前端。
5. 验证页面、开放 API、WebSocket 和跨用户权限。
6. 移除旧 `/api/*` 页面兼容路由。

回滚要求：

- migration 在应用层向后兼容，新增表不影响旧版本读取。
- 块 ID 是附加属性，旧前端应能忽略，不能破坏正文解析。
- 回滚后不得删除新 Token 或正文数据；仅停止开放路由。
- 发生 YDoc 异常时优先恢复数据库备份，并保留浏览器 IndexedDB 回传恢复能力。

## 20. 已确认的设计决策

- 页面 API 与开放 API 必须分开。
- 开放 API 必须支持全功能，而不只是现有元数据 CRUD。
- 开放 API 必须有限频。
- 无损正文标准格式使用 Tiptap/ProseMirror JSON。
- Markdown、HTML 作为便捷但可能有损的转换格式。
- API 正文修改必须经过 Yjs，并实时同步到页面。
- 块使用持久化 UUID/ULID，不使用位置型 ID。
- 不直接开放 Yjs 二进制协议。
