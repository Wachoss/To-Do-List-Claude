import * as store from './store.js';
import { handleMcp } from './mcp.js';
import UI_HTML from './ui.html';

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Accept',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

function withCors(res) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
  return r;
}

async function handleApi(request, env, path) {
  const auth = request.headers.get('Authorization') || '';
  if (!safeEqual(auth.replace(/^Bearer\s+/i, ''), env.ACCESS_TOKEN)) {
    return Response.json({ error: 'Token incorrecto' }, { status: 401 });
  }
  const db = env.DB;
  const m = request.method;
  const body = m === 'POST' || m === 'PATCH' ? await request.json().catch(() => ({})) : {};
  const seg = path.split('/').filter(Boolean); // ['api', 'lists', id?, sub?]
  try {
    if (seg[1] === 'lists') {
      const id = seg[2];
      if (!id && m === 'GET') {
        const url = new URL(request.url);
        return Response.json(await store.getAllWithItems(db, { includeArchived: url.searchParams.get('archived') === '1' }));
      }
      if (!id && m === 'POST') return Response.json(await store.createList(db, body));
      if (id && !seg[3] && m === 'GET') return Response.json(await store.getList(db, id));
      if (id && !seg[3] && m === 'PATCH') return Response.json(await store.updateList(db, id, body));
      if (id && !seg[3] && m === 'DELETE') return Response.json(await store.deleteList(db, id));
      if (id && seg[3] === 'items' && m === 'POST') return Response.json(await store.addItems(db, id, body.items));
      if (id && seg[3] === 'clear-checked' && m === 'POST') return Response.json(await store.clearChecked(db, id));
    }
    if (seg[1] === 'items' && seg[2]) {
      if (m === 'PATCH') return Response.json(await store.updateItem(db, seg[2], body));
      if (m === 'DELETE') return Response.json(await store.deleteItem(db, seg[2]));
    }
    return Response.json({ error: 'No encontrado' }, { status: 404 });
  } catch (e) {
    if (e instanceof store.NotFound) return Response.json({ error: e.message }, { status: 404 });
    if (e instanceof store.BadRequest) return Response.json({ error: e.message }, { status: 400 });
    console.error(e);
    return Response.json({ error: 'Error interno' }, { status: 500 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!env.ACCESS_TOKEN || env.ACCESS_TOKEN.length < 16) {
      return new Response(
        'Falta configurar ACCESS_TOKEN (mínimo 16 caracteres). Ejecuta: npx wrangler secret put ACCESS_TOKEN',
        { status: 500 }
      );
    }

    if (path.startsWith('/mcp/')) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      const token = decodeURIComponent(path.slice('/mcp/'.length).replace(/\/+$/, ''));
      if (!safeEqual(token, env.ACCESS_TOKEN)) return withCors(new Response('Not found', { status: 404 }));
      return withCors(await handleMcp(request, env));
    }

    if (path.startsWith('/api/')) return handleApi(request, env, path);

    if (path === '/' || path === '/index.html') {
      return new Response(UI_HTML, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
          'X-Frame-Options': 'DENY',
        },
      });
    }
    if (path === '/favicon.ico') return new Response(null, { status: 204 });
    return new Response('Not found', { status: 404 });
  },
};
