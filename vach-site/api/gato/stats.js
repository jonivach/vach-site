// app/api/gato/stats/route.js
// Devuelve los contadores de los últimos días para el dashboard. Protegido con la clave STATS_TOKEN.
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});
const START = Date.UTC(2026, 9, 29); // desafío n.º 1
const score = (x) => (Array.isArray(x) && x.length >= 2 ? Number(x[1]) : null);

export async function GET(req) {
  const url = new URL(req.url), k = url.searchParams.get("k") || "";
  if (!process.env.STATS_TOKEN || k !== process.env.STATS_TOKEN) return new Response("no", { status: 401 });
  const days = Math.min(120, Math.max(1, Math.floor(Number(url.searchParams.get("days")) || 35)));
  const now = Date.now() - 3 * 3600e3, list = [];
  for (let i = days - 1; i >= 0; i--) list.push(new Date(now - i * 864e5).toISOString().slice(0, 10));
  const dkey = (d) => `gato:desafio:${Math.floor((Date.parse(d) - START) / 864e5) + 1}`;
  const p = redis.pipeline();
  for (const d of list) { p.hgetall(`gato:st:${d}`); p.pfcount(`gato:uv:${d}`); }
  for (const d of list) p.zcard(dkey(d));
  p.pfcount(...list.map((d) => `gato:uv:${d}`)); // personas distintas en todo el período (sin repetir entre días)
  p.hgetall("gato:tot");
  p.hlen("gato:push");
  const r = await p.exec();
  const rank = list.map((d, i) => r[list.length * 2 + i] || 0);
  // tiempos del desafío: el más rápido, el del medio y el del 90 % (en segundos)
  const q = redis.pipeline(), asked = [];
  list.forEach((d, i) => {
    const n = rank[i];
    if (!n) return;
    for (const at of [0, Math.floor((n - 1) / 2), Math.floor((n - 1) * 0.9)]) q.zrange(dkey(d), at, at, { withScores: true });
    asked.push(i);
  });
  const t = asked.length ? await q.exec() : [];
  const times = {};
  asked.forEach((i, j) => { times[i] = { best: score(t[j * 3]), median: score(t[j * 3 + 1]), slow: score(t[j * 3 + 2]) }; });
  const out = list.map((d, i) => ({ day: d, people: r[i * 2 + 1] || 0, ranking: rank[i], times: times[i] || null, counts: r[i * 2] || {} }));
  return Response.json({ generated: new Date().toISOString(), reminders: r[r.length - 1] || 0, people: r[r.length - 3] || 0, totals: r[r.length - 2] || {}, days: out }, { headers: { "cache-control": "no-store" } });
}
