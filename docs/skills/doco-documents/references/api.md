# Doco Open API 摘要

## 路由与权限

- API 根路径：`/api/v1`
- 机器规范：`/api/openapi.json`
- 鉴权：`Authorization: Bearer <token>`
- 文档读取：`documents:read`
- 文档写入：`documents:write`
- 附件读取：`attachments:read`
- 附件写入：`attachments:write`

## 正文与并发

- `GET /documents/{id}/content?format=tiptap-json` 返回无损 Tiptap/ProseMirror JSON 和 `ETag`。
- `GET /documents/{id}/blocks?recursive=true` 返回稳定块 ID。
- `POST /documents/{id}/blocks` 插入块，并通过 `If-Match` 提交当前版本。
- `PUT /documents/{id}/content` 替换整篇正文，必须通过 `If-Match` 提交当前版本。
- 缺少版本通常返回 `428`；版本冲突返回 `409`。冲突后重新读取并合并。

位置对象必须且只能包含一种定位方式：

```json
{ "document_start": true }
{ "document_end": true }
{ "before_block_id": "block_..." }
{ "after_block_id": "block_..." }
{ "parent_block_id": "block_...", "child_index": 0 }
```

## 图片流程

先通过 `POST /attachments` 以 multipart 上传 `document_id` 和 `file`，取得附件 ID。然后插入图片节点：

```json
{
  "position": { "after_block_id": "block_..." },
  "nodes": [
    {
      "type": "image",
      "attrs": {
        "attachmentId": "att_...",
        "alt": "图片说明",
        "title": null,
        "width": null,
        "height": null,
        "align": "center"
      }
    }
  ]
}
```

服务端会补充稳定块 ID，并把图片 `src` 规范化为 `/api/v1/attachments/{id}`。不要把本地路径或 Token 写入节点。

## 安全检查

- 写入前确认文档 ID、目标块文本和位置。
- 多图片写入时逐次使用响应的新 `ETag`，或使用运行时规范支持的原子批量接口。
- 上传请求使用稳定的 `Idempotency-Key`；相同键不可配不同文件。
- 记录 `request_id` 和结果中的附件 ID，但不记录 Authorization 头。
