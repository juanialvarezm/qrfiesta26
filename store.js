const fs = require("node:fs");
const path = require("node:path");

// Capa de datos de participantes con una interfaz asíncrona común.
// Cada participante es { name, dni, checkedInAt } y se indexa por el DNI
// (solo dígitos) para que nadie se anote dos veces.
//
// - Si hay variables de Upstash Redis, usa Redis (persistente, externo).
// - Si no, cae a un archivo JSON local (ideal para desarrollo).

function onlyDigits(value) {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function normalizeStored(raw) {
  if (!raw || typeof raw !== "object") return null;
  const rawName = typeof raw.name === "string" ? raw.name : raw.email;
  const name = typeof rawName === "string" ? rawName.trim().replace(/\s+/g, " ") : "";
  if (!name) return null;
  const dni = onlyDigits(raw.dni);
  return { name, dni, checkedInAt: raw.checkedInAt ?? new Date().toISOString() };
}

// Clave única de un registro: el DNI si existe; si no (datos viejos), el nombre.
function keyFor(record) {
  return record.dni ? record.dni : record.name.toLowerCase();
}

function createFileStore(attendanceFile) {
  fs.mkdirSync(path.dirname(attendanceFile), { recursive: true });

  const attendees = new Map();
  if (fs.existsSync(attendanceFile)) {
    const saved = JSON.parse(fs.readFileSync(attendanceFile, "utf8"));
    if (!Array.isArray(saved)) {
      throw new Error("data/attendance.json debe contener una lista de participantes.");
    }
    for (const entry of saved) {
      const record = normalizeStored(entry);
      if (record) attendees.set(keyFor(record), record);
    }
  }

  function persist() {
    fs.writeFileSync(attendanceFile, `${JSON.stringify([...attendees.values()], null, 2)}\n`);
  }

  return {
    kind: "archivo local",
    async list() {
      return [...attendees.entries()].map(([id, record]) => ({ ...record, id }));
    },
    async count() {
      return attendees.size;
    },
    async add(key, record) {
      if (attendees.has(key)) return false;
      attendees.set(key, record);
      try {
        persist();
      } catch (error) {
        attendees.delete(key);
        throw error;
      }
      return true;
    },
    async remove(key) {
      if (!attendees.has(key)) return false;
      const removed = attendees.get(key);
      attendees.delete(key);
      try {
        persist();
      } catch (error) {
        attendees.set(key, removed);
        throw error;
      }
      return true;
    },
  };
}

function createRedisStore() {
  const { Redis } = require("@upstash/redis");
  // Cliente por defecto: al escribir serializa el objeto a JSON, y al leer con
  // hgetall devuelve un objeto parseando cada valor con try/catch (no rompe si
  // hay un dato viejo o inválido).
  const redis = Redis.fromEnv();
  const KEY = "attendees";

  // Normaliza un valor del hash a { name, dni, checkedInAt }, tolerando valores
  // ya parseados (objeto), datos viejos y datos crudos (p. ej. solo el nombre).
  function decode(value, key) {
    let raw = value;
    if (typeof value === "string") {
      try {
        raw = JSON.parse(value);
      } catch {
        raw = { name: value }; // no era JSON: lo tratamos como el nombre a secas
      }
    }
    if (!raw || typeof raw !== "object") raw = { name: String(key) };
    const record = normalizeStored(raw) || { name: String(key), dni: "", checkedInAt: null };
    // En Redis la "field" del hash es la clave (habitualmente el DNI).
    if (!record.dni && /^\d{6,}$/.test(String(key))) record.dni = String(key);
    return record;
  }

  return {
    kind: "Upstash Redis",
    async list() {
      const all = await redis.hgetall(KEY);
      if (!all) return [];
      return Object.entries(all).map(([key, value]) => ({ ...decode(value, key), id: key }));
    },
    async count() {
      return Number(await redis.hlen(KEY)) || 0;
    },
    async add(key, record) {
      const set = await redis.hsetnx(KEY, key, record);
      return Number(set) === 1;
    },
    async remove(key) {
      const removed = await redis.hdel(KEY, key);
      return Number(removed) > 0;
    },
  };
}

function createStore(attendanceFile) {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return createRedisStore();
  }
  return createFileStore(attendanceFile);
}

module.exports = { createStore, onlyDigits };
