import asyncio
import logging
import traceback
from contextlib import asynccontextmanager
from typing import List, Optional, Set, Dict

from fastapi import FastAPI, WebSocket, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession
import y_py as Y

from ypy_websocket.websocket_server import WebsocketServer
from database import get_db, AsyncSessionLocal
from models import KnowledgeBase, Folder, Document, YDocUpdate

# Try to import ExceptionGroup for better error inspection (Python 3.11+ or exceptiongroup backport)
try:
    from exceptiongroup import ExceptionGroup
except ImportError:
    ExceptionGroup = None

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("doco")

class SQLiteStore:
    def __init__(self, room_name: str):
        self.room_name = room_name

    async def write(self, data: bytes):
        try:
            async with AsyncSessionLocal() as session:
                new_update = YDocUpdate(doc_id=self.room_name, update=data)
                session.add(new_update)
                await session.commit()
        except Exception as e:
            logger.error(f"Persistence write error for room {self.room_name}: {e}")

    async def read(self) -> bytes:
        try:
            async with AsyncSessionLocal() as session:
                stmt = select(YDocUpdate.update).where(YDocUpdate.doc_id == self.room_name).order_by(YDocUpdate.id)
                result = await session.execute(stmt)
                updates = result.scalars().all()
                if not updates:
                    return None
                return Y.merge_updates(updates)
        except Exception as e:
            logger.error(f"Persistence read error for room {self.room_name}: {e}")
            return None

class DocoWebsocketServer(WebsocketServer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._room_locks: Dict[str, asyncio.Lock] = {}

    async def get_room(self, name: str):
        if name not in self._room_locks:
            self._room_locks[name] = asyncio.Lock()
            
        async with self._room_locks[name]:
            # super().get_room is async and handles room creation/starting internally
            room = await super().get_room(name)
            
            if not hasattr(room, "_initialized_doco"):
                logger.info(f"Initializing Doco persistence for room: {name}")
                store = SQLiteStore(name)
                
                try:
                    initial_state = await store.read()
                    if initial_state:
                        logger.info(f"Applying initial state to room {name} ({len(initial_state)} bytes)")
                        Y.apply_update(room.ydoc, initial_state)
                    
                    def on_update(event):
                        # Use call_soon to avoid blocking the transaction
                        asyncio.create_task(store.write(event.get_update()))
                    
                    room.ydoc.observe_after_transaction(on_update)
                    room._initialized_doco = True
                except Exception as e:
                    logger.error(f"Failed to initialize Doco persistence for room {name}: {e}")
            
            return room

websocket_server = DocoWebsocketServer()

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Doco Backend: Initializing...")
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

class DocRead(DocBase):
    model_config = ConfigDict(from_attributes=True)

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
    result = await db.execute(select(Folder).where(Folder.kb_id == kb_id))
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

@app.websocket("/ws")
@app.websocket("/ws/{room_name}")
async def ws_endpoint(websocket: WebSocket, room_name: str = "default"):
    await websocket.accept()
    try:
        # Pre-initialize room to handle persistence safely
        await websocket_server.get_room(room_name)
        
        ws = FastAPIWebsocket(websocket)
        await websocket_server.serve(ws)
    except Exception as e:
        logger.error(f"WebSocket session error for room {room_name}: {e}")
        log_exception_group(e, room_name)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
