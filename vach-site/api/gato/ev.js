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
const ALERTAS = { 75: "nivel 75", 130: "nivel 130", 200: "nivel 200" }; // alguien gana por primera vez estos niveles
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
  const fin = Number(lv) === 200;
  await avisar(fin ? "Gato Encerrado: ¡alguien lo terminó!" : `Gato Encerrado: ${ALERTAS[lv]}`,
    `${fin ? "Alguien acaba de ganar el nivel 200 y terminó el juego." : `Alguien acaba de ganar el ${ALERTAS[lv]}.`} ${total === 1 ? "Es el primero en llegar." : `Ya son ${total} jugadores.`}`, `gato-alerta-${lv}-${total}`);
}
// total histórico de personas distintas: la primera vez se arma juntando los días anteriores
let totalListo = false;
async function personasTotal() {
  if (totalListo) return;
  if (!(await redis.exists("gato:uv:total"))) {
    const dias = []; for (let t = STATS_DESDE; t <= Date.now(); t += 864e5) dias.push(`gato:uv:${new Date(t).toISOString().slice(0, 10)}`);
    await redis.pfmerge("gato:uv:total", ...dias);
    const n = await redis.pfcount("gato:uv:total");
    for (const h of HITOS) if (n >= h) await redis.set(`gato:hito:${h}`, 1, { nx: true }); // los ya superados no avisan
  }
  totalListo = true;
}
async function alertarHitos(u) {
  await personasTotal();
  if (!(await redis.pfadd("gato:uv:total", u))) return; // ya estaba contada
  const n = await redis.pfcount("gato:uv:total");
  for (const h of HITOS) if (n >= h && (await redis.set(`gato:hito:${h}`, 1, { nx: true })))
    await avisar(`Gato Encerrado: ${h} personas`, `Ya son ${h} personas las que jugaron Gato Encerrado.`, `gato-hito-${h}`);
}

// récord de personas en un día: avisa una sola vez por día, cuando hoy supera al mejor día anterior
const RECORD_MINIMO = 10; // no avisa récords chicos
async function alertarRecord(day) {
  if (!(await redis.exists("gato:record:max"))) {
    let max = 0; for (let t = STATS_DESDE; t < Date.parse(day); t += 864e5) max = Math.max(max, Number(await redis.pfcount(`gato:uv:${new Date(t).toISOString().slice(0, 10)}`)) || 0);
    await redis.set("gato:record:max", max, { nx: true });
  }
  await redis.set(`gato:record:base:${day}`, Number(await redis.get("gato:record:max")) || 0, { nx: true, ex: 3 * 86400 }); // el récord con el que arrancó el día
  const base = Number(await redis.get(`gato:record:base:${day}`)) || 0, hoy = Number(await redis.pfcount(`gato:uv:${day}`)) || 0;
  if (hoy > (Number(await redis.get("gato:record:max")) || 0)) await redis.set("gato:record:max", hoy);
  if (hoy > base && hoy >= RECORD_MINIMO && (await redis.set(`gato:record:aviso:${day}`, 1, { nx: true, ex: 3 * 86400 })))
    await avisar("Gato Encerrado: récord de personas", `Hoy ya jugaron ${hoy} personas, más que en cualquier día anterior (el récord era ${base}).`, `gato-record-${day}`);
}
// apoyo: alguien tocó "Apoyá al gato" (abre Cafecito; no confirma que haya aportado)
async function alertarApoyo(u, day) {
  if (!(await redis.set(`gato:alerta:apoyo:${day}:${u}`, 1, { nx: true, ex: 2 * 86400 }))) return; // una vez por persona por día
  const total = await redis.incr("gato:alerta:apoyo:total");
  await avisar("Gato Encerrado: alguien tocó Apoyar", `Alguien abrió el link de Cafecito para apoyar al gato. Ya van ${total} ${total === 1 ? "vez" : "veces"}.`, `gato-apoyo-${total}`);
}
// recordatorio diario: avisa si a las 21 h de Argentina todavía no salió, o si salió pero no le llegó a nadie
let recordatorioVisto = "";
async function alertarRecordatorio(day) {
  if (recordatorioVisto === day || new Date(Date.now() - 3 * 3600e3).getUTCHours() < 21) return;
  if (!(await redis.hlen("gato:push"))) return; // nadie lo tiene activado
  const raw = await redis.get("gato:recordatorio:ultimo");
  const u = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
  let problema = null;
  if (!u || u.dia !== day) problema = "El recordatorio diario de hoy no salió. Revisá Cron Jobs en Vercel.";
  else if (u.fallaron > 0 && !u.sent) problema = `El recordatorio de hoy salió, pero fallaron los ${u.fallaron} envíos.`;
  recordatorioVisto = day; // ya revisado hoy en esta instancia
  if (problema && (await redis.set(`gato:alerta:recordatorio:${day}`, 1, { nx: true, ex: 3 * 86400 })))
    await avisar("Gato Encerrado: problema con el recordatorio", problema, `gato-recordatorio-${day}`);
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
  const iUv = fields.length + 1 + fields.filter((f) => TOTALS.has(f)).length; // posición del pfadd en el pipeline
  if (/^[a-z0-9]{16,32}$/.test(u)) { p.pfadd(`gato:uv:${day}`, u); p.expire(`gato:uv:${day}`, KEEP); }
  const res = await p.exec();
  const nuevoHoy = Number(res[iUv]) === 1; // primera vez que juega hoy
  if (/^[a-z0-9]{16,32}$/.test(u)) {
    for (const lv of Object.keys(ALERTAS)) if (add["gana:" + lv]) { try { await alertarNivel(lv, u); } catch {} }
    if (nuevoHoy) { try { await alertarHitos(u); } catch {} try { await alertarRecord(day); } catch {} } // solo cuando aparece alguien nuevo hoy
    if (add["link-apoyo"]) { try { await alertarApoyo(u, day); } catch {} }
  }
  try { await alertarRecordatorio(day); } catch {}
  return ok();
}
