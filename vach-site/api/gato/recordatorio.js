// app/api/gato/recordatorio/route.js
// Lo llama Vercel Cron una vez por día. Avisa solo a quienes todavía no resolvieron el desafío de hoy.
import { Redis } from "@upstash/redis";
import webpush from "web-push";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});
const START = Date.UTC(2026, 9, 29); // desafío n.º 1
const TEXT = {
  es: { title: "Tu desafío de hoy te espera", body: "Resolvelo antes de medianoche para no cortar tu racha.", url: "/gato/" },
  en: { title: "Today’s challenge is waiting", body: "Solve it before midnight to keep your streak.", url: "/gato/en/" },
};

export async function GET(req) {
  if (process.env.CRON_SECRET && req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("no", { status: 401 });
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://www.vach.com.ar", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const d = Math.floor((Date.now() - 3 * 3600e3 - START) / 864e5) + 1; // hora de Argentina
  const all = (await redis.hgetall("gato:push")) || {};
  let sent = 0, skipped = 0, removed = 0;
  for (const [id, raw] of Object.entries(all)) {
    const rec = typeof raw === "string" ? JSON.parse(raw) : raw;
    if ((await redis.zscore(`gato:desafio:${d}`, id)) !== null) { skipped++; continue; } // ya jugó hoy
    const t = TEXT[rec.lang] || TEXT.es;
    try {
      await webpush.sendNotification(rec.sub, JSON.stringify({ title: t.title, body: t.body, url: t.url, tag: "gato-desafio" }), { TTL: 6 * 3600 });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { await redis.hdel("gato:push", id); removed++; } // suscripción vencida
    }
  }
  return Response.json({ d, sent, skipped, removed });
}
