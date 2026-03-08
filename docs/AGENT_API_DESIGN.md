# Doco 编辑器 Agent 友好 API 设计方案

## 问题分析

当前系统存在的问题：
1. **只能全文替换**：PUT API 会删除所有历史并完全替换文档
2. **无法精确编辑**：Agent 无法只修改某个段落或章节
3. **破坏版本控制**：全文替换会丢失 Yjs CRDT 的历史记录

## 设计目标

实现一个**同时对人类和 AI Agent 友好**的文档编辑系统：
- 人类：通过前端可视化编辑器实时协作
- Agent：通过 REST API 精确操作文档块

## 核心方案：块级操作 API

### 1. 文档结构标识

为每个文档块分配唯一 ID（基于 Yjs 的位置映射）：

```python
# 块 ID 格式：{doc_id}:{block_type}:{position}
# 示例：doc_abc123:heading:0, doc_abc123:paragraph:5
```

### 2. API 设计

#### 2.1 读取 API

**获取完整文档（Markdown）**
```http
GET /api/docs/{doc_id}/markdown
Response: {
  "doc_id": "...",
  "title": "...",
  "markdown": "...",
  "blocks": [
    {"id": "block_1", "type": "heading", "level": 2, "content": "标题"},
    {"id": "block_2", "type": "paragraph", "content": "段落内容"}
  ]
}
```

**获取文档大纲（仅标题）**
```http
GET /api/docs/{doc_id}/outline
Response: {
  "sections": [
    {"id": "block_1", "level": 1, "title": "第一章", "children": [...]},
    {"id": "block_5", "level": 1, "title": "第二章", "children": [...]}
  ]
}
```

**获取指定章节内容**
```http
GET /api/docs/{doc_id}/sections/{section_id}
Response: {
  "section_id": "block_1",
  "title": "第一章",
  "markdown": "...",
  "blocks": [...]
}
```

#### 2.2 写入 API（增量更新）

**在指定位置插入内容**
```http
POST /api/docs/{doc_id}/blocks
{
  "after": "block_5",  // 在哪个块之后插入（null 表示开头）
  "content": "## 新章节\n\n这是新内容"
}
```

**更新指定块**
```http
PATCH /api/docs/{doc_id}/blocks/{block_id}
{
  "content": "更新后的内容"
}
```

**删除指定块**
```http
DELETE /api/docs/{doc_id}/blocks/{block_id}
```

**批量操作（事务）**
```http
POST /api/docs/{doc_id}/batch
{
  "operations": [
    {"op": "update", "block_id": "block_2", "content": "新内容"},
    {"op": "delete", "block_id": "block_3"},
    {"op": "insert", "after": "block_5", "content": "插入内容"}
  ]
}
```

### 3. 实现方案

#### 3.1 块 ID 生成策略

```python
def generate_block_ids(ydoc: Y.YDoc) -> dict:
    """为文档中的每个块生成唯一 ID"""
    xml_fragment = ydoc.get_xml_element("default")
    blocks = []

    child = xml_fragment.first_child
    index = 0

    while child:
        if hasattr(child, 'name'):
            block_id = f"{child.name}_{index}"
            blocks.append({
                "id": block_id,
                "type": child.name,
                "position": index
            })
            index += 1
        child = child.next_sibling

    return blocks
```

#### 3.2 增量更新实现

```python
@app.patch("/api/docs/{doc_id}/blocks/{block_id}")
async def update_block(doc_id: str, block_id: str, update: BlockUpdate, db: AsyncSession):
    """更新指定块（保留历史）"""
    # 1. 加载现有文档
    ydoc = await load_ydoc(doc_id, db)

    # 2. 定位目标块
    xml_fragment = ydoc.get_xml_element("default")
    target_block = find_block_by_id(xml_fragment, block_id)

    if not target_block:
        raise HTTPException(404, "Block not found")

    # 3. 在事务中更新
    with ydoc.begin_transaction() as txn:
        # 清空旧内容
        while target_block.first_child:
            target_block.first_child.delete(txn)

        # 插入新内容
        text = target_block.push_xml_text(txn)
        text.insert(txn, 0, update.content)

    # 4. 保存增量更新
    update_data = Y.encode_state_as_update(ydoc)
    db.add(YDocUpdate(doc_id=doc_id, update=update_data))
    await db.commit()

    return {"success": True}
```

#### 3.3 插入操作实现

```python
@app.post("/api/docs/{doc_id}/blocks")
async def insert_block(doc_id: str, insert: BlockInsert, db: AsyncSession):
    """在指定位置插入新块"""
    ydoc = await load_ydoc(doc_id, db)
    xml_fragment = ydoc.get_xml_element("default")

    with ydoc.begin_transaction() as txn:
        if insert.after:
            # 找到目标块的位置
            target = find_block_by_id(xml_fragment, insert.after)
            position = get_block_position(xml_fragment, target) + 1
        else:
            position = 0

        # 解析 Markdown 并插入
        blocks = parse_markdown_to_blocks(insert.content)
        for block in blocks:
            elem = xml_fragment.insert_xml_element(txn, position, block['type'])
            if 'attrs' in block:
                for key, val in block['attrs'].items():
                    elem.set_attribute(txn, key, val)
            text = elem.push_xml_text(txn)
            text.insert(txn, 0, block['content'])
            position += 1

    update_data = Y.encode_state_as_update(ydoc)
    db.add(YDocUpdate(doc_id=doc_id, update=update_data))
    await db.commit()

    return {"success": True}
```

### 4. 前端同步机制

前端通过 WebSocket 实时接收后端的增量更新：

```typescript
// 前端监听 Yjs 更新
ydoc.on('update', (update: Uint8Array) => {
  // 自动同步到编辑器
  editor.commands.setContent(ydoc)
})

// 后端推送更新
websocket.send(Y.encodeStateAsUpdate(ydoc))
```

### 5. 使用示例

#### Agent 编辑文档流程

```python
import requests

# 1. 获取文档大纲
outline = requests.get("http://localhost:8000/api/docs/doc_123/outline").json()

# 2. 找到目标章节
target_section = outline['sections'][0]  # 第一章

# 3. 获取章节内容
section = requests.get(
    f"http://localhost:8000/api/docs/doc_123/sections/{target_section['id']}"
).json()

# 4. 更新某个段落
requests.patch(
    f"http://localhost:8000/api/docs/doc_123/blocks/paragraph_5",
    json={"content": "AI 修改后的内容"}
)

# 5. 在章节末尾插入新内容
requests.post(
    "http://localhost:8000/api/docs/doc_123/blocks",
    json={
        "after": section['blocks'][-1]['id'],
        "content": "## 新小节\n\n这是 AI 添加的内容"
    }
)
```

## 优势

1. **保留历史**：所有操作都是增量更新，不删除历史记录
2. **精确编辑**：Agent 可以只修改特定段落，不影响其他内容
3. **实时同步**：前端通过 WebSocket 自动接收更新
4. **人机协作**：人类和 Agent 可以同时编辑，CRDT 自动解决冲突

## 实施步骤

1. **Phase 1**：实现块 ID 生成和映射机制
2. **Phase 2**：实现读取 API（outline、sections）
3. **Phase 3**：实现增量写入 API（insert、update、delete）
4. **Phase 4**：前端集成 WebSocket 同步
5. **Phase 5**：测试人机协作场景

## 注意事项

- 块 ID 需要在文档变更时重新映射
- 并发编辑时需要处理块位置变化
- 大文档需要考虑分页加载
- 需要权限控制（谁可以编辑哪些块）
