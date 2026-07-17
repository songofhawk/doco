# Doco Backend（Node.js + Hocuspocus）

基于 [Hocuspocus](https://tiptap.dev/docs/hocuspocus)（Tiptap 官方协同服务器）+ better-sqlite3 的协同后端。
同步协议（SyncStep1/2、awareness、防抖持久化、退出前 flush）全部由 Hocuspocus 处理，本目录只有薄薄一层业务代码。

## 启动

```bash
cd backend
npm install
npm start        # 或 npm run dev（文件变更自动重启）
```

## 认证配置

页面支持邮箱验证码和 Google ID token 登录，成功后都写入 httpOnly Session Cookie；开放 API 使用独立、可撤销的 Bearer Token。
两种凭证不可互换。前端 `VITE_GOOGLE_CLIENT_ID` 与后端
`GOOGLE_CLIENT_ID` 必须使用同一个 Google OAuth Web Client ID。
后端启动时会读取仓库根目录 `.env` 和 `backend/.env`；已有 shell 环境变量优先。

Google 返回的邮箱经过验证后，如果已存在相同的已验证邮箱账户，会把 Google 身份关联到原用户，
继续使用原用户的工作区和知识库。若 Google 身份和邮箱分别属于两个用户，则拒绝静默合并。

```bash
GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
SESSION_TTL_DAYS=30
COOKIE_SAMESITE=lax
COOKIE_SECURE=false

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM="Doco <no-reply@example.com>"
```

邮箱验证码默认 10 分钟有效、60 秒后可重发，并限制每邮箱和每 IP 的小时发送次数。
可通过 `EMAIL_CODE_TTL_MINUTES`、`EMAIL_CODE_RESEND_SECONDS`、
`EMAIL_CODE_MAX_PER_HOUR`、`EMAIL_CODE_IP_MAX_PER_HOUR` 和
`EMAIL_CODE_MAX_ATTEMPTS` 调整。验证码仅保存 scrypt 哈希，验证成功后立即失效。

生产环境如果前端和后端是不同站点且使用 HTTPS，通常需要：

```bash
COOKIE_SAMESITE=none
COOKIE_SECURE=true
```

服务监听 `http://0.0.0.0:8000`：

- WebSocket 协同：`ws://localhost:8000/ws`（文档名由 @hocuspocus/provider 在协议消息里传递，不走 URL 路径）
- 页面 API：`http://localhost:8000/app-api/v1/...`（Session Cookie）
- 开放 API：`http://localhost:8000/api/v1/...`（Bearer Token）
- OpenAPI 3.1：`http://localhost:8000/api/openapi.json`

## 文件说明

| 文件 | 职责 |
|---|---|
| server.js | 入口：Express + Hocuspocus 集成、导出路由、优雅退出 |
| database.js / migrations.js | better-sqlite3 初始化、WAL 与版本化迁移 |
| auth.js / email.js | 邮箱验证码、Google 身份关联、session cookie、用户与默认工作区初始化 |
| permissions.js | 当前用户到工作区/知识库/文件夹/文档的权限查询 |
| api.js | 页面认证、Token 管理、知识库/文件夹/文档路由 |
| open-api/ | Bearer 鉴权、限频、统一错误、幂等、开放路由 |
| resource-service.js | 页面与开放能力使用的资源业务规则 |
| quota.js | 工作区资源配额、文件夹深度和文档容量约束 |
| ydoc-service.js | 在线/离线 Y.Doc 统一加载、事务和立即持久化 |
| document-schema.js / markdown.js | 共享 Schema、格式转换与 Markdown 序列化 |
| migrate.js | 一次性迁移旧版 ydoc_updates 增量表 → ydoc_state 快照表 |
| schema.sql | 表结构参考（实际建表由 database.js 完成） |

## Markdown 导出（供 AI / 脚本读取文档）

```bash
# 单文档，永远返回最新协同状态（内存实时文档优先于落库快照；需登录 cookie）
curl -b cookies.txt http://localhost:8000/app-api/v1/docs/{doc_id}/export.md

# 整个知识库打包（目录结构 = 文件夹结构；需登录 cookie）
curl -b cookies.txt -O http://localhost:8000/app-api/v1/kb/{kb_id}/export.zip
```

## 持久化模型

- `users` / `auth_identities`：用户主账户与 Google 等外部身份；邮箱是规范化且唯一的已验证登录标识
- `email_login_codes`：邮箱验证码 scrypt 哈希、有效期、尝试次数与发送限流依据
- `sessions` / `workspaces` / `workspace_members`：登录态与多用户工作区边界
- `knowledge_bases.workspace_id`：知识库归属的权限根；文件夹、文档通过所属知识库继承权限
- `knowledge_bases` / `folders` / `documents`：记录创建者和创建/更新时间；创建者用于展示审计，配额仍按工作区归属计算
- `ydoc_state`：每文档一行合并快照，UPSERT 更新，表大小恒定
- `api_tokens`：只保存 Token secret 的 SHA-256；`idempotency_keys` 默认保留 24 小时
- 写入时机：Hocuspocus 内置防抖（编辑停顿 2s / 最长 10s），最后一个连接断开时、进程收到 SIGINT/SIGTERM 时强制落库
- 旧版 `ydoc_updates` 增量表：`node migrate.js` 批量合并，或由 server.js 在文档首次加载时懒迁移；确认无误后可手动 DROP

## 工作区配额

默认每个工作区最多拥有 100 个知识库，文档与文件夹合计最多 10,000 个，文件夹最多嵌套 20 层。
普通文档和独立电子表格都受 100,000 个非空白可见字符及 5 MiB Yjs 快照限制；已经超限的历史内容仍可读取、导出、删除和缩减。
可通过 `DOCO_MAX_KNOWLEDGE_BASES`、`DOCO_MAX_DOCUMENTS_AND_FOLDERS`、`DOCO_MAX_FOLDER_DEPTH`、
`DOCO_MAX_DOCUMENT_CHARACTERS` 和 `DOCO_MAX_YDOC_SNAPSHOT_BYTES` 调整默认值。
构建前端时如调整文档容量，还应同步设置 `VITE_MAX_DOCUMENT_CHARACTERS` 和
`VITE_MAX_YDOC_SNAPSHOT_BYTES`；前端只做即时预检，后端始终是最终强制边界。

## 数据恢复提示

前端浏览器 IndexedDB 是主存储。若后端快照缺失或不完整（历史 bug 遗留），
在前端打开该文档，Yjs 同步协议会自动把本地完整状态推给服务器并落库。
