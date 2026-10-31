// Service worker: permite abrir la app sin conexión.
// Subí el número de versión cada vez que cambies index.html, así los celulares descargan la nueva copia.
const CACHE = "gymapp-v19";

const ESTATICOS = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.json", "./icon.svg", "./icon-192.png", "./icon-512.png"];
const CDN = [
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ESTATICOS);
    // Los CDN se piden en modo "no-cors": la respuesta es opaca, pero sirve para usar el script sin conexión.
    await Promise.all(CDN.map(url =>
      fetch(url, { mode: "no-cors" }).then(r => cache.put(url, r)).catch(() => {})
    ));
    self.skipWaiting();
  })());
});

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
    const guardada = await cache.match(e.request, { ignoreSearch: true });
    // Muestra la copia guardada y, en segundo plano, actualiza la cache si hay red.
    const red = fetch(e.request)
      .then(r => { if (r && (r.ok || r.type === "opaque")) cache.put(e.request, r.clone()); return r; })
      .catch(() => null);
    return guardada || (await red) || new Response("Sin conexión", { status: 503 });
  })());
});
