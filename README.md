# time_entry_services

Función de Catalyst (Node 24, Express 5, Advanced I/O) del proyecto **Tiempos**.
Documento del proyecto (configuración, despliegue, pendientes): `01-tiempos/PROYECTO.md` en el
repositorio de trabajo `AptusWidgets`.

## Estructura

| Carpeta | Qué contiene |
|---|---|
| `index.js` | Rutas |
| `TIME_ENTRY_ENDPOINT.md` | Contrato de `POST /:org/tiempos` |
| `services/` | Servicios propios de esta función |
| `core/` | **No editar.** Copia de `shared/catalyst-core/src` (auth Donatello, conexión, cliente de ReportesSandbox, catálogos, errores). Se actualiza con `node shared/catalyst-core/sync.mjs` desde el repositorio de trabajo |
| `tests/` | `npm test` (sin red; nunca escriben) |

## Secretos

`AUTH_TOKEN` (token del broker Donatello): variable de entorno de la función en Catalyst, o `.env`
local (ver `.env.example`). `.env` no se versiona.

## Comandos

```bash
npm install
npm test
```
