// Acceso a datos (Cloudflare D1). Todas las funciones reciben `db` (env.DB).

export const COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'brown', 'gray'];

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

export class NotFound extends Error {}
export class BadRequest extends Error {}

function rowToList(r) {
  return {
    id: r.id,
    title: r.title,
    color: r.color,
    pinned: !!r.pinned,
    archived: !!r.archived,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function rowToItem(r) {
  return { id: r.id, text: r.text, checked: !!r.checked, position: r.position };
}

function cleanText(t, field = 'texto') {
  if (typeof t !== 'string' || !t.trim()) throw new BadRequest(`El ${field} no puede estar vacío`);
  return t.trim().slice(0, 2000);
}

function checkColor(c) {
  if (c === undefined || c === null) return undefined;
  if (!COLORS.includes(c)) throw new BadRequest(`Color no válido. Usa uno de: ${COLORS.join(', ')}`);
  return c;
}

async function touchList(db, listId) {
  await db.prepare('UPDATE lists SET updated_at = ? WHERE id = ?').bind(now(), listId).run();
}

/** Busca una lista por id exacto o, si no, por título (sin distinguir mayúsculas). */
export async function resolveList(db, ref) {
  if (!ref || typeof ref !== 'string') throw new BadRequest('Falta la lista (id o título)');
  let r = await db.prepare('SELECT * FROM lists WHERE id = ?').bind(ref).first();
  if (r) return rowToList(r);
  const { results } = await db
    .prepare('SELECT * FROM lists WHERE lower(title) = lower(?) ORDER BY archived, updated_at DESC')
    .bind(ref.trim())
    .all();
  if (results.length) return rowToList(results[0]);
  const like = await db
    .prepare("SELECT * FROM lists WHERE lower(title) LIKE lower(?) ORDER BY archived, updated_at DESC")
    .bind(`%${ref.trim()}%`)
    .all();
  if (like.results.length === 1) return rowToList(like.results[0]);
  if (like.results.length > 1) {
    throw new BadRequest(
      `"${ref}" coincide con varias listas: ${like.results.map((x) => `${x.title} (${x.id})`).join(', ')}. Usa el id.`
    );
  }
  throw new NotFound(`No existe ninguna lista "${ref}"`);
}

export async function getItems(db, listId) {
  const { results } = await db
    .prepare('SELECT * FROM items WHERE list_id = ? ORDER BY position, created_at')
    .bind(listId)
    .all();
  return results.map(rowToItem);
}

export async function listLists(db, { includeArchived = false } = {}) {
  const { results } = await db
    .prepare(
      `SELECT l.*,
        (SELECT COUNT(*) FROM items i WHERE i.list_id = l.id) AS total,
        (SELECT COUNT(*) FROM items i WHERE i.list_id = l.id AND i.checked = 1) AS done
       FROM lists l ${includeArchived ? '' : 'WHERE l.archived = 0'}
       ORDER BY l.pinned DESC, l.updated_at DESC`
    )
    .all();
  return results.map((r) => ({ ...rowToList(r), total_items: r.total, checked_items: r.done }));
}

export async function getAllWithItems(db, { includeArchived = false } = {}) {
  const lists = await listLists(db, { includeArchived });
  const { results } = await db.prepare('SELECT * FROM items ORDER BY position, created_at').all();
  const byList = {};
  for (const r of results) (byList[r.list_id] ||= []).push(rowToItem(r));
  return lists.map((l) => ({ ...l, items: byList[l.id] || [] }));
}

export async function getList(db, ref) {
  const list = await resolveList(db, ref);
  return { ...list, items: await getItems(db, list.id) };
}

export async function createList(db, { title, items = [], color, pinned = false }) {
  const id = newId();
  const t = now();
  await db
    .prepare('INSERT INTO lists (id, title, color, pinned, archived, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
    .bind(id, cleanText(title, 'título'), checkColor(color) || 'default', pinned ? 1 : 0, t, t)
    .run();
  if (items.length) await addItems(db, id, items);
  return getList(db, id);
}

export async function updateList(db, ref, { title, color, pinned, archived }) {
  const list = await resolveList(db, ref);
  const sets = [];
  const vals = [];
  if (title !== undefined) { sets.push('title = ?'); vals.push(cleanText(title, 'título')); }
  if (color !== undefined) { sets.push('color = ?'); vals.push(checkColor(color)); }
  if (pinned !== undefined) { sets.push('pinned = ?'); vals.push(pinned ? 1 : 0); }
  if (archived !== undefined) { sets.push('archived = ?'); vals.push(archived ? 1 : 0); }
  if (!sets.length) throw new BadRequest('No hay nada que cambiar');
  sets.push('updated_at = ?');
  vals.push(now(), list.id);
  await db.prepare(`UPDATE lists SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return getList(db, list.id);
}

export async function deleteList(db, ref) {
  const list = await resolveList(db, ref);
  await db.batch([
    db.prepare('DELETE FROM items WHERE list_id = ?').bind(list.id),
    db.prepare('DELETE FROM lists WHERE id = ?').bind(list.id),
  ]);
  return list;
}

export async function addItems(db, listRef, texts) {
  const list = await resolveList(db, listRef);
  if (!Array.isArray(texts) || !texts.length) throw new BadRequest('Indica al menos un elemento');
  const max = await db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM items WHERE list_id = ?').bind(list.id).first();
  let pos = max.m + 1;
  const t = now();
  const created = [];
  const stmts = texts.map((raw) => {
    const text = cleanText(typeof raw === 'string' ? raw : raw?.text);
    const checked = typeof raw === 'object' && raw?.checked ? 1 : 0;
    const id = newId();
    created.push({ id, text, checked: !!checked, position: pos });
    return db
      .prepare('INSERT INTO items (id, list_id, text, checked, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, list.id, text, checked, pos++, t, t);
  });
  await db.batch(stmts);
  await touchList(db, list.id);
  return { list, items: created };
}

async function getItemRow(db, itemId) {
  const r = await db.prepare('SELECT * FROM items WHERE id = ?').bind(itemId).first();
  if (!r) throw new NotFound(`No existe el elemento ${itemId}`);
  return r;
}

export async function updateItem(db, itemId, { text, checked, position }) {
  const r = await getItemRow(db, itemId);
  const sets = [];
  const vals = [];
  if (text !== undefined) { sets.push('text = ?'); vals.push(cleanText(text)); }
  if (checked !== undefined) { sets.push('checked = ?'); vals.push(checked ? 1 : 0); }
  if (position !== undefined) { sets.push('position = ?'); vals.push(Number(position) || 0); }
  if (!sets.length) throw new BadRequest('No hay nada que cambiar');
  sets.push('updated_at = ?');
  vals.push(now(), itemId);
  await db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  await touchList(db, r.list_id);
  return rowToItem(await getItemRow(db, itemId));
}

export async function deleteItem(db, itemId) {
  const r = await getItemRow(db, itemId);
  await db.prepare('DELETE FROM items WHERE id = ?').bind(itemId).run();
  await touchList(db, r.list_id);
  return rowToItem(r);
}

export async function clearChecked(db, listRef) {
  const list = await resolveList(db, listRef);
  const res = await db.prepare('DELETE FROM items WHERE list_id = ? AND checked = 1').bind(list.id).run();
  await touchList(db, list.id);
  return { list, removed: res.meta?.changes ?? 0 };
}

export async function search(db, query) {
  const q = `%${cleanText(query, 'texto de búsqueda')}%`;
  const lists = await db.prepare('SELECT * FROM lists WHERE lower(title) LIKE lower(?)').bind(q).all();
  const items = await db
    .prepare(
      `SELECT i.*, l.title AS list_title FROM items i JOIN lists l ON l.id = i.list_id
       WHERE lower(i.text) LIKE lower(?) ORDER BY l.updated_at DESC, i.position`
    )
    .bind(q)
    .all();
  return {
    lists: lists.results.map(rowToList),
    items: items.results.map((r) => ({ ...rowToItem(r), list_id: r.list_id, list_title: r.list_title })),
  };
}
