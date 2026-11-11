# QR de asistencia + Ruleta de premios

App web para registrar asistencia con un código QR y sortear premios entre los
asistentes con una ruleta.

- **`/`** — muestra el QR y la lista de asistentes.
- **`/check-in`** — formulario donde cada persona ingresa su nombre.
- **`/ruleta`** — ruleta que sortea un ganador (con modal de premio).
- **`/admin`** — panel privado (Basic auth) para agregar o eliminar asistencias.

## Correr localmente

```bash
npm install
cp .env.example .env   # y editá ADMIN_PASSWORD
npm start
```

Queda en http://localhost:3000

## Deploy en Render (gratis)

1. Subí este repo a GitHub.
2. En [render.com](https://render.com) → **New → Web Service** → conectá el repo.
   Render detecta `render.yaml` y usa `npm install` / `npm start`.
3. En **Environment**, cargá:
   - `ADMIN_USER` — usuario del panel.
   - `ADMIN_PASSWORD` — **una contraseña fuerte**.
   - `BASE_URL` *(opcional)* — la URL del servicio, ej. `https://qr-fiesta.onrender.com`.
     Si no la cargás, el QR usa la URL pública automáticamente.
4. **Create Web Service**. Al terminar tenés la URL pública con HTTPS.

### A tener en cuenta
- **Las asistencias se guardan en un archivo** (`data/attendance.json`). En el plan
  free de Render el disco es **efímero**: un reinicio o redeploy **borra los datos**.
  El plan free además "duerme" tras ~15 min sin tráfico (primera visita lenta).
  Durante el evento, mientras haya gente registrándose se mantiene despierto;
  hacé el sorteo antes de cualquier pausa larga y no redeployees durante la fiesta.
- La lista de asistentes y la ruleta son **públicas** para cualquiera con el link.
