"""
迁移脚本：将 Yjs 文档中的 Base64 图片提取为文件存储
"""
import asyncio
import base64
import re
import uuid
from pathlib import Path
from sqlalchemy.future import select
from database import AsyncSessionLocal
from models import YDocUpdate, Attachment, Document
import y_py as Y

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

async def migrate_images():
    async with AsyncSessionLocal() as db:
        # 获取所有文档
        result = await db.execute(select(Document))
        documents = result.scalars().all()

        total_images = 0
        total_saved = 0

        for doc in documents:
            print(f"\n处理文档: {doc.title} ({doc.id})")

            # 加载 Yjs 文档
            ydoc = Y.YDoc()
            result = await db.execute(
                select(YDocUpdate)
                .where(YDocUpdate.doc_id == doc.id)
                .order_by(YDocUpdate.created_at)
            )
            updates = result.scalars().all()

            if not updates:
                print(f"  跳过：无更新记录")
                continue

            # 应用所有更新
            for update in updates:
                Y.apply_update(ydoc, update.update)

            # 获取文档内容
            yxml = ydoc.get_xml_fragment("default")
            content = yxml.to_json()

            # 查找 Base64 图片
            base64_pattern = r'data:image/([^;]+);base64,([A-Za-z0-9+/=]+)'
            matches = re.findall(base64_pattern, str(content))

            if not matches:
                print(f"  未找到 Base64 图片")
                continue

            print(f"  找到 {len(matches)} 张 Base64 图片")
            total_images += len(matches)

            # 提取并保存图片
            for img_format, img_data in matches:
                try:
                    # 解码 Base64
                    img_bytes = base64.b64decode(img_data)

                    # 生成文件
                    file_id = str(uuid.uuid4())
                    ext = f".{img_format}" if img_format else ".png"
                    filepath = UPLOAD_DIR / f"{file_id}{ext}"

                    # 保存文件
                    filepath.write_bytes(img_bytes)

                    # 记录到数据库
                    attachment = Attachment(
                        id=file_id,
                        filename=f"migrated{ext}",
                        filepath=str(filepath),
                        mime_type=f"image/{img_format}",
                        size=len(img_bytes),
                        doc_id=doc.id
                    )
                    db.add(attachment)

                    # 替换文档中的 Base64 为 URL
                    old_src = f"data:image/{img_format};base64,{img_data}"
                    new_src = f"http://127.0.0.1:8000/api/attachments/{file_id}"
                    content = str(content).replace(old_src, new_src)

                    total_saved += 1
                    print(f"  ✓ 保存图片: {file_id}{ext} ({len(img_bytes)} bytes)")

                except Exception as e:
                    print(f"  ✗ 提取失败: {e}")

            await db.commit()

        print(f"\n迁移完成：共处理 {total_images} 张图片，成功保存 {total_saved} 张")

if __name__ == "__main__":
    asyncio.run(migrate_images())
