// Middleware de Vercel (Routing Middleware): protege /sublivach con una clave de acceso.
// La clave se puede configurar en Vercel como variable de entorno SUBLIVACH_PASS.
// Si no está configurada, usa la clave de prueba de abajo.
// (LaserVach no se toca acá: hoy esa página es pública.)

export const config = {
  matcher: ['/sublivach', '/sublivach/:path*'],
};

const SUBLIVACH_DEFAULT_PASS = 'PRUEBAvach';
const SV_COOKIE = 'sv_access';

export default async function middleware(request) {
  return sublivach(request, new URL(request.url));
}

/* ---------------- SubliVach ---------------- */
async function token(pass) {
  const data = new TextEncoder().encode('sublivach:' + pass);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  const m = raw.split(/;\s*/).find((c) => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}

async function sublivach(request, url) {
  const pass = process.env.SUBLIVACH_PASS || SUBLIVACH_DEFAULT_PASS;
  const valid = await token(pass);

  // Ya tiene acceso
  if (readCookie(request, SV_COOKIE) === valid) return;

  // Envió la clave
  if (request.method === 'POST') {
    let clave = '';
    try {
      const form = await request.formData();
      clave = String(form.get('clave') || '').trim();
    } catch (e) {}
    if (clave === pass) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: '/sublivach/',
          'Set-Cookie': `${SV_COOKIE}=${valid}; Path=/sublivach; Max-Age=2592000; Secure; SameSite=Lax`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return loginPage(true);
  }

  return loginPage(false);
}

function loginPage(error) {
  const html = `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex, nofollow" />
<title>SubliVach · Acceso</title>
<link rel="icon" href="/icons/favicon-32.png" sizes="32x32" />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet" />
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem;font-family:'Space Grotesk',sans-serif;color:#fff;
    background:radial-gradient(ellipse 80% 60% at 20% 10%,rgba(123,79,255,.16) 0%,transparent 60%),#0A0A0A}
  .box{width:100%;max-width:380px;background:#121214;border:1px solid rgba(123,79,255,.35);border-radius:18px;padding:2rem}
  img{height:24px;display:block;margin-bottom:1.6rem}
  .label{font-size:.72rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#7B4FFF;margin-bottom:.6rem}
  h1{font-size:1.5rem;line-height:1.15;margin-bottom:.5rem}
  p{font-size:.88rem;color:#AAA;line-height:1.5;margin-bottom:1.3rem}
  input{width:100%;height:48px;padding:0 1rem;border-radius:12px;border:1px solid ${error ? '#ff7a7a' : 'rgba(255,255,255,.08)'};background:#18181B;color:#fff;font:inherit;font-size:1rem;margin-bottom:.8rem}
  input:focus{outline:none;border-color:rgba(123,79,255,.6)}
  button{width:100%;height:48px;border:0;border-radius:12px;background:#7B4FFF;color:#fff;font:inherit;font-weight:700;font-size:.95rem;cursor:pointer}
  .err{color:#ff7a7a;font-size:.82rem;margin:-.3rem 0 .8rem}
  a{display:block;text-align:center;margin-top:1.2rem;font-size:.8rem;color:#888;text-decoration:none}
</style></head>
<body><form class="box" method="POST" action="/sublivach/">
  <img src="/logo.png" alt="VACH*" />
  <div class="label">↗ SubliVach</div>
  <h1>Acceso privado</h1>
  <p>El cotizador está en prueba. Ingresá la clave de acceso para continuar.</p>
  <input type="password" name="clave" placeholder="Clave de acceso" autocomplete="current-password" autofocus required />
  ${error ? '<div class="err">La clave no es correcta.</div>' : ''}
  <button type="submit">Entrar</button>
  <a href="/">← Volver a vach.com.ar</a>
</form></body></html>`;
  return new Response(html, {
    status: error ? 401 : 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}
