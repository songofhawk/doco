# Doco Open API v1 调用示例

先在页面右上角“API Token”中创建读写 Token，并仅在创建成功时保存一次完整值：

```bash
export DOCO_BASE_URL=http://localhost:8000
export DOCO_API_TOKEN='doco_tok_..._...'
```

列出文档：

```bash
curl "$DOCO_BASE_URL/api/v1/documents?limit=20" \
  -H "Authorization: Bearer $DOCO_API_TOKEN"
```

读取无损正文并保存响应头中的 ETag：

```bash
curl -i "$DOCO_BASE_URL/api/v1/documents/doc_123/content?format=tiptap-json" \
  -H "Authorization: Bearer $DOCO_API_TOKEN"
```

带乐观锁整文更新：

```bash
curl -X PUT "$DOCO_BASE_URL/api/v1/documents/doc_123/content" \
  -H "Authorization: Bearer $DOCO_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "sha256:从读取响应取得"' \
  --data @content.json
```

上传并引用图片：

```bash
curl -X POST "$DOCO_BASE_URL/api/v1/attachments" \
  -H "Authorization: Bearer $DOCO_API_TOKEN" \
  -H 'Idempotency-Key: upload-diagram-001' \
  -F document_id=doc_123 \
  -F file=@diagram.png
```

完整契约见 `../doco-openapi-v1.yaml`，运行时 JSON 版本位于 `GET /api/openapi.json`。
