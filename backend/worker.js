export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // WebSocket 路由
    if (url.pathname.startsWith('/ws/')) {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }

      const roomName = url.pathname.split('/ws/')[1];
      const id = env.ROOMS.idFromName(roomName);
      const room = env.ROOMS.get(id);

      return room.fetch(request);
    }

    // REST API 路由
    if (url.pathname.startsWith('/api/')) {
      return handleAPI(request, env);
    }

    return new Response('Not Found', { status: 404 });
  }
};

// Durable Object: Yjs 协同房间
export class YjsRoom {
  constructor(state, env) {
    this.state = state;
    this.sessions = [];
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws, message) {
    // 广播给其他客户端
    this.state.getWebSockets().forEach(socket => {
      if (socket !== ws) {
        socket.send(message);
      }
    });
  }

  async webSocketClose(ws, code, reason, wasClean) {
    ws.close(code, reason);
  }
}

async function handleAPI(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  // 知识库列表
  if (path === '/api/kb' && request.method === 'GET') {
    const result = await env.DB.prepare('SELECT * FROM knowledge_bases').all();
    return new Response(JSON.stringify(result.results), { headers });
  }

  // 创建知识库
  if (path === '/api/kb' && request.method === 'POST') {
    const { name } = await request.json();
    const result = await env.DB.prepare(
      'INSERT INTO knowledge_bases (name) VALUES (?) RETURNING *'
    ).bind(name).first();
    return new Response(JSON.stringify(result), { headers });
  }

  // 文档列表
  if (path.match(/^\/api\/kb\/\d+\/docs$/) && request.method === 'GET') {
    const kbId = path.split('/')[3];
    const result = await env.DB.prepare(
      'SELECT * FROM documents WHERE kb_id = ?'
    ).bind(kbId).all();
    return new Response(JSON.stringify(result.results), { headers });
  }

  // 创建文档
  if (path === '/api/docs' && request.method === 'POST') {
    const { title, kb_id, folder_id } = await request.json();
    const id = crypto.randomUUID();
    const result = await env.DB.prepare(
      'INSERT INTO documents (id, title, kb_id, folder_id) VALUES (?, ?, ?, ?) RETURNING *'
    ).bind(id, title, kb_id, folder_id).first();
    return new Response(JSON.stringify(result), { headers });
  }

  return new Response('Not Found', { status: 404, headers });
}
