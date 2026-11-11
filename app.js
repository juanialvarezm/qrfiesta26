require("dotenv").config();

const express = require("express");
const QRCode = require("qrcode");
const fs = require("node:fs");
const path = require("node:path");
const { timingSafeEqual } = require("node:crypto");

const app = express();
// Render (y otros PaaS) sirven detrás de un proxy HTTPS. Con esto req.protocol
// refleja "https", así el QR se genera con la URL pública correcta.
app.set("trust proxy", true);
const port = Number(process.env.PORT) || 3000;
const dataDirectory = path.join(__dirname, "data");
const attendanceFile = path.join(dataDirectory, "attendance.json");

fs.mkdirSync(dataDirectory, { recursive: true });

// Cada asistencia se guarda como { name, checkedInAt } y se indexa por el
// nombre normalizado (minúsculas) para evitar registros duplicados.
let attendees = new Map();
if (fs.existsSync(attendanceFile)) {
  const savedAttendees = JSON.parse(fs.readFileSync(attendanceFile, "utf8"));
  if (!Array.isArray(savedAttendees)) {
    throw new Error("data/attendance.json debe contener una lista de asistencias.");
  }
  for (const attendee of savedAttendees) {
    const { name } = normalizeName(attendee.name ?? attendee.email);
    if (!name) continue;
    attendees.set(name.toLowerCase(), {
      name,
      checkedInAt: attendee.checkedInAt ?? new Date().toISOString(),
    });
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/check-in", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "check-in.html"));
});

app.get("/ruleta", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "ruleta.html"));
});

function persist() {
  fs.writeFileSync(attendanceFile, `${JSON.stringify([...attendees.values()], null, 2)}\n`);
}

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
    res.json({ image, checkInUrl, count: attendees.size });
  } catch (error) {
    next(error);
  }
});

app.post("/api/attendance", (req, res) => {
  const { name, error } = normalizeName(req.body.name);
  if (error) {
    return res.status(400).json({ error });
  }

  const key = name.toLowerCase();
  if (attendees.has(key)) {
    return res.status(409).json({ error: "Ya hay una asistencia registrada con ese nombre." });
  }

  const attendee = { name, checkedInAt: new Date().toISOString() };
  attendees.set(key, attendee);

  try {
    persist();
  } catch (error) {
    attendees.delete(key);
    console.error(error);
    return res.status(500).json({ error: "No se pudo guardar la asistencia." });
  }

  return res.status(201).json({ message: "¡Asistencia confirmada!" });
});

app.get("/admin", isAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Listado público: lo usan la página de inicio y la ruleta.
app.get("/api/attendees", (req, res) => {
  res.json([...attendees.values()]);
});

// Alta manual (solo admin).
app.post("/api/attendees", isAdmin, (req, res) => {
  const { name, error } = normalizeName(req.body.name);
  if (error) {
    return res.status(400).json({ error });
  }

  const key = name.toLowerCase();
  if (attendees.has(key)) {
    return res.status(409).json({ error: "Ese nombre ya está registrado." });
  }

  const attendee = { name, checkedInAt: new Date().toISOString() };
  attendees.set(key, attendee);

  try {
    persist();
  } catch (error) {
    attendees.delete(key);
    console.error(error);
    return res.status(500).json({ error: "No se pudo guardar la asistencia." });
  }

  return res.status(201).json(attendee);
});

// Baja (solo admin).
app.delete("/api/attendees/:name", isAdmin, (req, res) => {
  const key = String(req.params.name || "").trim().replace(/\s+/g, " ").toLowerCase();

  if (!attendees.has(key)) {
    return res.status(404).json({ error: "No se encontró esa asistencia." });
  }

  const removed = attendees.get(key);
  attendees.delete(key);

  try {
    persist();
  } catch (error) {
    attendees.set(key, removed);
    console.error(error);
    return res.status(500).json({ error: "No se pudo eliminar la asistencia." });
  }

  return res.json({ message: "Asistencia eliminada." });
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
});
