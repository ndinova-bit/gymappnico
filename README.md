# Gym App (gymappnico)

App personal para registrar entrenamientos, rutinas, peso corporal y progreso.
Funciona sin conexión y sincroniza con Supabase. Se publica con GitHub Pages.

## Archivos

- `index.html` (estructura) y `styles.css` (estilos y temas).
- Lógica, en este orden: `base.js`, `almacen.js` (IndexedDB), `sync.js`, `auth.js`, `descanso.js`,
  `sesion.js` (planilla y resumen), `rutinas.js` (plan y programas), `progreso.js`, `datos.js`, `app.js`.
- `sw.js`: caché sin conexión. Subí el número `CACHE` cada vez que cambie cualquier archivo.
- `manifest.json` e íconos.

## Base de datos

Los cambios de estructura se ejecutan a mano en el SQL Editor de Supabase.
La v21 necesita la migración v10 (calentamientos, superseries, programas y notas por ejercicio).
Sin esa migración la app funciona igual, pero sin esas marcas.

## Privacidad

Esta app maneja datos de salud (peso y entrenamiento). No subas datos, capturas ni exportaciones al repositorio.
