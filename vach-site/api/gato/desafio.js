// app/api/gato/desafio/route.js
// Ranking anónimo de Gato Encerrado: el desafío del día (d) y el caso de la semana (w).
// Guarda solo: número de desafío o de semana, un código al azar por navegador y el tiempo en segundos.
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});
const START = Date.UTC(2026, 9, 29);      // desafío n.º 1
const WEEK_START = Date.UTC(2026, 9, 25); // caso de la semana n.º 1 (domingo)
const MAX_PLAYERS = 100000;               // tope por desafío, para que nadie pueda llenar la base
const NO_STORE = { "cache-control": "no-store" };
const bad = () => Response.json({ error: "bad" }, { status: 400, headers: NO_STORE });

// límite por IP: como mucho `max` pedidos cada `win` segundos
async function tooMany(req, name, max, win) {
  const ip = (req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "x").split(",")[0].trim().slice(0, 64);
  const k = `gato:rl:${name}:${ip}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, win);
  return n > max;
}

export async function POST(req) {
  if (Number(req.headers.get("content-length") || 0) > 1000) return bad();
  if (await tooMany(req, "desafio", 30, 600)) return Response.json({ error: "slow down" }, { status: 429, headers: NO_STORE });
  let b;
  try { b = await req.json(); } catch { return bad(); }
  if (!b || typeof b !== "object") return bad();
  const t = Math.floor(Number(b.t)), id = String(b.id || "");
  const now = Date.now() - 3 * 3600e3; // hora de Argentina
  let key;
  if (b.w !== undefined) {
    const w = Math.floor(Number(b.w)), cur = Math.floor((now - WEEK_START) / (7 * 864e5)) + 1;
    if (!(w >= cur - 1 && w <= cur + 1)) return bad();
    key = `gato:semana:${w}`;
  } else {
    const d = Math.floor(Number(b.d)), today = Math.floor((now - START) / 864e5) + 1;
    if (!(d >= today - 1 && d <= today + 1)) return bad();
    key = `gato:desafio:${d}`;
  }
  if (!(t >= 4 && t <= 7 * 24 * 3600)) return bad();
  if (!/^[a-z0-9]{16,32}$/.test(id)) return bad();

  const total0 = await redis.zcard(key);
  if (total0 < MAX_PLAYERS) await redis.zadd(key, { nx: true }, { score: t, member: id }); // solo cuenta el primer tiempo de cada jugador
  const [mine, total] = await Promise.all([redis.zscore(key, id), redis.zcard(key)]);
  if (mine === null) return Response.json({ pct: 100, total }, { headers: NO_STORE });
  const slower = await redis.zcount(key, `(${mine}`, "+inf");
  await redis.expire(key, 60 * 60 * 24 * 21);
  const pct = total > 1 ? Math.round((slower / (total - 1)) * 100) : 100;
  return Response.json({ pct, total }, { headers: NO_STORE });
}
