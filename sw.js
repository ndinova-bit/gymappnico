// Service worker: permite abrir la app sin conexión.
// Subí el número de versión cada vez que cambies cualquier archivo, así los celulares descargan la nueva copia.
const CACHE = "gymapp-v29";

const ESTATICOS = [
  "./", "./index.html", "./styles.css",
  "./logica.js", "./base.js", "./almacen.js", "./sync.js", "./auth.js", "./descanso.js",
  "./sesion.js", "./rutinas.js", "./progreso.js", "./datos.js", "./app.js",
  "./manifest.json", "./icon.svg", "./icon-192.png", "./icon-512.png"
];
const CDN = [
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(ESTATICOS.map(u => cache.add(new Request(u, { cache: "reload" }))));
    // Los CDN se piden en modo "no-cors": la respuesta es opaca, pero sirve para usar el script sin conexión.
    await Promise.all(CDN.map(url =>
      fetch(url, { mode: "no-cors" }).then(r => cache.put(url, r)).catch(() => {})
    ));
    // No hay skipWaiting automático: la página avisa y, si la persona acepta, manda SKIP_WAITING.
  })());
});
self.addEventListener("message", e => { if (e.data === "SKIP_WAITING") self.skipWaiting(); });

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const claves = await caches.keys();
    await Promise.all(claves.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Las llamadas a Supabase no se cachean: siempre van a la red.
  if (url.hostname.endsWith("supabase.co")) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const propio = url.origin === self.location.origin;
    if (propio) {
      // Archivos de la app: primero la red (saltando la caché del navegador), así nunca se mezclan versiones; sin red, la copia guardada.
      try {
        const r = await fetch(e.request, { cache: "no-cache" });
        if (r && r.ok) cache.put(e.request, r.clone());
        return r;
      } catch (err) {
        return (await cache.match(e.request, { ignoreSearch: true })) || new Response("Sin conexión", { status: 503 });
      }
    }
    // Librerías externas (CDN): copia guardada y, en segundo plano, se refresca.
    const guardada = await cache.match(e.request, { ignoreSearch: true });
    const red = fetch(e.request)
      .then(r => { if (r && (r.ok || r.type === "opaque")) cache.put(e.request, r.clone()); return r; })
      .catch(() => null);
    return guardada || (await red) || new Response("Sin conexión", { status: 503 });
  })());
});

// Tocar el aviso de fin de descanso vuelve a abrir la app.
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (abiertas.length) return abiertas[0].focus();
    return self.clients.openWindow("./");
  })());
});
