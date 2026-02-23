import asyncio
import logging
import traceback
from contextlib import asynccontextmanager
from typing import List, Optional

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
            logger.error(f"Persistence error for room {self.room_name}: {e}")

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
            logger.error(f"Database read error for room {self.room_name}: {e}")
            return None

class DocoWebsocketServer(WebsocketServer):
    async def get_room(self, name: str):
        # The base class get_room will create and start the room if it doesn't exist
        room = await super().get_room(name)
        
        # We only initialize our persistence once per room life
        if not hasattr(room, "_initialized_doco"):
            room._initialized_doco = True
            logger.info(f"Initializing persistence for room: {name}")
            store = SQLiteStore(name)
            
            try:
                # Load initial state
                initial_state = await store.read()
                if initial_state:
                    logger.info(f"Applying initial state to room {name} ({len(initial_state)} bytes)")
                    Y.apply_update(room.ydoc, initial_state)
                
                # Observe updates to persist them
                def on_update(event):
                    # We fire and forget the write task
                    asyncio.create_task(store.write(event.update))
                
                room.ydoc.observe_after_transaction(on_update)
            except Exception as e:
                logger.error(f"Failed to initialize persistence for room {name}: {e}")
        
        return room

websocket_server = DocoWebsocketServer()

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Doco Backend...")
    server_task = asyncio.create_task(websocket_server.start())
    try:
        await websocket_server.started.wait()
        logger.info("WebSocket Server Started.")
        yield
    finally:
        logger.info("Shutting down Doco Backend...")
        server_task.cancel()
        try:
            await server_task
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error during shutdown: {e}")

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def error_handling_middleware(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception as e:
        logger.error(f"Exception during {request.method} {request.url}: {e}", exc_info=True)
        return JSONResponse(status_code=500, content={"detail": "Internal Server Error", "message": str(e)})

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
        logger.info(f"KB Created: {db_kb.name} (ID: {db_kb.id})")
        return db_kb
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to create KB: {e}")
        raise HTTPException(status_code=500, detail="Database Error")

@app.delete("/api/kb/{kb_id}")
async def delete_kb(kb_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(KnowledgeBase).where(KnowledgeBase.id == kb_id))
    kb = result.scalar_one_or_none()
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
        raise HTTPException(status_code=500, detail=str(e))

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
        raise HTTPException(status_code=500, detail=str(e))

# --- WebSocket ---

class FastAPIWebsocket:
    def __init__(self, websocket: WebSocket):
        self._websocket = websocket

    @property
    def path(self) -> str:
        # Expected path format: /ws/{room_name}
        raw_path = self._websocket.url.path
        parts = raw_path.strip("/").split("/")
        return parts[-1] if len(parts) > 1 else "default"

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
        raise ConnectionError("Unexpected message")

@app.websocket("/ws")
@app.websocket("/ws/{room_name}")
async def ws_endpoint(websocket: WebSocket, room_name: str = "default"):
    await websocket.accept()
    try:
        # This will load persistence if it's the first time the room is accessed
        await websocket_server.get_room(room_name)
        
        ws = FastAPIWebsocket(websocket)
        await websocket_server.serve(ws)
    except Exception as e:
        logger.error(f"WebSocket session error ({room_name}): {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
