import asyncio
from sqlalchemy import select
from database import AsyncSessionLocal
from models import Document, YDocUpdate
import y_py as Y

async def export_markdown(doc_id: str):
    async with AsyncSessionLocal() as db:
        # 加载文档
        doc = await db.get(Document, doc_id)
        if not doc:
            print(f"文档 {doc_id} 不存在")
            return

        print(f"文档标题: {doc.title}")

        # 加载 Yjs 更新
        result = await db.execute(
            select(YDocUpdate).where(YDocUpdate.doc_id == doc_id).order_by(YDocUpdate.id)
        )
        updates = result.scalars().all()
        print(f"找到 {len(updates)} 条更新记录")

        # 重建 YDoc
        ydoc = Y.YDoc()
        for update in updates:
            Y.apply_update(ydoc, update.update)

        # 获取 XML 内容
        xml = ydoc.get_xml_element("default")
        print(f"\n子节点数量: {len(xml)}")

        def get_text_content(element):
            """递归获取元素的文本内容"""
            text_parts = []
            child = element.first_child
            while child:
                if type(child).__name__ == 'YXmlText':
                    text_parts.append(str(child))
                elif hasattr(child, 'first_child'):
                    text_parts.append(get_text_content(child))
                child = child.next_sibling if hasattr(child, 'next_sibling') else None
            return ''.join(text_parts)

        # 使用 tree_walker 遍历所有节点
        markdown_lines = []

        print("\n开始遍历节点...")
        for i, item in enumerate(xml.tree_walker()):
            element = item[0]

            if type(element).__name__ != 'YXmlElement':
                continue

            node_type = element.name if hasattr(element, 'name') else 'unknown'
            content = get_text_content(element)

            if i < 10 or i % 50 == 0:
                print(f"节点 {i}: {node_type}, 长度: {len(content)}")

            # 转换为 Markdown
            if node_type == 'heading':
                level = element.attributes().get('level', 1)
                markdown_lines.append(f"{'#' * int(level)} {content}")
            elif node_type == 'paragraph':
                markdown_lines.append(content)
            elif node_type == 'codeBlock':
                lang = element.attributes().get('language', '')
                markdown_lines.append(f"```{lang}\n{content}\n```")
            else:
                markdown_lines.append(content)

            markdown_lines.append('')

        print(f"\n总共遍历了 {len([x for x in xml.tree_walker() if type(x[0]).__name__ == 'YXmlElement'])} 个元素节点")

        markdown = '\n'.join(markdown_lines)
        print(f"\n\n=== 导出的 Markdown (前1000字符) ===")
        print(markdown[:1000])
        print(f"\n总长度: {len(markdown)} 字符")

        with open('exported.md', 'w', encoding='utf-8') as f:
            f.write(markdown)
        print(f"\n已保存到 exported.md")

if __name__ == "__main__":
    asyncio.run(export_markdown("doc_uuznv34h0"))
