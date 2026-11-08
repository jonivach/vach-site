// app/api/gato/inicio/route.js
// Anota la primera vez que un jugador abre el desafío del día (d) o el caso de la semana (w).
// Con esa hora el servidor mide el tiempo del ranking: nadie puede mandar un tiempo inventado
// ni mirar el tablero, salir y volver a empezar con el reloj en cero.
// Guarda solo: número de desafío o de semana, el código al azar del navegador y la hora de inicio.
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});
const START = Date.UTC(2026, 9, 29);      // desafío n.º 1
const WEEK_START = Date.UTC(2026, 9, 25); // caso de la semana n.º 1 (domingo)
const NO_STORE = { "cache-control": "no-store" };
const bad = () => Response.json({ error: "bad" }, { status: 400, headers: NO_STORE });

async function tooMany(req, name, max, win) {
  const ip = (req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "x").split(",")[0].trim().slice(0, 64);
  const k = `gato:rl:${name}:${ip}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, win);
  return n > max;
}

export async function POST(req) {
  if (Number(req.headers.get("content-length") || 0) > 500) return bad();
  if (await tooMany(req, "inicio", 30, 600)) return Response.json({ error: "slow down" }, { status: 429, headers: NO_STORE });
  let b;
  try { b = await req.json(); } catch { return bad(); }
  if (!b || typeof b !== "object") return bad();
  const id = String(b.id || "");
  if (!/^[a-z0-9]{16,32}$/.test(id)) return bad();
  const now = Date.now() - 3 * 3600e3; // hora de Argentina
  let key, ttl;
  if (b.w !== undefined) {
    const w = Math.floor(Number(b.w)), cur = Math.floor((now - WEEK_START) / (7 * 864e5)) + 1;
    if (!(w >= cur - 1 && w <= cur + 1)) return bad();
    key = `gato:t0:semana:${w}:${id}`; ttl = 60 * 60 * 24 * 21;
  } else {
    const d = Math.floor(Number(b.d)), today = Math.floor((now - START) / 864e5) + 1;
    if (!(d >= today - 1 && d <= today + 1)) return bad();
    key = `gato:t0:desafio:${d}:${id}`; ttl = 60 * 60 * 24 * 3;
  }
  await redis.set(key, Date.now(), { nx: true, ex: ttl }); // solo cuenta la primera vez que lo abre
  return Response.json({ ok: true }, { headers: NO_STORE });
}
