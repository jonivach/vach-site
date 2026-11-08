// app/api/gato/desafio/route.js
// Ranking anónimo de Gato Encerrado: el desafío del día (d) y el caso de la semana (w).
// Guarda solo: número de desafío o de semana, un código al azar por navegador y el tiempo en segundos.
//
// Para entrar al ranking el servidor verifica la partida:
//  1. La respuesta: el juego manda dónde puso los peces (f) y a qué gatos acusó (a), y el servidor
//     la controla contra el tablero del día (lo lee de /gato/index.html, así nunca queda desactualizado).
//  2. El tiempo: en el desafío del día se cuenta desde que el jugador lo abrió (/api/gato/inicio),
//     aunque salga y vuelva. En el caso de la semana se usa el reloj del juego, pero no puede ser
//     mayor al tiempo real desde que lo abrió.
//  3. Un tiempo mínimo creíble según el tamaño del tablero.
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});
const START = Date.UTC(2026, 9, 29);      // desafío n.º 1
const WEEK_START = Date.UTC(2026, 9, 25); // caso de la semana n.º 1 (domingo)
const MAX_PLAYERS = 100000;               // tope por desafío, para que nadie pueda llenar la base
// Mientras el juego publicado no mande la respuesta (f y a), se aceptan tiempos sin verificar.
// Cuando esté publicada la versión del juego que la manda, poner en false.
const ACEPTAR_SIN_VERIFICAR = true;
const MIN_SEC = { 3: 5, 4: 8, 5: 13, 6: 20, 7: 30 }; // menos que esto no es humano
const NO_STORE = { "cache-control": "no-store" };
const bad = (error = "bad") => Response.json({ error }, { status: 400, headers: NO_STORE });
const DIRS = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] };
const OPP = { N: "S", S: "N", E: "W", W: "E", NE: "SW", SW: "NE", NW: "SE", SE: "NW" };

// límite por IP: como mucho `max` pedidos cada `win` segundos
async function tooMany(req, name, max, win) {
  const ip = (req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "x").split(",")[0].trim().slice(0, 64);
  const k = `gato:rl:${name}:${ip}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, win);
  return n > max;
}

// tableros del desafío y del caso de la semana, leídos del juego publicado (se guardan 10 minutos)
let PUZ = null, PUZ_AT = 0;
async function puzzles(origin) {
  if (PUZ && Date.now() - PUZ_AT < 600e3) return PUZ;
  const html = await (await fetch(origin + "/gato/index.html", { cache: "no-store" })).text();
  const grab = (name) => JSON.parse(html.match(new RegExp("const " + name + "=(\\[.*?\\]);\\n", "s"))[1]);
  PUZ = { daily: grab("DAILY"), weekly: grab("WEEKLY") };
  PUZ_AT = Date.now();
  return PUZ;
}

// misma regla que usa el juego para dar por ganada una partida
function solved(L, f, a) {
  const N = L.n * L.n, walls = new Set(L.walls || []);
  if (!Array.isArray(f) || !Array.isArray(a) || f.length !== L.k || a.length > 2) return false;
  const fish = new Set(f.map(Number)), acc = new Set(a.map(Number));
  if (fish.size !== L.k || acc.size !== a.length) return false;
  const ray = (x, y, d) => { const r = []; let p = x + DIRS[d][0], q = y + DIRS[d][1]; while (p >= 0 && q >= 0 && p < L.n && q < L.n) { const j = q * L.n + p; if (walls.has(j)) break; r.push(j); p += DIRS[d][0]; q += DIRS[d][1]; } return r; };
  const cats = L.cats.map(([x, y, d, v, cr, kind]) => { const sleep = kind === "z", two = kind === "2"; return { i: y * L.n + x, v: sleep ? 0 : v, crown: !!cr, r: sleep ? [] : ray(x, y, d).concat(two ? ray(x, y, OPP[d]) : []) }; });
  const catCells = new Set(cats.map((c) => c.i));
  for (const j of fish) if (!Number.isInteger(j) || j < 0 || j >= N || walls.has(j) || catCells.has(j)) return false;
  for (const ci of acc) if (!Number.isInteger(ci) || ci < 0 || ci >= cats.length) return false;
  const wrong = []; cats.forEach((c, ci) => { if (c.r.filter((j) => fish.has(j)).length !== c.v) wrong.push(ci); });
  if (!L.L) return wrong.length === 0 && acc.size === 0;
  if (wrong.some((ci) => cats[ci].crown) || wrong.length !== L.L || acc.size !== L.L) return false;
  return wrong.every((ci) => acc.has(ci));
}

export async function POST(req) {
  if (Number(req.headers.get("content-length") || 0) > 1000) return bad();
  if (await tooMany(req, "desafio", 30, 600)) return Response.json({ error: "slow down" }, { status: 429, headers: NO_STORE });
  let b;
  try { b = await req.json(); } catch { return bad(); }
  if (!b || typeof b !== "object") return bad();
  let t = Math.floor(Number(b.t));
  const id = String(b.id || "");
  const now = Date.now() - 3 * 3600e3; // hora de Argentina
  const weekly = b.w !== undefined;
  let key, n;
  if (weekly) {
    n = Math.floor(Number(b.w)); const cur = Math.floor((now - WEEK_START) / (7 * 864e5)) + 1;
    if (!(n >= cur - 1 && n <= cur + 1)) return bad();
    key = `gato:semana:${n}`;
  } else {
    n = Math.floor(Number(b.d)); const today = Math.floor((now - START) / 864e5) + 1;
    if (!(n >= today - 1 && n <= today + 1)) return bad();
    key = `gato:desafio:${n}`;
  }
  if (!(t >= 4 && t <= 7 * 24 * 3600)) return bad();
  if (!/^[a-z0-9]{16,32}$/.test(id)) return bad();

  const verified = Array.isArray(b.f);
  let store = verified || ACEPTAR_SIN_VERIFICAR;
  if (verified) {
    let P;
    try { P = await puzzles(new URL(req.url).origin); } catch { return Response.json({ error: "later" }, { status: 503, headers: NO_STORE }); }
    const list = weekly ? P.weekly : P.daily, L = list[(((n - 1) % list.length) + list.length) % list.length];
    if (!solved(L, b.f, b.a || [])) return bad("wrong");
    const t0 = Number(await redis.get(`gato:t0:${weekly ? "semana" : "desafio"}:${n}:${id}`));
    if (!t0) return bad("nostart");
    const real = Math.max(0, Math.floor((Date.now() - t0) / 1000));
    if (weekly) { if (t > real + 60) t = real; }   // reloj del juego, pero nunca más que el tiempo real
    else t = Math.max(real, t);                    // desafío del día: desde que lo abrió (más las penalidades)
    if (t < (MIN_SEC[L.n] || 5)) return bad("fast");
  }

  if (store) {
    const total0 = await redis.zcard(key);
    if (total0 < MAX_PLAYERS) await redis.zadd(key, { nx: true }, { score: t, member: id }); // solo cuenta el primer tiempo de cada jugador
  }
  const [mine, total] = await Promise.all([redis.zscore(key, id), redis.zcard(key)]);
  if (mine === null) {
    // sin verificar: no entra al ranking, pero se le dice en qué lugar habría quedado
    const slower = total ? await redis.zcount(key, `(${t}`, "+inf") : 0;
    return Response.json({ pct: total ? Math.round((slower / total) * 100) : 100, total }, { headers: NO_STORE });
  }
  const slower = await redis.zcount(key, `(${mine}`, "+inf");
  await redis.expire(key, 60 * 60 * 24 * 21);
  const pct = total > 1 ? Math.round((slower / (total - 1)) * 100) : 100;
  return Response.json({ pct, total, t: Number(mine) }, { headers: NO_STORE });
}
