require("dotenv").config();

const express = require("express");
const QRCode = require("qrcode");
const path = require("node:path");
const { timingSafeEqual } = require("node:crypto");
const { createStore, onlyDigits } = require("./store");

const app = express();
// Render (y otros PaaS) sirven detrás de un proxy HTTPS. Con esto req.protocol
// refleja "https", así el QR se genera con la URL pública correcta.
app.set("trust proxy", true);
const port = Number(process.env.PORT) || 3000;
const attendanceFile = path.join(__dirname, "data", "attendance.json");

// Guarda en Upstash Redis si están sus variables; si no, en archivo local.
const store = createStore(attendanceFile);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/check-in", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "check-in.html"));
});

app.get("/ruleta", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "ruleta.html"));
});

function normalizeName(rawName) {
  const name = typeof rawName === "string" ? rawName.trim().replace(/\s+/g, " ") : "";

  if (name.length < 2) {
    return { error: "Ingresá tu nombre." };
  }
  if (name.length > 80) {
    return { error: "El nombre es demasiado largo." };
  }
  return { name };
}

function normalizeDni(rawDni) {
  const dni = onlyDigits(rawDni);

  if (dni.length < 7) {
    return { error: "Ingresá un DNI válido (sin puntos)." };
  }
  if (dni.length > 9) {
    return { error: "El DNI es demasiado largo." };
  }
  return { dni };
}

function isAdmin(req, res, next) {
  const username = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    return res.status(503).send("Configura ADMIN_USER y ADMIN_PASSWORD para habilitar el panel.");
  }

  const authorization = req.get("authorization") || "";
  const [scheme, encodedCredentials] = authorization.split(" ");

  if (scheme === "Basic" && encodedCredentials) {
    const credentials = Buffer.from(encodedCredentials, "base64").toString("utf8");
    const separator = credentials.indexOf(":");
    const providedUsername = separator >= 0 ? credentials.slice(0, separator) : "";
    const providedPassword = separator >= 0 ? credentials.slice(separator + 1) : "";

    if (
      safeEqual(providedUsername, username) &&
      safeEqual(providedPassword, password)
    ) {
      return next();
    }
  }

  res.set("WWW-Authenticate", 'Basic realm="Asistencia"');
  return res.status(401).send("Autenticación requerida.");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

app.get("/api/qr", async (req, res, next) => {
  try {
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
    const checkInUrl = new URL("/check-in", baseUrl).toString();
    const image = await QRCode.toDataURL(checkInUrl, { width: 280, margin: 2 });
    res.json({ image, checkInUrl, count: await store.count() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/attendance", async (req, res, next) => {
  const { name, error: nameError } = normalizeName(req.body.name);
  if (nameError) {
    return res.status(400).json({ error: nameError });
  }
  const { dni, error: dniError } = normalizeDni(req.body.dni);
  if (dniError) {
    return res.status(400).json({ error: dniError });
  }

  const attendee = { name, dni, checkedInAt: new Date().toISOString() };

  try {
    const added = await store.add(dni, attendee);
    if (!added) {
      return res.status(409).json({
        code: "duplicate",
        error: "Este DNI ya participa del sorteo.",
      });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "No se pudo guardar la participación." });
  }

  return res.status(201).json({ message: "¡Listo! Ya participás del sorteo.", name });
});

app.get("/admin", isAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Listado completo (con fechas): solo el admin.
app.get("/api/attendees", isAdmin, async (req, res, next) => {
  try {
    res.json(await store.list());
  } catch (error) {
    next(error);
  }
});

// Solo los nombres: público, lo usa la ruleta para sortear.
app.get("/api/participants", async (req, res, next) => {
  try {
    const attendees = await store.list();
    res.json(attendees.map((attendee) => attendee.name));
  } catch (error) {
    next(error);
  }
});

// Alta manual (solo admin).
app.post("/api/attendees", isAdmin, async (req, res) => {
  const { name, error: nameError } = normalizeName(req.body.name);
  if (nameError) {
    return res.status(400).json({ error: nameError });
  }
  const { dni, error: dniError } = normalizeDni(req.body.dni);
  if (dniError) {
    return res.status(400).json({ error: dniError });
  }

  const attendee = { name, dni, checkedInAt: new Date().toISOString() };

  try {
    const added = await store.add(dni, attendee);
    if (!added) {
      return res.status(409).json({ error: "Ese DNI ya está registrado." });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "No se pudo guardar la participación." });
  }

  return res.status(201).json(attendee);
});

// Baja (solo admin). Se borra por la clave real del registro (su "id"),
// que puede ser el DNI (altas nuevas) o el nombre (datos cargados antes del DNI).
app.delete("/api/attendees/:id", isAdmin, async (req, res) => {
  const key = String(req.params.id || "").trim();

  try {
    const removed = await store.remove(key);
    if (!removed) {
      return res.status(404).json({ error: "No se encontró ese participante." });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "No se pudo eliminar la participación." });
  }

  return res.json({ message: "Participante eliminado." });
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) {
    return next(error);
  }
  return res.status(500).send("Ocurrió un error interno.");
});

app.listen(port, () => {
  console.log(`Servidor listo en http://localhost:${port}`);
  console.log(`Almacenamiento: ${store.kind}`);
});
