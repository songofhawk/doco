import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from ypy_websocket.websocket_server import WebsocketServer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("doco")

websocket_server = WebsocketServer()


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(websocket_server.start())
    await websocket_server.started.wait()
    yield
    task.cancel()
    try:
        await task
    except (asyncio.CancelledError, Exception):
        pass


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class FastAPIWebsocket:
    """Adapter to make FastAPI WebSocket compatible with ypy-websocket."""

    def __init__(self, websocket: WebSocket):
        self._websocket = websocket

    @property
    def path(self) -> str:
        # ypy-websocket uses `path` as the room key.
        # Frontend connects to ws://host/ws/room-name
        raw_path = self._websocket.url.path
        parts = raw_path.strip("/").split("/")
        # If path is "/ws/default-room", parts is ["ws", "default-room"] -> return "default-room"
        # If path is "/ws", parts is ["ws"] -> return "default"
        room = parts[-1] if len(parts) > 1 else "default"
        return room

    async def send(self, message: bytes):
        try:
            # print(f"[WS] Sending {len(message)} bytes to {self.path}")
            await self._websocket.send_bytes(message)
        except RuntimeError:
            # Connection already closed; ignore
            pass

    async def recv(self) -> bytes:
        # Use the low-level receive() to handle both binary and text frames,
        # and to convert disconnect into a clean exception that ypy-websocket expects.
        try:
            msg = await self._websocket.receive()
        except Exception as e:
            logger.error(f"WebSocket receive failed: {e}")
            raise ConnectionError(f"WebSocket receive failed: {e}") from e

        msg_type = msg.get("type")
        if msg_type == "websocket.disconnect":
            raise ConnectionError("WebSocket disconnected")
        if msg_type == "websocket.receive":
            # Binary frame → use bytes; text frame → encode to bytes
            data = msg.get("bytes")
            if data is not None:
                if len(data) > 0:
                    logger.info(f"[WS] Received {len(data)} bytes from {self.path}")
                return data
            text = msg.get("text")
            if text is not None:
                logger.info(f"[WS] Received text message from {self.path}")
                return text.encode()
        raise ConnectionError(f"Unexpected message type: {msg_type}")


@app.websocket("/ws")
@app.websocket("/ws/{room_name}")
async def ws_endpoint(websocket: WebSocket, room_name: str = "default"):
    await websocket.accept()
    ws = FastAPIWebsocket(websocket)
    try:
        await websocket_server.serve(ws)
    except ConnectionError:
        pass  # normal disconnect
    except Exception as e:
        print(f"WebSocket error: {e}")


@app.get("/")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
