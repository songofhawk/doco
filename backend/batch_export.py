"""
批量导出所有现有文档为 Markdown
"""
import asyncio
import logging
from sqlalchemy.future import select
from database import AsyncSessionLocal
from models import Document
from export_service import export_document_to_markdown

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("doco.batch_export")


async def export_all_documents():
    """导出所有文档"""
    async with AsyncSessionLocal() as session:
        # 获取所有文档
        result = await session.execute(select(Document))
        documents = result.scalars().all()

        logger.info(f"Found {len(documents)} documents to export")

        # 逐个导出
        success_count = 0
        for doc in documents:
            logger.info(f"Exporting: {doc.title}")
            export_path = await export_document_to_markdown(doc.id, session)
            if export_path:
                success_count += 1

        logger.info(f"Export complete: {success_count}/{len(documents)} documents exported")


if __name__ == "__main__":
    asyncio.run(export_all_documents())
