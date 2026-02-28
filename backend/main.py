import asyncio
import logging
from contextlib import asynccontextmanager
from typing import List, Optional, Dict

from fastapi import FastAPI, WebSocket, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession
import y_py as Y

from ypy_websocket.websocket_server import WebsocketServer
from ypy_websocket.ystore import BaseYStore
from database import get_db, AsyncSessionLocal, engine
from models import KnowledgeBase, Folder, Document, YDocUpdate

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
        self._started = None
        self._starting = False
        self._task_group = None

    async def write(self, data: bytes) -> None:
        logger.info(f"[YStore] write called for {self.room_name}, data size: {len(data) if data else 0}")
        if not data or len(data) <= 2:
            logger.info(f"[YStore] Skipping small update for {self.room_name}")
            return
        try:
            async with AsyncSessionLocal() as session:
                session.add(YDocUpdate(doc_id=self.room_name, update=data))
                await session.commit()
                logger.info(f"Persisted {len(data)} bytes for {self.room_name}")
        except Exception as e:
            logger.error(f"Write error for {self.room_name}: {e}")

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

            # Load existing state
            try:
                await store.apply_updates(room.ydoc)
                state_size = len(Y.encode_state_as_update(room.ydoc))
                logger.info(f"Room {name} loaded ({state_size} bytes)")
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
        def _check_columns(sync_conn):
            insp = inspect(sync_conn)
            doc_cols = {c["name"] for c in insp.get_columns("documents")}
            return doc_cols
        doc_cols = await conn.run_sync(_check_columns)
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
        logger.info("[WS] Waiting for message...")
        msg = await self._websocket.receive()
        logger.info(f"[WS] Got message type: {msg.get('type')}")
        if msg.get("type") == "websocket.disconnect":
            raise ConnectionError("Disconnected")
        data = msg.get("bytes")
        if data is not None:
            logger.info(f"[WS] Received {len(data)} bytes")
            return data
        text = msg.get("text")
        if text is not None:
            logger.info(f"[WS] Received text: {len(text)} chars")
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

@app.websocket("/ws/{room_name}")
async def ws_endpoint(websocket: WebSocket, room_name: str):
    await websocket.accept()
    logger.info(f"[WS] Client connected to room: {room_name}")
    try:
        ws = FastAPIWebsocket(websocket)
        logger.info(f"[WS] Calling serve, server task_group: {websocket_server._task_group is not None}")
        await websocket_server.serve(ws)
        logger.info(f"[WS] serve returned for {room_name}")
    except Exception as e:
        if "Disconnected" in str(e) or "protocol.disconnect" in str(e):
            logger.info(f"WebSocket client disconnected from {room_name}")
        else:
            logger.error(f"WebSocket session error for room {room_name}: {e}")
            log_exception_group(e, room_name)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
