import asyncio
from export_service import export_document_to_markdown
from database import AsyncSessionLocal

async def test():
    async with AsyncSessionLocal() as db:
        result = await export_document_to_markdown("doc_uuznv34h0", db)
        print(f"导出结果: {result}")

asyncio.run(test())
