import asyncio
import y_py as Y
from database import AsyncSessionLocal
from sqlalchemy.future import select
from sqlalchemy import func
from models import YDocUpdate

async def audit_rooms():
    async with AsyncSessionLocal() as session:
        # Get count and max size for each room
        # We need to use LENGTH function on the blob
        stmt = select(
            YDocUpdate.doc_id, 
            func.count(YDocUpdate.id), 
            func.max(func.length(YDocUpdate.update))
        ).group_by(YDocUpdate.doc_id)
        
        result = await session.execute(stmt)
        print(f"{'Room ID':<30} | {'Updates':<10} | {'Max Size (bytes)':<15}")
        print("-" * 60)
        for row in result:
            print(f"{row[0]:<30} | {row[1]:<10} | {row[2]:<15}")

if __name__ == "__main__":
    asyncio.run(audit_rooms())
