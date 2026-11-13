# Apuntes

Listas de tareas (listas con casillas, como en Keep) con:

- **App web pensada para el móvil** para verlas y editarlas (`https://<tu-worker>.workers.dev/`). Se puede instalar en la pantalla de inicio: en iPhone, Safari → Compartir → *Añadir a pantalla de inicio*; en Android, Chrome → menú → *Instalar app*. En pantallas anchas muestra el índice y la lista abierta lado a lado.
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

## Desplegar (una sola vez, sin terminal)

Necesitas una cuenta gratuita de Cloudflare. La base de datos se crea sola en el primer despliegue y las tablas en la primera visita.

1. En el [panel de Cloudflare](https://dash.cloudflare.com) ve a **Compute (Workers) → Workers & Pages → Create → Import a repository**.
2. Conecta tu cuenta de GitHub, elige `To-Do-List-Claude` y pulsa **Deploy** sin cambiar nada (el comando de despliegue por defecto, `npx wrangler deploy`, sirve).
3. Cuando termine, entra en el Worker **listas-ia → Settings → Variables and Secrets → Add**: tipo **Secret**, nombre `ACCESS_TOKEN`, y como valor una contraseña larga inventada (mínimo 16 caracteres; mejor 30 o más). Guárdala: es la contraseña de la web y va dentro de la URL del conector.
4. Tu app queda en `https://listas-ia.<tu-subdominio>.workers.dev` (la URL aparece en la página del Worker).

Cada vez que se suba un cambio a `main` en GitHub, Cloudflare vuelve a desplegar solo.

### Alternativa con terminal

```bash
git clone https://github.com/Wachoss/To-Do-List-Claude.git && cd To-Do-List-Claude
npm install
npx wrangler login
npx wrangler secret put ACCESS_TOKEN    # pega tu contraseña larga
npm run deploy                          # crea la base de datos y publica el Worker
```

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
npm run dev        # http://localhost:8787  ·  MCP en /mcp/token-de-prueba-local
```

## Estructura

- `src/index.js` — rutas: web (`/`), API REST (`/api/*`, con `Authorization: Bearer <token>`) y MCP (`/mcp/<token>`).
- `src/mcp.js` — servidor MCP (transporte Streamable HTTP, sin estado).
- `src/store.js` — acceso a la base de datos D1.
- `src/ui.html` — la web (una sola página, sin dependencias). Tiene tres estilos que se eligen con el botón «Estilo»: Cuaderno, Ticket y Nevera. La elección se guarda en cada dispositivo.
- `src/assets/` — icono y manifiesto para instalarla como app.
- `schema.sql` — tablas.
