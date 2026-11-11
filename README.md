# QR de asistencia + Ruleta de premios

App web para registrar asistencia con un código QR y sortear premios entre los
asistentes con una ruleta.

- **`/`** — muestra el QR y la lista de asistentes.
- **`/check-in`** — formulario donde cada persona ingresa su nombre.
- **`/ruleta`** — ruleta que sortea un ganador (con modal de premio).
- **`/admin`** — panel privado (Basic auth) para agregar o eliminar asistencias.

## Almacenamiento

Las asistencias se guardan en **Upstash Redis** si están las variables
`UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`; si no, caen a un archivo
local (`data/attendance.json`), práctico para desarrollo.

En producción usá Redis: el archivo local se pierde cuando el contenedor se
reinicia o se redeploya.

## Correr localmente

```bash
npm install
cp .env.example .env   # y editá ADMIN_PASSWORD
npm start
```

Queda en http://localhost:3000 (sin variables de Upstash usa el archivo local).

## Deploy en Render (gratis)

1. Subí este repo a GitHub.
2. En [render.com](https://render.com) → **New → Web Service** → conectá el repo.
   Render detecta `render.yaml` y usa `npm install` / `npm start`.
3. Creá una base gratis en [upstash.com](https://upstash.com) (Redis) y copiá
   `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`.
4. En **Environment**, cargá:
   - `ADMIN_USER` — usuario del panel.
   - `ADMIN_PASSWORD` — **una contraseña fuerte**.
   - `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` — para que las
     asistencias persistan (si no, se pierden al reiniciar/redeployar).
   - `BASE_URL` *(opcional)* — la URL del servicio, ej. `https://qr-fiesta.onrender.com`.
     Si no la cargás, el QR usa la URL pública automáticamente.
5. **Create Web Service**. Al terminar tenés la URL pública con HTTPS.

### A tener en cuenta
- Con Upstash Redis configurado, las asistencias **persisten** aunque el servicio
  se duerma o se redeploye. Sin esas variables, se usa el archivo local y los
  datos son efímeros en Render.
- El plan free de Render "duerme" tras ~15 min sin tráfico (la primera visita
  después es lenta, pero **los datos no se pierden** si usás Redis).
- La lista de asistentes y la ruleta son **públicas** para cualquiera con el link.
