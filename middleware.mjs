// Protege /laservach con usuario y clave (HTTP Basic Auth).
// La clave NO va en este archivo: se configura como variable de entorno
// en el dashboard de Vercel (Project Settings -> Environment Variables):
//   LASERVACH_USER  (opcional, default "vach")
//   LASERVACH_PASS  (obligatoria; si no está seteada, la página queda bloqueada para todos)

export const config = {
  matcher: ['/laservach', '/laservach/:path*'],
};

export default function middleware(request) {
  const validUser = process.env.LASERVACH_USER || 'vach';
  const validPass = process.env.LASERVACH_PASS;

  const auth = request.headers.get('authorization');
  if (validPass && auth) {
    const [scheme, encoded] = auth.split(' ');
    if (scheme === 'Basic' && encoded) {
      let user = '';
      let pass = '';
      try {
        [user, pass] = atob(encoded).split(':');
      } catch (e) {
        // credenciales mal formadas, cae al 401 de abajo
      }
      if (user === validUser && pass === validPass) {
        return; // credenciales correctas: deja pasar la request
      }
    }
  }

  return new Response('Acceso restringido', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="LaserVach", charset="UTF-8"' },
  });
}
