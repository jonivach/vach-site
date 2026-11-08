// app/api/gato/recordatorio/route.js
// Lo llama Vercel Cron una vez por día. Avisa solo a quienes todavía no resolvieron el desafío de hoy.
import { Redis } from "@upstash/redis";
import webpush from "web-push";

export const maxDuration = 60;
const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});
const START = Date.UTC(2026, 9, 29); // desafío n.º 1
const PUSH_HOST = /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\//;
const TEXT = {
  es: { title: "Tu desafío de hoy te espera", body: "Resolvelo antes de medianoche para no cortar tu racha.", url: "/gato/" },
  en: { title: "Today’s challenge is waiting", body: "Solve it before midnight to keep your streak.", url: "/gato/en/" },
};

export async function GET(req) {
  // sin la clave secreta no se manda nada (si falta en Vercel, el aviso queda apagado en vez de abierto a cualquiera)
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("no", { status: 401 });
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://www.vach.com.ar", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const d = Math.floor((Date.now() - 3 * 3600e3 - START) / 864e5) + 1; // hora de Argentina
  const all = (await redis.hgetall("gato:push")) || {};
  const played = new Set((await redis.zrange(`gato:desafio:${d}`, 0, -1)) || []);
  let sent = 0, skipped = 0, removed = 0;
  const jobs = [], seen = new Set(); // un aviso por dispositivo aunque esté guardado dos veces
  for (const [id, raw] of Object.entries(all)) {
    let rec; try { rec = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { continue; }
    if (!rec || !rec.sub || !PUSH_HOST.test(String(rec.sub.endpoint))) { await redis.hdel("gato:push", id); removed++; continue; }
    if (played.has(id)) { skipped++; continue; } // ya jugó hoy
    if (seen.has(rec.sub.endpoint)) { await redis.hdel("gato:push", id); removed++; continue; } // repetido: se queda uno solo
    seen.add(rec.sub.endpoint);
    const t = TEXT[rec.lang] || TEXT.es;
    jobs.push(async () => {
      try { await webpush.sendNotification(rec.sub, JSON.stringify({ title: t.title, body: t.body, url: t.url, tag: "gato-desafio" }), { TTL: 6 * 3600, timeout: 8000 }); sent++; }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { await redis.hdel("gato:push", id); removed++; } } // suscripción vencida
    });
  }
  for (let i = 0; i < jobs.length; i += 50) await Promise.all(jobs.slice(i, i + 50).map(f => f())); // de a 50 a la vez
  // constancia de que salió hoy (la usan las alertas de /alertas-gato para avisar si un día no sale)
  const dia = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  await redis.set("gato:recordatorio:ultimo", JSON.stringify({ dia, sent, skipped, removed, fallaron: jobs.length - sent }), { ex: 60 * 60 * 24 * 30 });
  return Response.json({ d, sent, skipped, removed });
}
