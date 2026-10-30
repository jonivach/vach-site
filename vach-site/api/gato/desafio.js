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
const bad = () => Response.json({ error: "bad" }, { status: 400 });

export async function POST(req) {
  let b;
  try { b = await req.json(); } catch { return bad(); }
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
  if (!(t >= 3 && t <= 7 * 24 * 3600)) return bad();
  if (!/^[a-z0-9]{8,32}$/.test(id)) return bad();

  await redis.zadd(key, { nx: true }, { score: t, member: id }); // solo cuenta el primer tiempo de cada jugador
  const [mine, total] = await Promise.all([redis.zscore(key, id), redis.zcard(key)]);
  const slower = await redis.zcount(key, `(${mine}`, "+inf");
  await redis.expire(key, 60 * 60 * 24 * 21);
  const pct = total > 1 ? Math.round((slower / (total - 1)) * 100) : 100;
  return Response.json({ pct, total }, { headers: { "cache-control": "no-store" } });
}
