---
name: doco-documents
description: 通过 Doco Open API 安全读取和写入知识库文档、正文块与附件。用于用户提到 Doco、Doco 文档 ID、知识库内容读取、文档更新、按位置插入内容、上传或插入图片、批量编辑、API 验证时；优先保留 Tiptap/Yjs 原生结构并执行 ETag 并发保护。
---

# Doco 文档操作

使用 `scripts/doco_api.py` 调用 Doco Open API。脚本自动从 Skill 根目录的 `config.env` 加载地址和 Token；不要读取、打印、复制或提交该配置文件。

## 操作原则

1. 写入前先读取目标文档类型；spreadsheet 按专用章节操作，普通文档读取 `tiptap-json` 正文，确认标题、结构、稳定块 ID 与当前 `ETag`。
2. 小范围修改优先使用块接口，避免用 Markdown 替换整篇正文。仅当用户明确要求整体替换时使用 `put-content`。
3. 图片先用 `upload-attachment` 上传，再以 `attachmentId` 插入 `image` 节点；不要引用本地路径。
4. 所有正文或块写入都携带 `If-Match`。遇到 `409` 时重新读取、重新定位并合并，禁止盲目重试覆盖。
5. 未经用户明确要求，不删除文档、块、附件或知识库。
6. 不在命令、日志、回答或临时文件中暴露 Token。不要打开 `config.env`；让脚本自行加载。

## 独立电子表格（spreadsheet）

**硬规则：`document_type=spreadsheet` 的文档禁止走通用 TipTap 写入（put-content / patch-block / insert-blocks / delete，包括整篇替换、块删除和 batch 块写入），也禁止退化为浏览器 click/setValue 操作。** 普通文档里的 TipTap table 仍走块 API；先读取文档类型，独立电子表格一律走以下专用端点。

- `GET /api/v1/documents/{id}/spreadsheet`：结构、激活页、尺寸和格式；顶层 `data.version` 是文档并发版本，`data.spreadsheet.version` 是存储格式版本。旧单页稳定 ID 为 `sheet_1`。
- `GET /api/v1/documents/{id}/spreadsheet/sheets/{sheetId}/cells?range=C15:C18`：区域内原始字符串；空单元格为 `""`，公式保留 `=`，服务端不计算公式。range 仅支持大写 A1 或正向矩形，不能越界。
- `PATCH` 同一 cells 路径：body `{"cells":{"C15":"10","C16":"20","C17":"=SUM(C15:C16)","C18":""}}`，带 `If-Match: "<version>"`。值只能是字符串；空字符串清空值且保留样式。返回 cells、新 version、updated_count。

全部端点需 Bearer Token；读需要 documents:read，写需要 documents:write。以 doco-saas `backend/open-api/spreadsheet.openapi.yaml`（合并到 `/api/openapi.json`）为准。

标准写入流程：
1. GET spreadsheet 取得顶层 version 与 sheet ID，再 GET 目标 cells，确认原值及修改意图。
2. PATCH 带读取到的 If-Match，仅发送需要变更的 cells；一次原子提交。
3. 仅遇到 `409 document_version_conflict` 时，读取 `error.details.current_version` 提示，重新 GET 结构和目标 cells、重新核对并合并意图，再用新版本 PATCH。最多重试 3 次，仍冲突则停止并报告；不能只替换版本号盲写。
4. 写后 GET 相同区域核对原值与新 version。非法 range 为 400，sheet 不存在为 404；类型不符 `409 document_type_mismatch` 或其他 409 不按版本冲突重试。

工具与 Python 函数只发送一次 PATCH，并透传 409；重试上限由调用方执行。禁止省略 If-Match、使用 `*` 或强制覆盖。

## 常用命令

设置脚本路径：

```bash
DOCO_SKILL="${CODEX_HOME:-$HOME/.codex}/skills/doco-documents"
```

电子表格（`cells.json` 是地址到字符串映射，没有外层 cells 包装）：

```bash
python "$DOCO_SKILL/scripts/doco_api.py" get-spreadsheet doc_xxx
python "$DOCO_SKILL/scripts/doco_api.py" get-cells doc_xxx sheet_1 --range C15:C18
python "$DOCO_SKILL/scripts/doco_api.py" update-cells doc_xxx sheet_1 --file /tmp/cells.json --etag '"sha256:..."'
```

Python 可直接调用 `DocoClient.get_spreadsheet / get_cells / update_cells`；失败抛出 `DocoApiError`，保留 `status`、`code`、`details` 与完整 `body`。CLI 非零退出并在 stderr 输出原始 HTTP 错误 JSON。

验证身份与权限：

```bash
python "$DOCO_SKILL/scripts/doco_api.py" me
```

读取文档、正文和块：

```bash
python "$DOCO_SKILL/scripts/doco_api.py" get-document doc_xxx
python "$DOCO_SKILL/scripts/doco_api.py" get-content doc_xxx --format tiptap-json
python "$DOCO_SKILL/scripts/doco_api.py" list-blocks doc_xxx --recursive
```

上传附件：

```bash
python "$DOCO_SKILL/scripts/doco_api.py" upload-attachment doc_xxx /absolute/path/image.jpg
```

在指定块后插入已上传的图片：

```bash
python "$DOCO_SKILL/scripts/doco_api.py" insert-image doc_xxx att_xxx \
  --after-block-id block_xxx --alt "图片说明" --align center
```

插入任意块时，将 `{\"position\": ..., \"nodes\": [...]}` 写入 JSON 文件：

```bash
python "$DOCO_SKILL/scripts/doco_api.py" insert-blocks doc_xxx --file /tmp/blocks.json
```

整体替换正文必须使用先前读取到的 `ETag`：

```bash
python "$DOCO_SKILL/scripts/doco_api.py" put-content doc_xxx \
  --file /tmp/content.json --etag '"sha256:..."'
```

需要字段细节、图片节点结构或冲突处理时，读取 [references/api.md](references/api.md)。运行时接口与参考不一致时，以 `schema` 命令取得的生产 OpenAPI 为准。
