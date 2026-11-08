// api/web/ev.js
// Contadores anónimos de vach.com.ar: solo suma totales por día (cuántas veces pasó cada cosa en cada página).
// No guarda quién hizo qué. El código al azar del navegador se usa solo para contar personas distintas
// (HyperLogLog: no se puede leer de vuelta ningún código).
import { Redis } from "@upstash/redis";
import webpush from "web-push";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});
const ok = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
const KEEP = 60 * 60 * 24 * 400; // se guardan 400 días

// páginas que se cuentan (las demás se ignoran)
const PAGES = new Set(["/", "404", "/merchandising/", "/laservach/", "/laservach/full-landing.html", "/vachlive/", "/sublivach/", "/gato/", "/gato/en/",
  ...["centros-de-mesa", "charms", "envases", "fundas", "llavero-nfc", "llaveros", "objetos-a-medida", "pines", "pulseras", "reconocimientos", "revolvedores"].map((s) => `/merchandising/${s}/`)]);
const SOURCES = new Set(["instagram", "tiktok", "facebook", "whatsapp", "google", "buscador", "juego", "directo", "otro"]);
const CLICKS = new Set(["wa", "ig", "tt", "mail", "tel"]);

// alerta al celular del dueño cuando alguien toca WhatsApp (una vez por persona por día; usa los celulares de /alertas-gato)
const ALERTAS_POR_DIA = 30;
async function alertarWhatsapp(page, src, u, day) {
  if (!(await redis.set(`web:alerta:wa:${day}:${u}`, 1, { nx: true, ex: 2 * 86400 }))) return;
  const hoy = await redis.incr("gato:alerta:hoy"); if (hoy === 1) await redis.expire("gato:alerta:hoy", 86400);
  if (hoy > ALERTAS_POR_DIA) return;
  const subs = (await redis.hgetall("gato:admin")) || {};
  if (!Object.keys(subs).length || !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://www.vach.com.ar", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const nombre = page === "/" ? "la home" : page.replace(/^\/|\/$/g, "").replace(/\//g, " › ");
  const msg = JSON.stringify({ title: "VACH*: alguien tocó WhatsApp", body: `Desde ${nombre} (llegó por ${src}). Fijate si te escribió.`, url: "/estadisticas/", tag: `web-wa-${day}-${u.slice(0, 6)}` });
  await Promise.all(Object.entries(subs).map(async ([k, raw]) => {
    try { await webpush.sendNotification(typeof raw === "string" ? JSON.parse(raw) : raw, msg, { TTL: 24 * 3600, timeout: 8000 }); }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await redis.hdel("gato:admin", k); }
  }));
}

export async function POST(req) {
  if (Number(req.headers.get("content-length") || 0) > 4000) return ok();
  const ip = (req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "x").split(",")[0].trim().slice(0, 64);
  const rl = `web:rl:ev:${ip}`;
  const n = await redis.incr(rl);
  if (n === 1) await redis.expire(rl, 600);
  if (n > 120) return ok();
  let b;
  try { b = JSON.parse(await req.text()); } catch { return ok(); }
  if (!b || !Array.isArray(b.ev)) return ok();
  const page = String(b.p || ""), src = SOURCES.has(String(b.s)) ? String(b.s) : "otro", dev = b.m ? "m" : "d", u = String(b.u || "");
  if (!PAGES.has(page) || !/^[a-z0-9]{16,32}$/.test(u)) return ok();
  const day = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // fecha de Argentina
  const add = {}, inc = (f) => { add[f] = (add[f] || 0) + 1; };
  let wa = false;
  for (const item of b.ev.slice(0, 30)) {
    if (!Array.isArray(item)) continue;
    const e = String(item[0] || ""), x = String(item[1] || "");
    if (e === "visita") { inc(`v:${page}`); inc(`src:${src}`); inc(`dev:${dev}`); if (b.j) inc("jugador"); }
    else if (CLICKS.has(e)) { inc(`${e}:${page}`); inc(`${e}-src:${src}`); if (e === "wa") { wa = true; if (b.j) inc("wa-jugador"); } }
    else if (e === "nav" && PAGES.has(x) && x !== page) inc(`nav:${page}>${x}`);
    else if (e === "tiempo" && /^[a-e]$/.test(x)) inc(`t:${page}:${x}`);
    else if (e === "scroll" && /^(25|50|75|100)$/.test(x)) inc(`sc:${page}:${x}`);
  }
  const fields = Object.keys(add);
  if (!fields.length) return ok();
  const key = `web:st:${day}`, p = redis.pipeline();
  for (const f of fields) p.hincrby(key, f, add[f]);
  p.expire(key, KEEP);
  p.pfadd(`web:uv:${day}`, u); p.expire(`web:uv:${day}`, KEEP);
  if (add[`v:${page}`]) { p.pfadd(`web:pv:${day}:${page}`, u); p.expire(`web:pv:${day}:${page}`, KEEP); } // personas por página
  if (wa) { p.pfadd(`web:wau:${day}`, u); p.expire(`web:wau:${day}`, KEEP); }                            // personas que tocaron WhatsApp
  await p.exec();
  if (wa) { try { await alertarWhatsapp(page, src, u, day); } catch {} }
  return ok();
}
