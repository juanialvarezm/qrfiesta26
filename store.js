const fs = require("node:fs");
const path = require("node:path");

// Capa de datos de asistencias con una interfaz asíncrona común.
// Cada asistencia es { name, checkedInAt } y se indexa por el nombre en
// minúsculas (la "key") para evitar duplicados.
//
// - Si hay variables de Upstash Redis, usa Redis (persistente, externo).
// - Si no, cae a un archivo JSON local (ideal para desarrollo).

function normalizeStored(raw) {
  const value = typeof raw?.name === "string" ? raw.name : raw?.email;
  if (typeof value !== "string" || !value.trim()) return null;
  const name = value.trim().replace(/\s+/g, " ");
  return { name, checkedInAt: raw.checkedInAt ?? new Date().toISOString() };
}

function createFileStore(attendanceFile) {
  fs.mkdirSync(path.dirname(attendanceFile), { recursive: true });

  const attendees = new Map();
  if (fs.existsSync(attendanceFile)) {
    const saved = JSON.parse(fs.readFileSync(attendanceFile, "utf8"));
    if (!Array.isArray(saved)) {
      throw new Error("data/attendance.json debe contener una lista de asistencias.");
    }
    for (const entry of saved) {
      const record = normalizeStored(entry);
      if (record) attendees.set(record.name.toLowerCase(), record);
    }
  }

  function persist() {
    fs.writeFileSync(attendanceFile, `${JSON.stringify([...attendees.values()], null, 2)}\n`);
  }

  return {
    kind: "archivo local",
    async list() {
      return [...attendees.values()];
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
  // Guardamos y leemos JSON explícito para evitar ambigüedades del cliente.
  const redis = Redis.fromEnv({ automaticDeserialization: false });
  const KEY = "attendees";

  return {
    kind: "Upstash Redis",
    async list() {
      const all = await redis.hgetall(KEY);
      if (!all) return [];
      return Object.values(all).map((value) =>
        typeof value === "string" ? JSON.parse(value) : value
      );
    },
    async count() {
      return await redis.hlen(KEY);
    },
    async add(key, record) {
      const set = await redis.hsetnx(KEY, key, JSON.stringify(record));
      return set === 1 || set === true;
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

module.exports = { createStore };
