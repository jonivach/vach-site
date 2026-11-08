// api/web/stats.js
// Devuelve los contadores de vach.com.ar para el tablero /estadisticas. Protegido con la clave STATS_TOKEN,
// que viaja en el cuerpo del pedido (nunca en la dirección).
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});
const NO_STORE = { "cache-control": "no-store" };
const PAGES = ["/", "/merchandising/", "/laservach/", "/laservach/full-landing.html", "/vachlive/", "/sublivach/", "404",
  ...["centros-de-mesa", "charms", "envases", "fundas", "llavero-nfc", "llaveros", "objetos-a-medida", "pines", "pulseras", "reconocimientos", "revolvedores"].map((s) => `/merchandising/${s}/`)];

export async function POST(req) {
  const ip = (req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "x").split(",")[0].trim().slice(0, 64);
  const rl = `web:rl:stats:${ip}`, n = await redis.incr(rl);
  if (n === 1) await redis.expire(rl, 3600);
  if (n > 60) return Response.json({ error: "slow down" }, { status: 429, headers: NO_STORE });
  let b; try { b = await req.json(); } catch { b = null; }
  if (!b || !process.env.STATS_TOKEN || b.k !== process.env.STATS_TOKEN) return Response.json({ error: "clave" }, { status: 401, headers: NO_STORE });
  const days = Math.min(120, Math.max(1, Math.floor(Number(b.days)) || 30));
  const now = Date.now() - 3 * 3600e3, list = [];
  for (let i = days - 1; i >= 0; i--) list.push(new Date(now - i * 864e5).toISOString().slice(0, 10));
  const p = redis.pipeline();
  for (const d of list) { p.hgetall(`web:st:${d}`); p.pfcount(`web:uv:${d}`); p.pfcount(`web:wau:${d}`); p.pfcount(`gato:uv:${d}`); }
  p.pfcount(...list.map((d) => `web:uv:${d}`));
  p.pfcount(...list.map((d) => `web:wau:${d}`));
  p.pfcount(...list.map((d) => `gato:uv:${d}`));
  for (const pg of PAGES) p.pfcount(...list.map((d) => `web:pv:${d}:${pg}`));
  const r = await p.exec();
  const out = list.map((d, i) => ({ day: d, people: r[i * 4 + 1] || 0, whatsapp: r[i * 4 + 2] || 0, game: r[i * 4 + 3] || 0, counts: r[i * 4] || {} }));
  const base = list.length * 4, pagePeople = {};
  PAGES.forEach((pg, i) => { pagePeople[pg] = r[base + 3 + i] || 0; });
  return Response.json({ generated: new Date().toISOString(), people: r[base] || 0, whatsapp: r[base + 1] || 0, game: r[base + 2] || 0, pagePeople, days: out }, { headers: NO_STORE });
}
