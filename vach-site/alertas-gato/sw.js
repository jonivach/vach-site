// Alertas de Gato Encerrado para el dueño del juego
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (err) {}
  e.waitUntil(self.registration.showNotification(d.title || "Gato Encerrado", {
    body: d.body || "", icon: "/gato/icon-192.png", badge: "/gato/icon-192.png", tag: d.tag || "gato-alerta", data: { url: d.url || "/alertas-gato/" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow((e.notification.data && e.notification.data.url) || "/alertas-gato/"));
});
