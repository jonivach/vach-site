// app/api/gato/push/route.js
// Guarda (o borra) la suscripción a recordatorios de un jugador. Sin datos personales: un código al azar y el idioma.
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});
const NO_STORE = { "cache-control": "no-store" };
const bad = () => Response.json({ error: "bad" }, { status: 400, headers: NO_STORE });
const MAX_SUBS = 50000;
// solo se aceptan direcciones de los servicios de notificaciones de los navegadores (Chrome, Firefox, Safari, Edge)
const PUSH_HOST = /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\//;
const B64 = /^[A-Za-z0-9_\-=]{8,200}$/;

async function tooMany(req, name, max, win) {
  const ip = (req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "x").split(",")[0].trim().slice(0, 64);
  const k = `gato:rl:${name}:${ip}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, win);
  return n > max;
}

// el juego pide la clave pública para poder suscribirse
export async function GET() {
  return Response.json({ key: process.env.VAPID_PUBLIC_KEY || "" }, { headers: NO_STORE });
}

export async function POST(req) {
  if (Number(req.headers.get("content-length") || 0) > 3000) return bad();
  if (await tooMany(req, "push", 10, 3600)) return Response.json({ error: "slow down" }, { status: 429, headers: NO_STORE });
  let b;
  try { b = await req.json(); } catch { return bad(); }
  if (!b || typeof b !== "object") return bad();
  const id = String(b.id || "");
  if (!/^[a-z0-9]{16,32}$/.test(id)) return bad();
  if (b.off) { await redis.hdel("gato:push", id); return Response.json({ ok: true }, { headers: NO_STORE }); }
  const sub = b.sub;
  if (!sub || typeof sub.endpoint !== "string" || sub.endpoint.length > 1000 || !PUSH_HOST.test(sub.endpoint)) return bad();
  if (!sub.keys || !B64.test(String(sub.keys.p256dh || "")) || !B64.test(String(sub.keys.auth || ""))) return bad();
  if ((await redis.hlen("gato:push")) >= MAX_SUBS && !(await redis.hexists("gato:push", id))) return bad();
  const lang = b.lang === "en" ? "en" : "es";
  await redis.hset("gato:push", { [id]: JSON.stringify({ sub: { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } }, lang }) });
  return Response.json({ ok: true }, { headers: NO_STORE });
}
