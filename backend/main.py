import asyncio
import logging
from contextlib import asynccontextmanager
from typing import List, Optional, Dict

from fastapi import FastAPI, WebSocket, Depends, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.future import select
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
import y_py as Y

from ypy_websocket.websocket_server import WebsocketServer
from ypy_websocket.ystore import BaseYStore
from database import get_db, AsyncSessionLocal, engine
from models import KnowledgeBase, Folder, Document, YDocUpdate, Attachment
from export_service import export_document_to_markdown
import uuid
import os
from pathlib import Path

# Try to import ExceptionGroup for better error inspection (Python 3.11+ or exceptiongroup backport)
try:
    from exceptiongroup import ExceptionGroup
except ImportError:
    ExceptionGroup = None

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("doco")

class DocoYStore(BaseYStore):
    """Custom YStore that persists to our SQLite database."""

    def __init__(self, room_name: str):
        self.room_name = room_name
        self.ydoc = None
        self._started = None
        self._starting = False
        self._task_group = None
        self._pending_updates = []
        self._save_task = None
        self._last_write_at = 0.0

    def bind_doc(self, ydoc: Y.YDoc) -> None:
        self.ydoc = ydoc

    async def write(self, data: bytes) -> None:
        if not data:
            return

        self._last_write_at = asyncio.get_running_loop().time()
        size = len(data)
        self._pending_updates.append(data)
        pending_count = len(self._pending_updates)
        logger.info(
            f"[YStore] write() room={self.room_name} size={size}B pending={pending_count}"
        )

        if self._save_task is None or self._save_task.done():
            self._save_task = asyncio.create_task(self._debounced_save())

    async def _debounced_save(self):
        try:
            while True:
                delay = 2.0 - (asyncio.get_running_loop().time() - self._last_write_at)
                if delay > 0:
                    await asyncio.sleep(delay)

                if not self._pending_updates:
                    return

                # If new writes arrived during the sleep window, keep debouncing.
                quiet_for = asyncio.get_running_loop().time() - self._last_write_at
                if quiet_for < 2.0:
                    continue

                updates = self._pending_updates[:]
                self._pending_updates.clear()
                sizes = [len(u) for u in updates]
                total_bytes = sum(sizes)

                logger.info(
                    f"[YStore] flush-start room={self.room_name} batch={len(updates)} total={total_bytes}B sizes={sizes}"
                )

                if self.ydoc is None:
                    logger.warning(f"[YStore] flush-skip room={self.room_name} reason=no-ydoc")
                    return

                snapshot = Y.encode_state_as_update(self.ydoc)
                snapshot_size = len(snapshot)

                if snapshot_size <= 2:
                    logger.info(
                        f"[YStore] flush-skip room={self.room_name} reason=empty-snapshot size={snapshot_size}B"
                    )
                    return

                # Persist the whole room snapshot so reconnect-replayed docs are stored too.
                async with AsyncSessionLocal() as session:
                    skipped_count = sum(1 for data in updates if len(data) <= 2)
                    session.add(YDocUpdate(doc_id=self.room_name, update=snapshot))
                    await session.commit()
                    logger.info(
                        f"[YStore] flush-done room={self.room_name} snapshot={snapshot_size}B source_batch={len(updates)} skipped_small={skipped_count}"
                    )
                return
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Write error for {self.room_name}: {e}")
        finally:
            self._save_task = None

    async def read(self):
        """Async generator yielding (update, metadata) tuples."""
        try:
            async with AsyncSessionLocal() as session:
                stmt = select(YDocUpdate.update).where(
                    YDocUpdate.doc_id == self.room_name
                ).order_by(YDocUpdate.id)
                result = await session.execute(stmt)
                for update in result.scalars():
                    yield update, b""
        except Exception as e:
            logger.error(f"Read error for {self.room_name}: {e}")

class DocoWebsocketServer(WebsocketServer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._room_locks: Dict[str, asyncio.Lock] = {}

    async def get_room(self, name: str):
        if name not in self._room_locks:
            self._room_locks[name] = asyncio.Lock()

        async with self._room_locks[name]:
            if name in self.rooms:
                room = self.rooms[name]
                logger.info(f"[Room] Existing room {name}, started: {room.started.is_set()}")
                if not room.started.is_set():
                    await self.start_room(room)
                return room

            logger.info(f"[Room] Creating room: {name}")
            from ypy_websocket.yroom import YRoom

            # Use YRoom with built-in ystore for persistence
            store = DocoYStore(name)
            room = YRoom(ystore=store, ready=False)
            store.bind_doc(room.ydoc)

            # Load existing state
            try:
                await store.apply_updates(room.ydoc)
                state_size = len(Y.encode_state_as_update(room.ydoc))
                logger.info(f"Room {name} loaded ({state_size} bytes)")

                # 如果状态太小（可能是损坏的数据），清空让客户端重新同步
                if state_size <= 10:
                    logger.warning(f"Room {name} has corrupted/empty state, clearing to force client sync")
                    room.ydoc = Y.YDoc()
                    store.bind_doc(room.ydoc)
            except Exception as e:
                logger.error(f"Load error for {name}: {e}")

            # Now mark ready to start observing new updates
            room.ready = True
            self.rooms[name] = room

            # Start the room to enable broadcast and persistence
            try:
                await self.start_room(room)
                logger.info(f"Room {name} started, task_group: {room._task_group is not None}")
            except Exception as e:
                logger.error(f"Failed to start room {name}: {e}", exc_info=True)
            return room

websocket_server = DocoWebsocketServer(auto_clean_rooms=False)

async def _migrate_db():
    """自动迁移：为已有表添加缺失的列"""
    from sqlalchemy import text, inspect
    async with engine.begin() as conn:
        def _check_tables_and_columns(sync_conn):
            insp = inspect(sync_conn)
            tables = insp.get_table_names()
            doc_cols = {c["name"] for c in insp.get_columns("documents")} if "documents" in tables else set()
            return tables, doc_cols
        tables, doc_cols = await conn.run_sync(_check_tables_and_columns)

        if "attachments" not in tables:
            await conn.execute(text("""
                CREATE TABLE attachments (
                    id VARCHAR PRIMARY KEY,
                    filename VARCHAR NOT NULL,
                    filepath VARCHAR NOT NULL,
                    mime_type VARCHAR NOT NULL,
                    size INTEGER NOT NULL,
                    doc_id VARCHAR REFERENCES documents(id),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            logger.info("Migrated: created attachments table")

        if "kb_id" not in doc_cols:
            await conn.execute(text("ALTER TABLE documents ADD COLUMN kb_id INTEGER REFERENCES knowledge_bases(id)"))
            logger.info("Migrated: added kb_id to documents")
        if "heading_numbered" not in doc_cols:
            await conn.execute(text("ALTER TABLE documents ADD COLUMN heading_numbered BOOLEAN NOT NULL DEFAULT 0"))
            logger.info("Migrated: added heading_numbered to documents")
        if "bg_color" not in doc_cols:
            await conn.execute(text("ALTER TABLE documents ADD COLUMN bg_color VARCHAR NOT NULL DEFAULT '#ffffff'"))
            logger.info("Migrated: added bg_color to documents")
        if "collapsed_blocks" not in doc_cols:
            await conn.execute(text("ALTER TABLE documents ADD COLUMN collapsed_blocks TEXT NOT NULL DEFAULT ''"))
            logger.info("Migrated: added collapsed_blocks to documents")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Doco Backend: Initializing...")
    await _migrate_db()
    server_task = asyncio.create_task(websocket_server.start())
    try:
        await websocket_server.started.wait()
        logger.info("Doco Backend: WebSocket Server Started.")
        yield
    finally:
        logger.info("Doco Backend: Shutting down...")
        server_task.cancel()
        try:
            await server_task
        except asyncio.CancelledError:
            pass

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def exception_logging_middleware(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception as e:
        logger.error(f"HTTP Error {request.method} {request.url}: {e}", exc_info=True)
        return JSONResponse(status_code=500, content={"detail": str(e)})

# --- Schemas ---

class KBBase(BaseModel):
    name: str

class KBRead(KBBase):
    id: int
    model_config = ConfigDict(from_attributes=True)

class FolderBase(BaseModel):
    name: str
    kb_id: int
    parent_id: Optional[int] = None

class FolderRead(FolderBase):
    id: int
    model_config = ConfigDict(from_attributes=True)

class DocBase(BaseModel):
    id: str
    title: str
    folder_id: Optional[int] = None
    kb_id: Optional[int] = None
    heading_numbered: bool = False
    bg_color: str = "#ffffff"
    collapsed_blocks: str = ""

class DocRead(DocBase):
    model_config = ConfigDict(from_attributes=True)

class DocUpdate(BaseModel):
    title: Optional[str] = None
    folder_id: Optional[int] = None
    kb_id: Optional[int] = None
    heading_numbered: Optional[bool] = None
    bg_color: Optional[str] = None
    collapsed_blocks: Optional[str] = None

class FolderUpdate(BaseModel):
    name: Optional[str] = None

class KBUpdate(BaseModel):
    name: Optional[str] = None

# --- API Routes ---

@app.get("/api/kb", response_model=List[KBRead])
async def get_kbs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(KnowledgeBase))
    return result.scalars().all()

@app.post("/api/kb", response_model=KBRead)
async def create_kb(kb: KBBase, db: AsyncSession = Depends(get_db)):
    try:
        db_kb = KnowledgeBase(name=kb.name)
        db.add(db_kb)
        await db.commit()
        await db.refresh(db_kb)
        return db_kb
    except Exception as e:
        await db.rollback()
        logger.error(f"API KB Create Error: {e}")
        raise HTTPException(status_code=500, detail="Database Error")

@app.delete("/api/kb/{kb_id}")
async def delete_kb(kb_id: int, db: AsyncSession = Depends(get_db)):
    kb = await db.get(KnowledgeBase, kb_id)
    if kb:
        await db.delete(kb)
        await db.commit()
    return {"status": "ok"}

@app.get("/api/kb/{kb_id}/folders", response_model=List[FolderRead])
async def get_folders(kb_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Folder).where(Folder.kb_id == kb_id, Folder.parent_id == None)
    )
    return result.scalars().all()

@app.get("/api/kb/{kb_id}/docs", response_model=List[DocRead])
async def get_kb_docs(kb_id: int, db: AsyncSession = Depends(get_db)):
    """获取知识库直属文档（不属于任何文件夹的文档）"""
    result = await db.execute(
        select(Document).where(Document.kb_id == kb_id, Document.folder_id == None)
    )
    return result.scalars().all()

@app.get("/api/folders/{folder_id}/subfolders", response_model=List[FolderRead])
async def get_subfolders(folder_id: int, db: AsyncSession = Depends(get_db)):
    """获取文件夹的子文件夹"""
    result = await db.execute(
        select(Folder).where(Folder.parent_id == folder_id)
    )
    return result.scalars().all()

@app.post("/api/folders", response_model=FolderRead)
async def create_folder(folder: FolderBase, db: AsyncSession = Depends(get_db)):
    try:
        db_folder = Folder(**folder.model_dump())
        db.add(db_folder)
        await db.commit()
        await db.refresh(db_folder)
        return db_folder
    except Exception as e:
        await db.rollback()
        logger.error(f"API Folder Create Error: {e}")
        raise HTTPException(status_code=500, detail="Database Error")

@app.get("/api/folders/{folder_id}/docs", response_model=List[DocRead])
async def get_docs(folder_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Document).where(Document.folder_id == folder_id))
    return result.scalars().all()

@app.get("/api/docs/{doc_id}", response_model=DocRead)
async def get_doc(doc_id: str, db: AsyncSession = Depends(get_db)):
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc

@app.post("/api/docs", response_model=DocRead)
async def create_doc(doc: DocBase, db: AsyncSession = Depends(get_db)):
    try:
        db_doc = Document(**doc.model_dump())
        db.add(db_doc)
        await db.commit()
        await db.refresh(db_doc)
        return db_doc
    except Exception as e:
        await db.rollback()
        logger.error(f"API Doc Create Error: {e}")
        raise HTTPException(status_code=500, detail="Database Error")

@app.patch("/api/docs/{doc_id}", response_model=DocRead)
async def update_doc(doc_id: str, update: DocUpdate, db: AsyncSession = Depends(get_db)):
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if update.title is not None:
        doc.title = update.title
    if update.folder_id is not None:
        doc.folder_id = update.folder_id
        doc.kb_id = None  # 移入文件夹时清除直属知识库
    elif update.kb_id is not None:
        doc.kb_id = update.kb_id
        doc.folder_id = None  # 移入知识库直属时清除文件夹
    if update.heading_numbered is not None:
        doc.heading_numbered = update.heading_numbered
    if update.bg_color is not None:
        doc.bg_color = update.bg_color
    if update.collapsed_blocks is not None:
        doc.collapsed_blocks = update.collapsed_blocks
    await db.commit()
    await db.refresh(doc)
    return doc

@app.delete("/api/docs/{doc_id}")
async def delete_doc(doc_id: str, db: AsyncSession = Depends(get_db)):
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    # 同时删除 ydoc 更新记录
    from sqlalchemy import delete as sql_delete
    await db.execute(sql_delete(YDocUpdate).where(YDocUpdate.doc_id == doc_id))
    await db.delete(doc)
    await db.commit()
    return {"status": "ok"}

@app.patch("/api/folders/{folder_id}", response_model=FolderRead)
async def update_folder(folder_id: int, update: FolderUpdate, db: AsyncSession = Depends(get_db)):
    folder = await db.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    if update.name is not None:
        folder.name = update.name
    await db.commit()
    await db.refresh(folder)
    return folder

@app.delete("/api/folders/{folder_id}")
async def delete_folder(folder_id: int, db: AsyncSession = Depends(get_db)):
    folder = await db.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    await db.delete(folder)
    await db.commit()
    return {"status": "ok"}

@app.patch("/api/kb/{kb_id}", response_model=KBRead)
async def update_kb(kb_id: int, update: KBUpdate, db: AsyncSession = Depends(get_db)):
    kb = await db.get(KnowledgeBase, kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="KB not found")
    if update.name is not None:
        kb.name = update.name
    await db.commit()
    await db.refresh(kb)
    return kb

@app.get("/api/docs/{doc_id}/path")
async def get_doc_path(doc_id: str, db: AsyncSession = Depends(get_db)):
    """返回文档的完整路径信息：doc_id, folder_id, kb_id"""
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    folder = await db.get(Folder, doc.folder_id) if doc.folder_id else None
    kb_id = doc.kb_id or (folder.kb_id if folder else None)
    return {
        "doc_id": doc.id,
        "folder_id": doc.folder_id,
        "kb_id": kb_id,
    }

@app.get("/api/search/docs")
async def search_docs(q: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Document).where(Document.title.ilike(f"%{q}%")).limit(20)
    )
    docs = result.scalars().all()
    return [{"id": d.id, "title": d.title, "folder_id": d.folder_id} for d in docs]

# --- WebSocket ---

class FastAPIWebsocket:
    def __init__(self, websocket: WebSocket):
        self._websocket = websocket

    @property
    def path(self) -> str:
        # ypy-websocket uses path to determine room if serve is called without room
        return self._websocket.url.path.split("/")[-1] or "default"

    async def send(self, message: bytes):
        try:
            await self._websocket.send_bytes(message)
        except: pass

    async def recv(self) -> bytes:
        msg = await self._websocket.receive()
        if msg.get("type") == "websocket.disconnect":
            raise ConnectionError("Disconnected")
        data = msg.get("bytes")
        if data is not None:
            return data
        text = msg.get("text")
        if text is not None:
            return text.encode()
        raise ConnectionError("Protocol Error")

    def __aiter__(self):
        return self

    async def __anext__(self) -> bytes:
        try:
            return await self.recv()
        except ConnectionError:
            raise StopAsyncIteration

def log_exception_group(e, room_name):
    """Recursively logs exceptions in an ExceptionGroup or similar structures."""
    if ExceptionGroup and isinstance(e, ExceptionGroup):
        for sub_e in e.exceptions:
            log_exception_group(sub_e, room_name)
    elif hasattr(e, "exceptions"): # anyio structure
        for sub_e in e.exceptions: # type: ignore
            log_exception_group(sub_e, room_name)
    else:
        logger.error(f"Sub-exception in room {room_name}: {e}", exc_info=True)

# 图片上传目录
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

@app.post("/api/attachments/upload")
async def upload_attachment(
    file: UploadFile = File(...),
    doc_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    file_id = str(uuid.uuid4())
    ext = Path(file.filename).suffix if file.filename else ""
    filepath = UPLOAD_DIR / f"{file_id}{ext}"

    content = await file.read()
    filepath.write_bytes(content)

    attachment = Attachment(
        id=file_id,
        filename=file.filename or "untitled",
        filepath=str(filepath),
        mime_type=file.content_type or "application/octet-stream",
        size=len(content),
        doc_id=doc_id
    )
    db.add(attachment)
    await db.commit()

    return {"id": file_id, "url": f"/api/attachments/{file_id}"}

@app.get("/api/attachments/{attachment_id}")
async def get_attachment(attachment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Attachment).where(Attachment.id == attachment_id))
    attachment = result.scalar_one_or_none()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    return FileResponse(attachment.filepath, media_type=attachment.mime_type, filename=attachment.filename)

@app.get("/api/docs/{doc_id}/history")
async def get_doc_history(doc_id: str, db: AsyncSession = Depends(get_db)):
    """获取文档历史版本列表"""
    result = await db.execute(
        select(YDocUpdate).where(YDocUpdate.doc_id == doc_id).order_by(YDocUpdate.created_at.desc())
    )
    updates = result.scalars().all()
    return [{"id": u.id, "created_at": u.created_at.isoformat()} for u in updates]

@app.get("/api/docs/{doc_id}/history/{update_id}")
async def get_doc_version(doc_id: str, update_id: int, db: AsyncSession = Depends(get_db)):
    """获取指定版本的文档内容"""
    result = await db.execute(
        select(YDocUpdate).where(YDocUpdate.doc_id == doc_id, YDocUpdate.id <= update_id).order_by(YDocUpdate.created_at)
    )
    updates = result.scalars().all()

    ydoc = Y.YDoc()
    for update in updates:
        Y.apply_update(ydoc, update.update)

    state = Y.encode_state_as_update(ydoc)
    return {"state": state.hex()}

@app.post("/api/docs/{doc_id}/restore/{update_id}")
async def restore_doc_version(doc_id: str, update_id: int, db: AsyncSession = Depends(get_db)):
    """恢复到指定版本"""
    result = await db.execute(
        select(YDocUpdate).where(YDocUpdate.doc_id == doc_id, YDocUpdate.id <= update_id).order_by(YDocUpdate.created_at)
    )
    updates = result.scalars().all()

    ydoc = Y.YDoc()
    for update in updates:
        Y.apply_update(ydoc, update.update)

    snapshot = Y.encode_state_as_update(ydoc)

    from sqlalchemy import delete as sql_delete
    await db.execute(sql_delete(YDocUpdate).where(YDocUpdate.doc_id == doc_id))
    db.add(YDocUpdate(doc_id=doc_id, update=snapshot))
    await db.commit()

    return {"message": "恢复成功"}

@app.post("/api/docs/{doc_id}/compact")
async def compact_document(doc_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(YDocUpdate).where(YDocUpdate.doc_id == doc_id).order_by(YDocUpdate.created_at))
    updates = result.scalars().all()

    if len(updates) <= 1:
        return {"message": "无需压缩", "before": len(updates), "after": len(updates)}

    ydoc = Y.YDoc()
    for update in updates:
        Y.apply_update(ydoc, update.update)

    snapshot = Y.encode_state_as_update(ydoc)

    await db.execute(delete(YDocUpdate).where(YDocUpdate.doc_id == doc_id))
    db.add(YDocUpdate(doc_id=doc_id, update=snapshot))
    await db.commit()

    return {"message": "压缩完成", "before": len(updates), "after": 1, "size": len(snapshot)}

@app.post("/api/export/all")
async def export_all_docs(db: AsyncSession = Depends(get_db)):
    """批量导出所有文档为 Markdown"""
    result = await db.execute(select(Document))
    documents = result.scalars().all()

    success_count = 0
    for doc in documents:
        export_path = await export_document_to_markdown(doc.id, db)
        if export_path:
            success_count += 1

    return {"message": "导出完成", "total": len(documents), "success": success_count}

class MarkdownExportRequest(BaseModel):
    doc_id: str
    markdown: str

@app.post("/api/export/markdown")
async def save_markdown_export(request: MarkdownExportRequest, db: AsyncSession = Depends(get_db)):
    """接收前端转换好的 Markdown 并保存"""
    from export_service import save_markdown_content

    export_path = await save_markdown_content(request.doc_id, request.markdown, db)
    if export_path:
        return {"success": True, "path": str(export_path)}
    return {"success": False, "error": "导出失败"}

class DocContentUpdate(BaseModel):
    markdown: str

@app.get("/api/docs/{doc_id}/markdown")
async def get_doc_markdown(doc_id: str, db: AsyncSession = Depends(get_db)):
    """获取文档的 Markdown 内容（供 AI Agent 读取）"""
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    result = await db.execute(
        select(YDocUpdate).where(YDocUpdate.doc_id == doc_id).order_by(YDocUpdate.created_at)
    )
    updates = result.scalars().all()

    ydoc = Y.YDoc()
    for update in updates:
        Y.apply_update(ydoc, update.update)

    from export_service import _ydoc_to_markdown
    markdown = await _ydoc_to_markdown(ydoc, doc)

    return {"doc_id": doc_id, "title": doc.title, "markdown": markdown}

@app.put("/api/docs/{doc_id}/markdown")
async def update_doc_markdown(doc_id: str, update: DocContentUpdate, db: AsyncSession = Depends(get_db)):
    """更新文档内容（从 Markdown，供 AI Agent 写入）"""
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    from export_service import _markdown_to_ydoc
    ydoc = _markdown_to_ydoc(update.markdown)
    snapshot = Y.encode_state_as_update(ydoc)

    from sqlalchemy import delete as sql_delete
    await db.execute(sql_delete(YDocUpdate).where(YDocUpdate.doc_id == doc_id))
    db.add(YDocUpdate(doc_id=doc_id, update=snapshot))
    await db.commit()

    return {"success": True, "doc_id": doc_id}

@app.websocket("/ws/{room_name}")
async def ws_endpoint(websocket: WebSocket, room_name: str):
    await websocket.accept()
    logger.info(f"[WS] Client connected to room: {room_name}")
    try:
        ws = FastAPIWebsocket(websocket)
        await websocket_server.serve(ws)
        logger.info(f"[WS] Client session closed for room: {room_name}")
    except Exception as e:
        if "Disconnected" in str(e) or "protocol.disconnect" in str(e):
            logger.info(f"WebSocket client disconnected from {room_name}")
        else:
            logger.error(f"WebSocket session error for room {room_name}: {e}")
            log_exception_group(e, room_name)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
