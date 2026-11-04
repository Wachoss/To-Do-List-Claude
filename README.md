# Listas IA

Listas de tareas estilo Google Keep (listas con casillas) con:

- **Web** para verlas y editarlas (`https://<tu-worker>.workers.dev/`).
- **Conector MCP** para que Claude (claude.ai, app móvil o escritorio) cree, lea y modifique tus listas.

Funciona gratis en **Cloudflare Workers + D1** (base de datos SQLite gestionada).

## Qué puede hacer Claude

| Herramienta | Qué hace |
|---|---|
| `list_lists` | Ver todas las listas (opcionalmente con sus elementos y las archivadas) |
| `get_list` | Ver una lista con sus elementos |
| `create_list` | Crear una lista, con elementos, color y fijada |
| `update_list` | Renombrar, cambiar color, fijar o archivar |
| `delete_list` | Borrar una lista |
| `add_items` | Añadir elementos |
| `update_item` / `set_items_checked` | Marcar, desmarcar, editar o mover elementos |
| `delete_item` / `clear_checked` | Borrar un elemento o todos los marcados |
| `search` | Buscar texto en listas y elementos |

Las listas se pueden indicar por su título ("añade leche a la compra").

## Desplegar (una sola vez, ~10 minutos)

Necesitas Node.js 18+ y una cuenta gratuita de Cloudflare.

```bash
git clone https://github.com/<tu-usuario>/listas-ia.git
cd listas-ia
npm install
npx wrangler login                      # abre el navegador para entrar en Cloudflare
npx wrangler d1 create listas-ia        # copia el "database_id" que aparece
```

Pega ese `database_id` en `wrangler.toml` (sustituye `REEMPLAZAR_CON_EL_ID_DE_TU_BASE_D1`). Después:

```bash
npm run db:init                         # crea las tablas
npx wrangler secret put ACCESS_TOKEN    # pega un token largo y secreto (ver abajo)
npm run deploy                          # te da la URL https://listas-ia.<tu-subdominio>.workers.dev
```

Para generar un token aleatorio: `node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"`.
Guárdalo: es la contraseña de la web y forma parte de la URL del conector.

## Conectar Claude

1. En claude.ai ve a **Ajustes → Conectores → Añadir conector personalizado**.
2. Nombre: `Listas`. URL: `https://listas-ia.<tu-subdominio>.workers.dev/mcp/<TU_ACCESS_TOKEN>`
3. Deja vacíos los campos de OAuth y guarda.
4. En un chat, activa el conector desde el menú de herramientas y pide, por ejemplo: *"Crea una lista de la compra con leche, pan y huevos"*.

El conector queda disponible también en la app móvil y de escritorio con la misma cuenta.

## Seguridad

- Quien conozca la URL del conector (que lleva el token) puede leer y editar tus listas: no la compartas.
- Para cambiar el token: `npx wrangler secret put ACCESS_TOKEN` y actualiza la URL del conector en claude.ai.

## Desarrollo local

```bash
echo 'ACCESS_TOKEN="token-de-prueba-local"' > .dev.vars
npm run db:init:local
npm run dev        # http://localhost:8787  ·  MCP en /mcp/token-de-prueba-local
```

## Estructura

- `src/index.js` — rutas: web (`/`), API REST (`/api/*`, con `Authorization: Bearer <token>`) y MCP (`/mcp/<token>`).
- `src/mcp.js` — servidor MCP (transporte Streamable HTTP, sin estado).
- `src/store.js` — acceso a la base de datos D1.
- `src/ui.html` — la web.
- `schema.sql` — tablas.
