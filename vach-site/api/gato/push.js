// app/api/gato/push/route.js
// Guarda (o borra) la suscripción a recordatorios de un jugador. Sin datos personales: un código al azar y el idioma.
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});
const bad = () => Response.json({ error: "bad" }, { status: 400 });

// el juego pide la clave pública para poder suscribirse
export async function GET() {
  return Response.json({ key: process.env.VAPID_PUBLIC_KEY || "" }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req) {
  let b;
  try { b = await req.json(); } catch { return bad(); }
  const id = String(b.id || "");
  if (!/^[a-z0-9]{8,32}$/.test(id)) return bad();
  if (b.off) { await redis.hdel("gato:push", id); return Response.json({ ok: true }); }
  const sub = b.sub;
  if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return bad();
  const lang = b.lang === "en" ? "en" : "es";
  await redis.hset("gato:push", { [id]: JSON.stringify({ sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, lang }) });
  return Response.json({ ok: true });
}
