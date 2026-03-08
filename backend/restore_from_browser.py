"""
从浏览器 IndexedDB 恢复文档完整数据到后端数据库
"""
import asyncio
import base64
from database import AsyncSessionLocal
from models import YDocUpdate
from sqlalchemy import delete

async def restore_document(doc_id: str, base64_state: str):
    """从 base64 编码的完整状态恢复文档"""
    # 解码 base64
    state_bytes = base64.b64decode(base64_state)

    async with AsyncSessionLocal() as db:
        # 清空旧数据
        await db.execute(delete(YDocUpdate).where(YDocUpdate.doc_id == doc_id))

        # 保存完整状态
        db.add(YDocUpdate(doc_id=doc_id, update=state_bytes))
        await db.commit()

        print(f"✓ 已恢复文档 {doc_id}")
        print(f"  数据大小: {len(state_bytes)} 字节")

if __name__ == "__main__":
    print("=" * 60)
    print("步骤 1: 在浏览器打开文档，按 F12 打开开发者工具")
    print("步骤 2: 在 Console 中粘贴并运行以下代码：")
    print("=" * 60)
    print("""
// 使用 Y.js 正确合并文档状态
(async () => {
  const docId = 'doc_7yd9if41n';

  // 从 IndexedDB 获取所有更新
  const dbName = `doco-${docId}`;
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const tx = db.transaction(['updates'], 'readonly');
  const store = tx.objectStore('updates');
  const allUpdates = await new Promise((resolve) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
  });

  console.log(`找到 ${allUpdates.length} 条更新`);

  // 使用 Y.js 合并所有更新
  const Y = await import('yjs');
  const ydoc = new Y.Doc();

  allUpdates.forEach(item => {
    const data = item.value || item;
    Y.applyUpdate(ydoc, data);
  });

  // 导出完整状态
  const state = Y.encodeStateAsUpdate(ydoc);
  const base64 = btoa(String.fromCharCode(...state));

  console.log('Base64 (复制下面这行):');
  console.log(base64);
})();
""")
    print("=" * 60)
    print("步骤 3: 将 base64 字符串保存到文件 base64_data.txt")
    print("=" * 60)

    # 从文件读取
    try:
        with open('base64_data.txt', 'r') as f:
            base64_state = f.read().strip()
    except FileNotFoundError:
        print("错误：未找到 base64_data.txt 文件")
        print("请将 base64 字符串保存到 backend/base64_data.txt")
        exit(1)

    if not base64_state:
        print("错误：文件为空")
        exit(1)

    print(f"读取到 {len(base64_state)} 字符的 base64 数据")
    asyncio.run(restore_document('doc_7yd9if41n', base64_state))
    print("\n✓ 恢复完成！现在可以运行导出脚本了")
