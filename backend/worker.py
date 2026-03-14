from js import Response, Headers, WebSocket
import json

class YjsRoom:
    def __init__(self, state, env):
        self.state = state
        self.env = env
        self.sessions = []

    async def fetch(self, request):
        if request.headers.get("Upgrade") == "websocket":
            pair = WebSocket.pair()
            await self.handle_session(pair[1])
            return Response(None, status=101, webSocket=pair[0])
        return Response("Expected WebSocket", status=400)

    async def handle_session(self, ws):
        self.sessions.append(ws)
        ws.accept()

        async for msg in ws:
            for session in self.sessions:
                if session != ws:
                    await session.send(msg)

async def on_fetch(request, env):
    url = request.url
    if "/ws/" in url:
        room_name = url.split("/ws/")[-1]
        id = env.ROOMS.idFromName(room_name)
        stub = env.ROOMS.get(id)
        return await stub.fetch(request)

    return Response("Not Found", status=404)
