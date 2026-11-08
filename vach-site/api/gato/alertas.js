// api/gato/alertas.js
// Alertas para el dueño del juego: guarda el celular que las recibe y manda una de prueba.
// Protegido con la misma clave que las estadísticas (STATS_TOKEN). La clave viaja en el cuerpo, nunca en la dirección.
import { Redis } from "@upstash/redis";
import webpush from "web-push";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});
const NO_STORE = { "cache-control": "no-store" };
const json = (o, status = 200) => Response.json(o, { status, headers: NO_STORE });
const PUSH_HOST = /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\//;
const B64 = /^[A-Za-z0-9_\-=]{8,200}$/;

export async function POST(req) {
  if (Number(req.headers.get("content-length") || 0) > 3000) return json({ error: "bad" }, 400);
  const ip = (req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "x").split(",")[0].trim().slice(0, 64);
  const rl = `gato:rl:alertas:${ip}`;
  const n = await redis.incr(rl);
  if (n === 1) await redis.expire(rl, 3600);
  if (n > 20) return json({ error: "slow down" }, 429);
  let b;
  try { b = await req.json(); } catch { return json({ error: "bad" }, 400); }
  if (!b || !process.env.STATS_TOKEN || b.k !== process.env.STATS_TOKEN) return json({ error: "clave" }, 401);

  if (b.sub) {
    const s = b.sub;
    if (typeof s.endpoint !== "string" || s.endpoint.length > 1000 || !PUSH_HOST.test(s.endpoint)) return json({ error: "bad" }, 400);
    if (!s.keys || !B64.test(String(s.keys.p256dh || "")) || !B64.test(String(s.keys.auth || ""))) return json({ error: "bad" }, 400);
    if (b.off) { await redis.hdel("gato:admin", s.endpoint); return json({ ok: true }); }
    await redis.hset("gato:admin", { [s.endpoint]: JSON.stringify({ endpoint: s.endpoint, keys: { p256dh: String(s.keys.p256dh), auth: String(s.keys.auth) } }) });
  }
  const subs = (await redis.hgetall("gato:admin")) || {};
  if (b.test) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://www.vach.com.ar", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const msg = JSON.stringify({ title: "Gato Encerrado: alerta de prueba", body: "Las alertas funcionan en este celular.", url: "/alertas-gato/", tag: "gato-alerta-prueba" });
    let sent = 0;
    await Promise.all(Object.entries(subs).map(async ([k, raw]) => {
      try { await webpush.sendNotification(typeof raw === "string" ? JSON.parse(raw) : raw, msg, { TTL: 3600, timeout: 8000 }); sent++; }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await redis.hdel("gato:admin", k); }
    }));
    return json({ ok: true, devices: Object.keys(subs).length, sent });
  }
  const [n75, n130, people] = await Promise.all([redis.get("gato:alerta:75:total"), redis.get("gato:alerta:130:total"), redis.pfcount("gato:uv:total")]);
  return json({ ok: true, devices: Object.keys(subs).length, n75: Number(n75) || 0, n130: Number(n130) || 0, people: Number(people) || 0 });
}
