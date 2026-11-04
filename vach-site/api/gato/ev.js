// app/api/gato/ev/route.js
// Contadores anónimos de uso de Gato Encerrado. Solo suma totales por día (cuántas veces pasó cada cosa);
// no guarda quién hizo qué. El código al azar del navegador se usa solo para estimar cuántas personas distintas
// jugaron cada día (HyperLogLog: no se puede leer de vuelta ningún código).
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});
const NO_STORE = { "cache-control": "no-store" };
const ok = () => new Response(null, { status: 204, headers: NO_STORE });
const DAY = 864e5, KEEP = 60 * 60 * 24 * 400; // se guardan 400 días

// eventos que se cuentan (los demás se ignoran)
const EXACT = new Set(["visita","bienvenida","empieza","gana","pista","sale","error","sin-vidas","desafio-empieza","desafio-gana","desafio-pista","desafio-error","desafio-sin-vidas",
  "semana-empieza","semana-gana","semana-pista","semana-error","semana-sin-vidas","anterior-empieza","anterior-gana","misiones-completas","protector-usado",
  "instalar-toca","instalar-tarjeta-6","instalada","abre-app","recordatorio-toca","recordatorio-activa","comparte-nivel","comparte-desafio","comparte-semana","comparte-etapa","comparte-imagen"]);
const PATTERN = /^(mision-[a-z]{2,12}|racha-\d{1,3}|etapa-[1-7]|link-[a-z]{2,12})$/;
const SOURCES = new Set(["instagram","tiktok","whatsapp","facebook","x","otro","directo"]);

export async function POST(req) {
  if (Number(req.headers.get("content-length") || 0) > 4000) return ok();
  const ip = (req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "x").split(",")[0].trim().slice(0, 64);
  const rl = `gato:rl:ev:${ip}`;
  const n = await redis.incr(rl);
  if (n === 1) await redis.expire(rl, 600);
  if (n > 120) return ok();
  let b;
  try { b = JSON.parse(await req.text()); } catch { return ok(); }
  if (!b || !Array.isArray(b.ev)) return ok();
  const day = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // fecha de Argentina
  const lang = b.l === "en" ? "en" : "es";
  const add = {};
  for (const item of b.ev.slice(0, 60)) {
    if (!Array.isArray(item)) continue;
    const e = String(item[0] || ""), lv = Math.floor(Number(item[1]) || 0);
    if (!EXACT.has(e) && !PATTERN.test(e)) continue;
    if (lv > 150 || lv < 0) continue;
    let f = e;
    if (e === "visita") f = "visita:" + (SOURCES.has(String(item[2])) ? String(item[2]) : "otro") + ":" + lang;
    else if (lv >= 1 && lv <= 150) f = e + ":" + lv;
    add[f] = (add[f] || 0) + 1;
  }
  const fields = Object.keys(add);
  if (!fields.length) return ok();
  const key = `gato:st:${day}`, p = redis.pipeline();
  for (const f of fields) p.hincrby(key, f, add[f]);
  p.expire(key, KEEP);
  const u = String(b.u || "");
  if (/^[a-z0-9]{16,32}$/.test(u)) { p.pfadd(`gato:uv:${day}`, u); p.expire(`gato:uv:${day}`, KEEP); }
  await p.exec();
  return ok();
}
