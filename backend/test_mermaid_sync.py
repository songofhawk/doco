"""
测试 Mermaid 节点同步
"""
import asyncio
import y_py as Y
from database import AsyncSessionLocal
from models import YDocUpdate
from sqlalchemy import select

async def test():
    doc_id = 'doc_ysgdidpj9'

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(YDocUpdate).where(YDocUpdate.doc_id == doc_id).order_by(YDocUpdate.id)
        )
        updates = result.scalars().all()

        print(f'数据库中有 {len(updates)} 条更新记录\n')

        # 重建 YDoc
        ydoc = Y.YDoc()
        for u in updates:
            Y.apply_update(ydoc, u.update)

        # 检查 XML 结构
        xml = ydoc.get_xml_element('default')

        print('=== YDoc XML 结构 ===')
        child = xml.first_child if hasattr(xml, 'first_child') else None
        count = 0

        while child is not None:
            count += 1
            if hasattr(child, 'name'):
                attrs = dict(child.attributes()) if hasattr(child, 'attributes') else {}
                print(f'\n节点 {count}: {child.name}')
                if attrs:
                    for k, v in attrs.items():
                        val_str = str(v)[:100]
                        print(f'  {k} = {val_str}')
                else:
                    print('  (无属性)')
            else:
                text = str(child)[:50]
                print(f'\n节点 {count}: 文本节点 "{text}"')

            child = child.next_sibling

        print(f'\n总共 {count} 个顶层节点')

if __name__ == '__main__':
    asyncio.run(test())
