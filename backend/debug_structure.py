import asyncio
from database import AsyncSessionLocal
from models import YDocUpdate
from sqlalchemy import select
import y_py as Y

async def debug():
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(YDocUpdate).where(YDocUpdate.doc_id == "doc_uuznv34h0").order_by(YDocUpdate.id)
        )
        updates = result.scalars().all()

        ydoc = Y.YDoc()
        for update in updates:
            Y.apply_update(ydoc, update.update)

        xml = ydoc.get_xml_element("default")
        print(f"根节点子节点数: {len(xml)}")

        # 遍历前10个顶层节点
        child = xml.first_child
        count = 0
        while child and count < 10:
            if hasattr(child, 'name'):
                print(f"\n顶层节点 {count}: {child.name}")
                # 检查是否有子节点
                inner = child.first_child
                inner_count = 0
                while inner and inner_count < 3:
                    print(f"  子节点: {type(inner).__name__}")
                    inner = inner.next_sibling if hasattr(inner, 'next_sibling') else None
                    inner_count += 1
            child = child.next_sibling if hasattr(child, 'next_sibling') else None
            count += 1

        print(f"\n实际遍历了 {count} 个顶层节点")

asyncio.run(debug())
