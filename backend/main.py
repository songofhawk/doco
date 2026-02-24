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
                logger.info(f"Persisted update for room {self.room_name} ({len(data)} bytes)")
        except Exception as e:
            logger.error(f"Persistence write error for room {self.room_name}: {e}")

    async def read(self) -> Optional[bytes]:
        try:
            async with AsyncSessionLocal() as session:
                stmt = select(YDocUpdate.update).where(YDocUpdate.doc_id == self.room_name).order_by(YDocUpdate.id)
                result = await session.execute(stmt)
                updates = list(result.scalars().all())
                if not updates:
                    return None
                
                # Manual merge: y-py doesn't have merge_updates
                temp_doc = Y.YDoc()
                for i, update in enumerate(updates):
                    try:
                        Y.apply_update(temp_doc, update)
                    except Exception as apply_err:
                        logger.error(f"Error applying update {i} for room {self.room_name}: {apply_err}")
                
                return Y.encode_state_as_update(temp_doc)
        except Exception as e:
            logger.error(f"Persistence read error for room {self.room_name}: {e}")
            return None

class DocoWebsocketServer(WebsocketServer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._room_locks: Dict[str, asyncio.Lock] = {}

    async def get_room(self, name: str):
        # We need strict locking to prevent multiple initializations
        if name not in self._room_locks:
            self._room_locks[name] = asyncio.Lock()
            
        async with self._room_locks[name]:
            # If the room is already in self.rooms, it's fully initialized
            if name in self.rooms:
                return self.rooms[name]

            logger.info(f"Creating and pre-loading room: {name}")
            # we manually create the room to control initialization order
            from ypy_websocket.yroom import YRoom
            room = YRoom()
            
            # 1. Load Persistence BEFORE anything else
            store = SQLiteStore(name)
            try:
                initial_state = await store.read()
                if initial_state:
                    logger.info(f"Applying initial state to {name} ({len(initial_state)} bytes)")
                    Y.apply_update(room.ydoc, initial_state)
                    
                    # Peek at content to verify it's loaded
                    # y-py uses get_xml_element for fragments
                    content_peek = str(room.ydoc.get_xml_element("default"))
                    if content_peek == "<UNDEFINED></UNDEFINED>":
                        content_peek = str(room.ydoc.get_text("default"))
                    
                    logger.info(f"Room {name} loaded. Content peek: '{content_peek[:50]}...'")
                else:
                    logger.info(f"Room {name} is new (no persistence found)")
            except Exception as e:
                logger.error(f"Persistence loading failure for {name}: {e}", exc_info=True)

            # 2. Set up Observers AFTER state is loaded
            def on_update(event):
                try:
                    data = event.get_update()
                    # Debugging 2-byte issue
                    full_state = Y.encode_state_as_update(room.ydoc)
                    if len(data) > 2 or len(full_state) > 2:
                        logger.info(f"Update for {name}: inc={len(data)}b, full={len(full_state)}b")
                    
                    if data and len(data) > 2:
                        asyncio.create_task(store.write(data))
                except Exception as e:
                    logger.error(f"Error in on_update for {name}: {e}")
            
            room.ydoc.observe_after_transaction(on_update)
            room._initialized_doco = True

            # 3. Register the room
            self.rooms[name] = room

            # We DO NOT call room.start() here because self.serve() will trigger it
            # via start_room() the first time it serves this room.
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

@app.websocket("/ws/{room_name}")
async def ws_endpoint(websocket: WebSocket, room_name: str):
    await websocket.accept()
    try:
        # Pre-initialize room to handle persistence safely
        await websocket_server.get_room(room_name)
        
        ws = FastAPIWebsocket(websocket)
        # Serve needs to be called within a safe task group managed by the server
        await websocket_server.serve(ws)
    except Exception as e:
        # Don't log normal disconnects as errors
        if "Disconnected" in str(e) or "protocol.disconnect" in str(e):
            logger.info(f"WebSocket client disconnected from {room_name}")
        else:
            logger.error(f"WebSocket session error for room {room_name}: {e}")
            log_exception_group(e, room_name)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
