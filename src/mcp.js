// Servidor MCP mínimo (transporte "Streamable HTTP", modo sin estado, respuestas JSON).
import * as store from './store.js';

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const listRef = {
  type: 'string',
  description: 'Id de la lista o su título (se acepta el título aunque no coincidan mayúsculas).',
};

const TOOLS = [
  {
    name: 'list_lists',
    description:
      'Muestra todas las listas de tareas (título, id, color, si está fijada y cuántos elementos tiene hechos/pendientes). Úsala primero para saber qué listas existen.',
    inputSchema: {
      type: 'object',
      properties: {
        include_archived: { type: 'boolean', description: 'Incluir también las listas archivadas.' },
        include_items: { type: 'boolean', description: 'Incluir los elementos de cada lista.' },
      },
    },
    annotations: { readOnlyHint: true },
    run: async (db, a) =>
      a.include_items
        ? store.getAllWithItems(db, { includeArchived: !!a.include_archived })
        : store.listLists(db, { includeArchived: !!a.include_archived }),
  },
  {
    name: 'get_list',
    description: 'Devuelve una lista con todos sus elementos (cada uno con su id, texto y si está marcado).',
    inputSchema: { type: 'object', properties: { list: listRef }, required: ['list'] },
    annotations: { readOnlyHint: true },
    run: (db, a) => store.getList(db, a.list),
  },
  {
    name: 'create_list',
    description: 'Crea una lista nueva, opcionalmente con elementos iniciales.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Título de la lista.' },
        items: { type: 'array', items: { type: 'string' }, description: 'Elementos iniciales (sin marcar).' },
        color: { type: 'string', enum: store.COLORS, description: 'Color de la tarjeta.' },
        pinned: { type: 'boolean', description: 'Fijar la lista arriba.' },
      },
      required: ['title'],
    },
    run: (db, a) => store.createList(db, a),
  },
  {
    name: 'update_list',
    description: 'Cambia el título, color, si está fijada o si está archivada de una lista.',
    inputSchema: {
      type: 'object',
      properties: {
        list: listRef,
        title: { type: 'string' },
        color: { type: 'string', enum: store.COLORS },
        pinned: { type: 'boolean' },
        archived: { type: 'boolean' },
      },
      required: ['list'],
    },
    run: (db, { list, ...rest }) => store.updateList(db, list, rest),
  },
  {
    name: 'delete_list',
    description: 'Borra una lista y todos sus elementos de forma permanente. Confirma con el usuario antes de usarla.',
    inputSchema: { type: 'object', properties: { list: listRef }, required: ['list'] },
    annotations: { destructiveHint: true },
    run: async (db, a) => ({ deleted: await store.deleteList(db, a.list) }),
  },
  {
    name: 'add_items',
    description: 'Añade uno o varios elementos al final de una lista.',
    inputSchema: {
      type: 'object',
      properties: {
        list: listRef,
        items: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Textos de los elementos.' },
      },
      required: ['list', 'items'],
    },
    run: (db, a) => store.addItems(db, a.list, a.items),
  },
  {
    name: 'update_item',
    description:
      'Modifica un elemento: marcarlo como hecho (checked=true), desmarcarlo (checked=false), cambiar su texto o su posición. Necesita el id del elemento (sale en get_list).',
    inputSchema: {
      type: 'object',
      properties: {
        item_id: { type: 'string' },
        checked: { type: 'boolean' },
        text: { type: 'string' },
        position: { type: 'integer', description: 'Posición (0 = arriba).' },
      },
      required: ['item_id'],
    },
    run: (db, { item_id, ...rest }) => store.updateItem(db, item_id, rest),
  },
  {
    name: 'set_items_checked',
    description: 'Marca o desmarca varios elementos a la vez.',
    inputSchema: {
      type: 'object',
      properties: {
        item_ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
        checked: { type: 'boolean' },
      },
      required: ['item_ids', 'checked'],
    },
    run: async (db, a) => ({
      updated: await Promise.all(a.item_ids.map((id) => store.updateItem(db, id, { checked: a.checked }))),
    }),
  },
  {
    name: 'delete_item',
    description: 'Borra un elemento de una lista.',
    inputSchema: { type: 'object', properties: { item_id: { type: 'string' } }, required: ['item_id'] },
    annotations: { destructiveHint: true },
    run: async (db, a) => ({ deleted: await store.deleteItem(db, a.item_id) }),
  },
  {
    name: 'clear_checked',
    description: 'Borra todos los elementos ya marcados como hechos de una lista.',
    inputSchema: { type: 'object', properties: { list: listRef }, required: ['list'] },
    annotations: { destructiveHint: true },
    run: (db, a) => store.clearChecked(db, a.list),
  },
  {
    name: 'search',
    description: 'Busca texto en los títulos de las listas y en los elementos.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    annotations: { readOnlyHint: true },
    run: (db, a) => store.search(db, a.query),
  },
];

const TOOL_LIST = TOOLS.map(({ run, ...t }) => t);

const INSTRUCTIONS =
  'Listas de tareas estilo Google Keep del usuario. Usa list_lists para ver qué listas hay y get_list para ver los ' +
  'elementos con sus ids. Puedes referirte a una lista por su título. Pide confirmación antes de borrar listas.';

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

async function handleMessage(msg, env) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(msg?.id, -32600, 'Invalid Request');
  }
  const isNotification = msg.id === undefined || msg.id === null;
  if (isNotification) return null; // notifications/initialized, cancelled, etc.

  const p = msg.params || {};
  switch (msg.method) {
    case 'initialize': {
      const v = SUPPORTED_VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : SUPPORTED_VERSIONS[0];
      return rpcResult(msg.id, {
        protocolVersion: v,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'listas-ia', title: 'Apuntes', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, { tools: TOOL_LIST });
    case 'resources/list':
      return rpcResult(msg.id, { resources: [] });
    case 'prompts/list':
      return rpcResult(msg.id, { prompts: [] });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === p.name);
      if (!tool) return rpcError(msg.id, -32602, `Herramienta desconocida: ${p.name}`);
      try {
        const out = await tool.run(env.DB, p.arguments || {});
        return rpcResult(msg.id, {
          content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
        });
      } catch (e) {
        const known = e instanceof store.NotFound || e instanceof store.BadRequest;
        if (!known) console.error(e);
        return rpcResult(msg.id, {
          isError: true,
          content: [{ type: 'text', text: known ? e.message : `Error interno: ${e.message}` }],
        });
      }
    }
    default:
      return rpcError(msg.id, -32601, `Método no soportado: ${msg.method}`);
  }
}

export async function handleMcp(request, env) {
  if (request.method === 'GET') {
    // No ofrecemos canal SSE de servidor → cliente.
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST, DELETE' } });
  }
  if (request.method === 'DELETE') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, 'Parse error'), { status: 400 });
  }
  const batch = Array.isArray(body);
  const msgs = batch ? body : [body];
  const responses = (await Promise.all(msgs.map((m) => handleMessage(m, env)))).filter(Boolean);
  if (!responses.length) return new Response(null, { status: 202 });
  return Response.json(batch ? responses : responses[0]);
}
