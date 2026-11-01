// ============================================================
// almacen.js — guardado en el celular con IndexedDB.
// localStorage tiene un límite de unos 5 MB; IndexedDB aguanta años
// de series. La primera vez pasa lo que había en localStorage.
// Los ajustes (chicos) siguen en localStorage.
// ============================================================

const IDB_NOMBRE = "gymapp", IDB_TABLA = "kv";
let idb = null;

function abrirIDB() {
  return new Promise((ok, mal) => {
    const r = indexedDB.open(IDB_NOMBRE, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_TABLA);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
}
function idbLeer(clave) {
  return new Promise((ok, mal) => {
    const r = idb.transaction(IDB_TABLA, "readonly").objectStore(IDB_TABLA).get(clave);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
}
function idbEscribir(clave, valor) {
  return new Promise((ok, mal) => {
    const tx = idb.transaction(IDB_TABLA, "readwrite");
    tx.objectStore(IDB_TABLA).put(valor, clave);
    tx.oncomplete = () => ok();
    tx.onerror = () => mal(tx.error);
  });
}

async function cargarAlmacen() {
  const lsCache = leerJSON("gymapp_cache", null);
  const lsCola = leerJSON("gymapp_cola", null);
  try {
    idb = await abrirIDB();
    const [c, q] = await Promise.all([idbLeer("cache"), idbLeer("cola")]);
    db = Object.assign(DB_VACIA(), c ?? lsCache ?? {});
    cola = q ?? lsCola ?? [];
    // Migración única desde localStorage.
    if (lsCache || lsCola) {
      await idbEscribir("cache", db);
      await idbEscribir("cola", cola);
      localStorage.removeItem("gymapp_cache");
      localStorage.removeItem("gymapp_cola");
    }
  } catch (e) {
    // Navegador sin IndexedDB (raro): se sigue con localStorage.
    idb = null;
    db = Object.assign(DB_VACIA(), lsCache ?? {});
    cola = lsCola ?? [];
  }
}
const almacenListo = cargarAlmacen();

// La cola se escribe enseguida (es lo que no se puede perder);
// la copia completa de los datos, agrupada cada 300 ms.
function guardarTodo() {
  try { localStorage.setItem(K_META, JSON.stringify(ajustes)); } catch (e) {}
  if (!idb) {
    try {
      localStorage.setItem("gymapp_cache", JSON.stringify(db));
      localStorage.setItem("gymapp_cola", JSON.stringify(cola));
    } catch (e) { toast("No hay más espacio en el celular para guardar"); }
    return;
  }
  idbEscribir("cola", cola).catch(() => {});
  clearTimeout(guardarTodo.t);
  guardarTodo.t = setTimeout(() => idbEscribir("cache", db).catch(() => {}), 300);
}
// Antes de cerrar la app, guarda lo que quedó pendiente.
window.addEventListener("pagehide", () => {
  if (idb && guardarTodo.t) { clearTimeout(guardarTodo.t); idbEscribir("cache", db).catch(() => {}); }
});
