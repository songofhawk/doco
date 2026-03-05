# 方案 A：Google Drive appdata — 用户自带存储 MVP

## 概述

用户通过 OAuth 授权后，将 Yjs 文档快照和知识库元数据存储到用户自己的 Google Drive 隐藏文件夹（appdata）中，配合 y-indexeddb 做本地缓存，实现完全无服务器的个人笔记 + 跨设备同步。

## 架构

```
浏览器
├── y-indexeddb（本地缓存，离线可用）
├── 自定义 GoogleDriveProvider
│   ├── 定期上传 Y.encodeStateAsUpdate(ydoc) 快照
│   ├── 元数据序列化为 meta.json
│   └── 启动时从 Drive 加载最新快照
└── Google Identity Services（OAuth 2.0）
```

## 与现有后端的对比

| 维度 | 现在（SQLite 后端） | Google Drive 方案 |
|------|---------------------|-------------------|
| 数据存储位置 | 你的服务器 SQLite | 用户浏览器 IndexedDB + 用户 Google Drive |
| 写入方式 | 每个 Yjs 增量实时写入 `ydoc_updates` | 本地实时写 IndexedDB，定期（30s 或关闭时）上传合并快照到 Drive |
| 读取方式 | 从 DB 逐条 replay 增量 | 先读 IndexedDB 本地缓存，没有则从 Drive 下载快照一次性加载 |
| 元数据 | `documents`/`folders`/`knowledge_bases` 三张表 | 序列化为一个 `meta.json` 存在 Drive appdata |
| 协同编辑 | WebSocket 实时同步 | 无实时协同（降级为打开时 CRDT merge） |
| 离线支持 | 无（断网不能用） | 天然支持（IndexedDB 本地优先） |

## Google Drive appdata 关键参数

| 项目 | 详情 |
|------|------|
| 存储配额 | 占用用户 15GB 共享配额（Gmail + Drive + Photos 共享），Yjs 快照通常几十 KB~几 MB，影响极小 |
| OAuth scope | `drive.appdata` 是**非敏感 scope**，无需 Google 审核即可使用 |
| API 频率限制 | 1000 请求/100秒/用户（默认），可申请提升 |
| 单文件大小 | 最大 5TB，日均上传软限制 750GB |
| 前端直连 | 可行，Google Drive API v3 支持 CORS，纯前端通过 Bearer token 调用 |
| 现有生态 | **没有现成的 Yjs + Google Drive provider**，需自行实现 |

## OAuth 认证流程

### 推荐：授权码流（Authorization Code Flow）

```
用户点击"连接 Google Drive"
  → 浏览器跳转 Google 授权页
  → 用户同意 drive.appdata 权限
  → Google 回调返回 authorization code
  → 轻量后端用 code 换取 access_token + refresh_token
  → 前端拿到 access_token 直接调用 Drive API
  → access_token 过期（1小时）后，后端用 refresh_token 刷新
```

- 需要一个轻量后端做 token 交换（可以是 Cloudflare Worker、Vercel Function 等）
- `refresh_token` 存在后端，前端只持有短期 `access_token`
- 安全性好，用户无需反复登录

### 备选：纯前端隐式流

- 无需后端，但 access_token 1 小时过期后必须重新授权
- 可用 iframe 静默刷新（Google 推荐），但实现复杂
- 适合快速原型验证，不适合生产环境

## 存储策略

### Yjs 文档数据

不再存每个增量，改为**合并快照**：

- 每个文档对应 Drive appdata 中的一个文件，如 `doc-{uuid}.yjs`
- 内容为 `Y.encodeStateAsUpdate(ydoc)` 的二进制数据
- 上传时机：
  - 定时（每 30 秒检查是否有变更）
  - 文档关闭 / 页面 `beforeunload` 时
  - 手动触发（用户点击"保存到云端"）

```typescript
// 上传快照到 Google Drive appdata
async function uploadSnapshot(ydoc: Y.Doc, docId: string, token: string) {
  const snapshot = Y.encodeStateAsUpdate(ydoc)
  const metadata = { name: `doc-${docId}.yjs`, parents: ['appDataFolder'] }

  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', new Blob([snapshot], { type: 'application/octet-stream' }))

  await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
}
```

### 元数据（知识库/文件夹/文档树）

序列化为一个 `meta.json` 存在 Drive appdata：

```json
{
  "knowledgeBases": [
    { "id": 1, "name": "工作笔记" }
  ],
  "folders": [
    { "id": 1, "name": "项目文档", "kbId": 1, "parentId": null }
  ],
  "documents": [
    { "id": "uuid-xxx", "title": "会议记录", "folderId": 1, "kbId": null }
  ]
}
```

也可以用 Yjs 的 `Y.Map` 管理元数据，这样多设备修改时天然支持 CRDT merge。

## 多设备冲突处理

Yjs CRDT 天然解决内容冲突，无需额外逻辑：

```typescript
// 设备 A 和设备 B 各自离线编辑了同一文档
// 设备 A 上传了 snapshot-A，设备 B 上传了 snapshot-B
// 设备 C 打开文档时，下载两个快照并 merge：

const snapshotA = await downloadFromDrive('doc-xxx-A.yjs', token)
const snapshotB = await downloadFromDrive('doc-xxx-B.yjs', token)

const ydoc = new Y.Doc()
Y.applyUpdate(ydoc, snapshotA)  // 先应用 A
Y.applyUpdate(ydoc, snapshotB)  // 再应用 B，顺序无关，结果一致

// 合并后上传新快照，替换旧的
await uploadSnapshot(ydoc, 'doc-xxx', token)
```

实际实现中，建议每个文档只保留一个快照文件（覆盖更新），避免文件数量膨胀。

## 风险与限制

| 风险 | 影响 | 缓解方案 |
|------|------|---------|
| 15GB 配额共享 | 用户 Drive 空间不足时无法上传 | 提示用户清理空间，Yjs 快照本身很小 |
| Token 过期 | 隐式流 1 小时过期，用户被迫重新登录 | 用授权码流 + refresh_token |
| API 速率限制 | 频繁编辑时可能触发限流 | 批量上传 + 指数退避重试 |
| 网络不稳定 | 上传失败 | y-indexeddb 本地缓存兜底，下次重试 |
| 国内不可用 | Google 服务被墙 | 此方案仅面向国外用户 |
| 实时协同丢失 | 多人无法同时编辑 | 降级为"打开时 merge"，或后续叠加 WebSocket 中继 |

## 需要实现的核心模块

1. **GoogleDriveProvider** — 自定义 Yjs provider，封装 Drive API 的读写
2. **OAuth 管理** — Google Identity Services 集成 + token 刷新
3. **同步调度器** — 控制上传频率（防抖 + 定时 + beforeunload）
4. **元数据管理** — meta.json 的读写和本地缓存

## 适合场景

- 个人笔记、跨设备同步
- 国外用户优先的 MVP
- 对数据主权有要求（数据在用户自己的 Google Drive）
- 可作为后续叠加协同能力的基础层
