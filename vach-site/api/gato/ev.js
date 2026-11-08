// app/api/gato/ev/route.js
// Contadores anónimos de uso de Gato Encerrado. Solo suma totales por día (cuántas veces pasó cada cosa);
// no guarda quién hizo qué. El código al azar del navegador se usa solo para estimar cuántas personas distintas
// jugaron cada día (HyperLogLog: no se puede leer de vuelta ningún código).
import { Redis } from "@upstash/redis";
import webpush from "web-push";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});
const NO_STORE = { "cache-control": "no-store" };
const ok = () => new Response(null, { status: 204, headers: NO_STORE });
const DAY = 864e5, KEEP = 60 * 60 * 24 * 400; // se guardan 400 días

// eventos que se cuentan (los demás se ignoran)
const EXACT = new Set(["visita","opinion-ve","bienvenida","empieza","gana","pista","sale","error","sin-vidas","desafio-empieza","desafio-gana","desafio-pista","desafio-error","desafio-sin-vidas",
  "semana-empieza","semana-gana","semana-pista","semana-error","semana-sin-vidas","anterior-empieza","anterior-gana","misiones-completas","protector-usado",
  "instalar-toca","instalar-tarjeta-6","instalar-tarjeta-5","recordatorio-ve","instalada","abre-app","app-instalada","app-instalada-guiada","instalar-pide","recordatorio-toca","recordatorio-activa","comparte-nivel","comparte-desafio","comparte-semana","comparte-etapa","comparte-imagen"]);
const PATTERN = /^(mision-[a-z]{2,12}|racha-\d{1,3}|etapa-[1-8]|link-[a-z]{2,12}|tiempo-[a-e]|estrellas-[1-3]|retorno-(?:0|1|2|7|14|30|x))$/;
// estos además se suman a un total histórico (sin vencimiento): cada celular los manda una sola vez
const TOTALS = new Set(["app-instalada","app-instalada-guiada","instalar-pide"]);
const SOURCES = new Set(["instagram","tiktok","whatsapp","facebook","x","otro","directo"]);

// alertas para el dueño del juego (se activan en /alertas-gato/)
const ALERTAS = { 75: "nivel 75", 130: "nivel 130" }; // alguien gana por primera vez estos niveles
const HITOS = [200, 250, 750, 1000];                  // personas distintas que jugaron, desde siempre
const ALERTAS_POR_DIA = 30;                           // tope, por si alguien manda eventos falsos
const STATS_DESDE = Date.UTC(2026, 10, 4);            // primer día con estadísticas
async function avisar(title, body, tag) {
  const hoy = await redis.incr("gato:alerta:hoy"); if (hoy === 1) await redis.expire("gato:alerta:hoy", 86400);
  if (hoy > ALERTAS_POR_DIA) return;
  const subs = (await redis.hgetall("gato:admin")) || {};
  if (!Object.keys(subs).length || !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://www.vach.com.ar", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const msg = JSON.stringify({ title, body, url: "/alertas-gato/", tag });
  await Promise.all(Object.entries(subs).map(async ([k, raw]) => {
    try { await webpush.sendNotification(typeof raw === "string" ? JSON.parse(raw) : raw, msg, { TTL: 24 * 3600, timeout: 8000 }); }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await redis.hdel("gato:admin", k); }
  }));
}
async function alertarNivel(lv, u) {
  if (!(await redis.set(`gato:alerta:${lv}:${u}`, 1, { nx: true, ex: 60 * 60 * 24 * 400 }))) return; // una vez por jugador
  const total = await redis.incr(`gato:alerta:${lv}:total`);
  await avisar(`Gato Encerrado: ${ALERTAS[lv]}`, `Alguien acaba de ganar el ${ALERTAS[lv]}. ${total === 1 ? "Es el primero en llegar." : `Ya son ${total} jugadores.`}`, `gato-alerta-${lv}-${total}`);
}
// total histórico de personas distintas: la primera vez se arma juntando los días anteriores
async function personasTotal() {
  if (!(await redis.exists("gato:uv:total"))) {
    const dias = []; for (let t = STATS_DESDE; t <= Date.now(); t += 864e5) dias.push(`gato:uv:${new Date(t).toISOString().slice(0, 10)}`);
    await redis.pfmerge("gato:uv:total", ...dias);
    const n = await redis.pfcount("gato:uv:total");
    for (const h of HITOS) if (n >= h) await redis.set(`gato:hito:${h}`, 1, { nx: true }); // los ya superados no avisan
  }
}
async function alertarHitos(u) {
  await personasTotal();
  if (!(await redis.pfadd("gato:uv:total", u))) return; // ya estaba contada
  const n = await redis.pfcount("gato:uv:total");
  for (const h of HITOS) if (n >= h && (await redis.set(`gato:hito:${h}`, 1, { nx: true })))
    await avisar(`Gato Encerrado: ${h} personas`, `Ya son ${h} personas las que jugaron Gato Encerrado.`, `gato-hito-${h}`);
}

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
    if (lv > 200 || lv < 0) continue;
    let f = e;
    if (e === "visita") f = "visita:" + (SOURCES.has(String(item[2])) ? String(item[2]) : "otro") + ":" + lang;
    else if (lv >= 1 && lv <= 200) f = e + ":" + lv;
    add[f] = (add[f] || 0) + 1;
  }
  const fields = Object.keys(add);
  if (!fields.length) return ok();
  const key = `gato:st:${day}`, p = redis.pipeline();
  for (const f of fields) p.hincrby(key, f, add[f]);
  p.expire(key, KEEP);
  for (const f of fields) if (TOTALS.has(f)) p.hincrby("gato:tot", f, add[f]);
  const u = String(b.u || "");
  if (/^[a-z0-9]{16,32}$/.test(u)) { p.pfadd(`gato:uv:${day}`, u); p.expire(`gato:uv:${day}`, KEEP); }
  await p.exec();
  if (/^[a-z0-9]{16,32}$/.test(u)) {
    for (const lv of Object.keys(ALERTAS)) if (add["gana:" + lv]) { try { await alertarNivel(lv, u); } catch {} }
    try { await alertarHitos(u); } catch {}
  }
  return ok();
}
