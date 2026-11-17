-- Migración v11: la sesión recuerda qué rutina se usó.
-- Es aditiva e idempotente: se puede ejecutar más de una vez sin problema.
alter table public.sesiones add column if not exists rutina_id uuid;
