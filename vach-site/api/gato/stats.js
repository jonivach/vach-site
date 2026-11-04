// app/api/gato/stats/route.js
// Devuelve los contadores de los últimos días para el dashboard. Protegido con la clave STATS_TOKEN.
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});
const START = Date.UTC(2026, 9, 29); // desafío n.º 1

export async function GET(req) {
  const url = new URL(req.url), k = url.searchParams.get("k") || "";
  if (!process.env.STATS_TOKEN || k !== process.env.STATS_TOKEN) return new Response("no", { status: 401 });
  const days = Math.min(120, Math.max(1, Math.floor(Number(url.searchParams.get("days")) || 35)));
  const now = Date.now() - 3 * 3600e3, list = [];
  for (let i = days - 1; i >= 0; i--) list.push(new Date(now - i * 864e5).toISOString().slice(0, 10));
  const p = redis.pipeline();
  for (const d of list) { p.hgetall(`gato:st:${d}`); p.pfcount(`gato:uv:${d}`); }
  for (const d of list) p.zcard(`gato:desafio:${Math.floor((Date.parse(d) - START) / 864e5) + 1}`);
  p.hlen("gato:push");
  const r = await p.exec();
  const out = list.map((d, i) => ({ day: d, people: r[i * 2 + 1] || 0, ranking: r[list.length * 2 + i] || 0, counts: r[i * 2] || {} }));
  return Response.json({ generated: new Date().toISOString(), reminders: r[r.length - 1] || 0, days: out }, { headers: { "cache-control": "no-store" } });
}
