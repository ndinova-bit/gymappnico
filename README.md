# Gym App (gymappnico)

App personal para registrar entrenamientos, rutinas, peso corporal y progreso.
Funciona sin conexión y sincroniza con Supabase. Se publica con GitHub Pages.

## Archivos

- `index.html` (estructura) y `styles.css` (estilos y temas).
- Lógica, en este orden: `logica.js` (funciones puras, con tests), `base.js`, `almacen.js` (IndexedDB), `sync.js`, `auth.js`, `descanso.js`,
  `sesion.js` (planilla y resumen), `rutinas.js` (plan y programas), `progreso.js`, `datos.js`, `app.js`.
- `sw.js`: caché sin conexión. Subí el número `CACHE` cada vez que cambie cualquier archivo.
- `manifest.json` e íconos.

## Base de datos

Los cambios de estructura se ejecutan a mano en el SQL Editor de Supabase.
La v21 necesita la migración v10 (calentamientos, superseries, programas y notas por ejercicio).
Sin esa migración la app funciona igual, pero sin esas marcas.

## Tipo de serie (v27)

Cada serie se clasifica por repeticiones, carga y esfuerzo: 1-5 reps = fuerza; 6-15 = hipertrofia; 16 o más = hipertrofia si el RPE es 8+, si no resistencia.
6-8 reps con el 85 % o más del mejor 1RM de fuerza también es fuerza. Un RPE 10 con muchas repeticiones sigue siendo hipertrofia.
No se modifica ningún dato guardado: las series con un tipo elegido a mano se respetan y el resto se lee con la regla nueva.

## 1RM estimado (v28)

Epley, sumando las repeticiones en reserva si la serie tiene RPE (10 − RPE, hasta 3). Sin RPE queda igual que antes.
Cambia solo el cálculo que se muestra; los datos guardados no se tocan.

## Cambios de la v29

- Nueva pestaña Historial (búsqueda, rango, repetir una sesión) y barra fija en la sesión con el descanso a la vista.
- Paneles propios en lugar de los cuadros del navegador; editar una serie permite tocar el RPE.
- La app ya no se redibuja sola cada 30 s (no se pierde lo que escribís); baja datos al volver, al reconectar o cada 5 min.
- Series por músculo (efectivas: principal 1, ayudantes 0,5), saltos de carga por ejercicio, aviso de posible descarga, "Cambiar ejercicio" y "cómo llegás hoy".
- Las preferencias (meta, días, tema, etc.) se sincronizan con la cuenta si ejecutaste `migracion_v11.sql` (opcional).
- Service worker: primero la red para los archivos de la app y aviso "Actualizar" en vez de recarga automática.
- Tests: `node --test tests/*.test.js`. Ninguna migración borra ni modifica registros.

## Privacidad

Esta app maneja datos de salud (peso y entrenamiento). No subas datos, capturas ni exportaciones al repositorio.

## Cambios de la v30

- `logica.js` ahora se carga de verdad (`index.html` y `sw.js`) y se usa en toda la app: 1RM con RPE, tipo de serie nuevo (con referencia de fuerza por ejercicio) y series efectivas por músculo.
- Progresión: tarjetas «Para decidir ahora» (bajó, estancado, subí carga, acercate al fallo) y lista compacta «Seguí con el plan». En hipertrofia, RPE 9-10 se lee como esfuerzo correcto; saltos de carga por ejercicio.
- Catálogo: sin ejercicios repetidos y con orden que no separa mayúsculas de minúsculas.
- `migracion_v12_limpiar_catalogo.sql` (opcional, a mano): borra repetidos del catálogo base.
- Tests nuevos para tipo efectivo, catálogo y plan.

## Cambios de la v31

- La meta de peso se guarda en la cuenta (datos del usuario de Supabase Auth, sin migración) y se ve en todos tus dispositivos. Si la cambiás sin conexión, se sube al volver la red.

## Cambios de la v32 (interfaz)

- Progreso: barra de secciones fija (Resumen, Qué hacer, Cuerpo, Mi año, Peso, Ejercicios) que marca la sección que estás viendo.
- Historial: fecha corta, nombre de la rutina (o grupos trabajados), vista previa de ejercicios y chips de series y kilos.
- Nombres en mayúsculas se muestran como «Jalón neutro» en listas, plan, ranking y selector (solo al mostrar; el dato guardado no cambia).

## Cambios de la v33 (tablero y logros)

- Tablero arriba de Sesión: saludo, anillo de la semana (días entrenados vs. tu meta), los 7 días, volumen semanal con mini gráfico, racha, récords de 30 días y barra de nivel.
- Logros en Progreso: nivel (Bronce, Hierro, Acero, Titanio, Neón) con puntos por sesión, récord y semana en meta; 12 insignias con su avance; últimos récords de 1RM.
- Mini gráfico de tendencia del 1RM en las tarjetas de «Para decidir ahora».
- Todo se calcula con tus datos (nuevo `panel.js`); no hay tablas ni migraciones nuevas. Tests de semana, nivel, insignias y récords.
