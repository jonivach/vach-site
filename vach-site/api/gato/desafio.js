// api/gato/desafio.js — Vercel Function en /api/gato/desafio
// (El sitio es HTML estático sin Next.js, así que va en /api con un export POST, sin App ni Pages Router.)
// Ranking anónimo del desafío del día de Gato Encerrado.
// Guarda solo: número de desafío, un código al azar por navegador y el tiempo en segundos. Sin nombres ni datos personales.
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});
const START = Date.UTC(2026, 9, 29); // desafío n.º 1
const bad = () => Response.json({ error: "bad" }, { status: 400 });

export async function POST(req) {
  let b;
  try { b = await req.json(); } catch { return bad(); }
  const d = Math.floor(Number(b.d)), t = Math.floor(Number(b.t)), id = String(b.id || "");
  const today = Math.floor((Date.now() - 3 * 3600e3 - START) / 864e5) + 1; // hora de Argentina
  if (!(d >= today - 1 && d <= today + 1)) return bad();
  if (!(t >= 3 && t <= 7200)) return bad();
  if (!/^[a-z0-9]{8,32}$/.test(id)) return bad();

  const key = `gato:desafio:${d}`;
  await redis.zadd(key, { nx: true }, { score: t, member: id }); // solo cuenta el primer tiempo de cada jugador
  const [mine, total] = await Promise.all([redis.zscore(key, id), redis.zcard(key)]);
  const slower = await redis.zcount(key, `(${mine}`, "+inf");
  await redis.expire(key, 60 * 60 * 24 * 14);
  const pct = total > 1 ? Math.round((slower / (total - 1)) * 100) : 100;
  return Response.json({ pct, total }, { headers: { "cache-control": "no-store" } });
}
