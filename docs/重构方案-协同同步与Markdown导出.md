# Doco 重构方案：协同同步 + Markdown 导出

> 2026-07 代码梳理结论。针对两个核心痛点：①导出 Markdown 困难；②编辑偶发丢失内容。
> 结论先行：**后端保留 Node.js，放弃 Python**；同步协议不再手写，改用成熟库；导出改为服务端从 YDoc 直接重建。

---

## 一、现状问题清单（按严重程度排序）

### P0-1 生产环境（worker.js / Cloudflare DO）协同同步根本不工作

[worker.js:71-90](../backend/worker.js#L71-L90) 存在三个致命问题：

1. **SyncStep2 发错了对象**。客户端连接后发 SyncStep1（"告诉我我缺什么"），服务器把包含缺失历史的 SyncStep2 回复广播给了 *除请求者以外* 的所有连接（`socket !== ws`），请求者本人永远收不到。结果：**新设备打开文档拿不到任何历史内容**——这就是"丢失信息"的主要来源。本机不炸是因为 IndexedDB 和 y-websocket 的 BroadcastChannel 掩盖了问题。
2. **没有 update 广播机制**。A 的编辑消息（sync/update 类型）应用到服务器 doc 后，`readSyncMessage` 的回复 encoder 只有 1 个字节（消息头），这个无效字节被广播给 B，B 端解析直接抛异常。**A 的实时编辑永远到不了 B**。正确做法是挂 `doc.on('update')` 监听并广播完整 update 消息。
3. **Durable Object 休眠后状态丢失**。用了 hibernation API（`state.acceptWebSocket`），但 `loadHistory()` 只在 `fetch()` 里调用。DO 休眠再唤醒时构造函数重建了一个 **空的** `this.doc`，之后所有消息都应用在空文档上，同步彻底错乱。
4. **存储爆炸**。`saveUpdate()` 在每条消息后把 *全量快照* INSERT 进 `ydoc_updates`，D1 表按每次击键批次增长一行全文快照，无上限。

### P0-2 本地后端（ws-handler.js）初始同步同样送不到

[ws-handler.js:38-53](../backend/ws-handler.js#L38-L53)：发送初始 SyncStep1 用的 `encoder` 在 `ws.on('message')` 回调里被**复用且从不重置**。每次回复都携带之前的全部字节；y-websocket 客户端每个 WebSocket 帧只解析第一条消息，所以：

- 客户端反复收到的都是最开头那条 SyncStep1，**真正的 SyncStep2（历史内容）永远在缓冲区尾部，永远读不到**；
- 客户端每次都会用全量 SyncStep2 回应重复的 SyncStep1，带宽浪费且消息越滚越大。

次要问题：
- 每个连接注册一个 `updateHandler`，其中都调 `persistence.scheduleWrite(update)` → N 个客户端同一条 update 重复入库 N 次；
- 完全没有处理 awareness 消息（messageType 1），客户端发来直接丢弃；
- `docs` Map 永不清理，房间常驻内存。

### P0-3 Markdown 导出链路是空壳

- 后端 [api.js:172-175](../backend/api.js#L172-L175)：`POST /api/export/markdown` **收到内容后什么都不做，直接返回 success**。前端"停止编辑 5 秒自动导出"（DocoEditor.tsx 中的 `onExport`）推送的 Markdown 全部进了黑洞。
- 原 Python `export_service.py`（服务端从 YDoc 重建 Markdown）随后端迁移被删除，Node 侧**没有任何替代实现**。
- 前端手动导出也不完整：`MermaidBlock` / `PlantUMLBlock` / `CalloutBlock` / `ResizableImage` 四个自定义节点**都没有定义 markdown 序列化规则**（grep 确认无任何 markdown storage），tiptap-markdown 遇到未知节点会降级输出 HTML 或丢弃——图表和高亮块导出即损坏。

### P1 其他问题

| 位置 | 问题 |
|---|---|
| persistence.js:30-33 | 2 秒 debounce 无退出钩子，进程被杀丢最后一批更新；连续编辑时 flush 被无限顺延（无 maxWait） |
| persistence.js:38-45 | flush 把增量应用到空白 Y.Doc 再 `encodeStateAsUpdate`。实测（Yjs 13.6.30 会把 pending 结构编进快照）目前不丢数据，但这是**依赖未文档化行为的侥幸**，正确姿势是 `Y.mergeUpdates(updates)` |
| persistence.js:45 / worker.js:96 | `snapshot.length > 2` 过滤——当年 Python 版丢数据的同款写法，应彻底删除 |
| database.js | sql.js 全库驻内存 + 每 5 秒 `writeFileSync` 全量重写文件；崩溃丢 5 秒窗口 |
| DocoEditor.tsx:91 | `ydoc.transact(() => {})` 空事务不产生任何 update，"推送完整状态"是无效代码（正确的服务器靠 SyncStep1/2 双向补齐，不需要这个 hack） |
| ydoc_updates 表 | 无 compaction，无限增长（CLAUDE.md 已知问题，至今未做） |
| CLAUDE.md | 仍在描述已删除的 Python 后端，需要重写 |

---

## 二、Python vs Node.js：结论是 Node，且不可动摇

| 维度 | Python | Node.js |
|---|---|---|
| Yjs 生态 | y-py / ypy-websocket **已归档停止维护**（当年"observe_after_transaction 只有 2 字节"的坑就是绑定层缺陷）；现役替代 pycrdt-websocket 仍是二等公民 | Yjs 官方原生 JS，前后端跑**同一份库、同一版本**，协议永不错位 |
| Markdown 导出 | 必须手写 ProseMirror JSON → MD 转换器（export_service.py 之路），每加一个前端扩展就要同步改一次，永远追不上 | 直接复用前端的 Tiptap 扩展定义 + tiptap-markdown，**导出结果和编辑器内所见严格一致** |
| 部署目标 | Cloudflare Workers 不能跑 Python | Worker / DO 原生 JS |
| 团队成本 | 两种语言两套依赖 | 一种语言，`src/editor` 的扩展代码前后端共享 |

Python 的合理位置：将来如果要做 AI 分析/重型数据处理，作为**旁挂服务**读取导出好的 Markdown 即可，不碰 CRDT。

---

## 三、目标架构

### 3.1 先做一个取舍：一套后端，不要两套

现在同时维护 server.js（本地 sql.js）和 worker.js（CF D1/DO）两套运行时，等于每个 bug 修两遍。二选一：

- **方案 A（推荐）：自托管 Node 单后端**。用 [Hocuspocus](https://tiptap.dev/docs/hocuspocus)（Tiptap 官方协同服务器）+ better-sqlite3。Cloudflare Pages 只托管前端静态文件。同步协议、awareness、防抖持久化（`onStoreDocument`）全部开箱即用，自己写的代码只剩"读写 SQLite"几十行。将来协同光标（Tiptap v3 的 `@tiptap/extension-collaboration-caret`）也直接可用。
- **方案 B：坚持全 Cloudflare**。Durable Object 不手写，改用 `y-durableobjects` 库（正确处理 hibernation 与广播）；文档状态存 **DO Storage**（每文档一个快照 + 增量，天然按房间隔离），D1 只存知识库/文件夹/文档元数据。

以下按方案 A 展开（方案 B 的存储与导出设计同样适用）。

### 3.2 同步层（替换 ws-handler.js + persistence.js，约 -110 行 +40 行）

```js
// backend/server.js（核心骨架）
import { Server } from '@hocuspocus/server'
import { Database } from '@hocuspocus/extension-database'
import Database_ from 'better-sqlite3'

const db = new Database_('doco.db')          // WAL 模式，写即落盘，砍掉 5 秒定时器

const server = Server.configure({
  port: 8000,
  extensions: [
    new Database({
      // 加载：单快照 + 尾部增量
      fetch: async ({ documentName }) => loadState(db, documentName),
      // 存储：Hocuspocus 自带防抖（debounce 2s / maxDebounce 10s），且进程退出前会 flush
      store: async ({ documentName, state }) => saveState(db, documentName, state),
    }),
  ],
})
```

前端把 `WebsocketProvider` 换成 `@hocuspocus/provider`（API 几乎同形），IndexedDB 优先加载、`disconnect()` 而非 `destroy()` 的既有规则不变；删除 `ydoc.transact(() => {})` 无效 hack。

### 3.3 存储模型（解决无限增长 + 过滤丢数据）

```sql
CREATE TABLE ydoc_state (
  doc_id     TEXT PRIMARY KEY,
  state      BLOB NOT NULL,        -- Y.mergeUpdates 后的单一快照
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

规则只有三条：
1. `store` 时直接写入 Hocuspocus 给的完整 state（它内部就是合并好的），**一文档一行，UPSERT**，表不再增长；
2. 任何地方**禁止** `length > 2` 之类的经验过滤；
3. 如需保留历史版本，另建 `ydoc_history` 表按保存点追加，独立做保留策略（如保留最近 50 个），与主状态解耦。

一次性迁移脚本：把现有 `ydoc_updates` 按 doc 分组 `Y.mergeUpdates()` 后写入新表。

### 3.4 Markdown 导出（核心诉求，服务端权威）

**原则：Markdown 是 YDoc 的派生物，按需生成，不靠前端定时推送。**

1. **共享扩展定义**：把 DocoEditor 里的扩展数组抽成 `src/editor/extensions.ts` 导出 `createExtensions(options)`，编辑器与导出共用同一份 schema——这是"导出所见即所得"的根基。
2. **补齐自定义节点的序列化规则**（同时修复前端手动导出）：

```ts
// MermaidBlock 加上（PlantUML/Callout/ResizableImage 同理）
addStorage() {
  return {
    markdown: {
      serialize(state, node) {
        state.write('```mermaid\n' + node.attrs.code + '\n```')
        state.closeBlock(node)
      },
    },
  }
}
// Callout → "> " 引用块或 :::callout 容器语法；ResizableImage → ![](src) 忽略宽度属性
```

3. **服务端导出模块** `backend/export.js`：

```js
import { yDocToProsemirrorJSON } from 'y-prosemirror'
import { getSchema } from '@tiptap/core'
// YDoc → ProseMirror JSON → Markdown，全程无浏览器依赖
const json = yDocToProsemirrorJSON(ydoc, 'default')
const markdown = serializeToMarkdown(json)   // 复用共享扩展的 serialize 规则
```

4. **API**：
   - `GET /api/docs/:id/export.md` —— 即取即转，永远与最新 CRDT 状态一致；
   - `GET /api/kb/:id/export.zip` —— 按 `知识库/文件夹/标题.md` 打包（替代原 batch_export.py）；
   - **删除** 空壳的 `POST /api/export/markdown` 和前端 `onExport` 5 秒推送逻辑。
5. AI 读取文档：直接 `curl /api/docs/:id/export.md`，不再依赖 exports/ 目录的陈旧落盘文件。

### 3.5 实施顺序（每步可独立验证）

| 步骤 | 内容 | 验证方式 |
|---|---|---|
| 1 | 补自定义节点 markdown serialize 规则 | 前端手动导出含 mermaid/callout 的文档，检查 .md |
| 2 | 后端换 Hocuspocus + better-sqlite3，前端换 provider | 两个浏览器 profile 同开一文档：A 打字 B 实时可见；清掉 B 的 IndexedDB 重开仍能拿到全文 |
| 3 | 数据迁移（ydoc_updates → ydoc_state） | 迁移后逐文档比对导出 Markdown |
| 4 | 服务端导出 API + 批量导出 | 与前端手动导出结果 diff |
| 5 | 删除 worker.js/db-adapter.js 双实现（或按方案 B 重写）、重写 CLAUDE.md | — |

> ⚠️ 迁移前务必备份 `backend/doco.db`。由于历史 bug，后端库可能本就不完整，**以各浏览器 IndexedDB 为准**：迁移后在前端逐个打开重要文档，确认内容完整后由新服务器落库。

---

## 四、验证脚本记录

本次结论中"flush 侥幸不丢数据"由脚本实证（Yjs 13.6.30）：向空白 Doc 应用带缺失依赖的增量后 `encodeStateAsUpdate` 会包含 pending 结构，插入/删除场景重放均正确。但该行为未见于官方文档承诺，重构后一律改用 `Y.mergeUpdates`。
