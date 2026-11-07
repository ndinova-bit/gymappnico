-- ============================================================
-- gymappnico · migración v11 (para la app v29)
-- Ejecutar UNA vez en Supabase → SQL Editor del proyecto "nicodino-gym".
-- No borra ni modifica datos existentes: solo agrega una tabla nueva.
-- Se puede ejecutar de nuevo sin problema (usa "if not exists").
-- Sirve para que la meta de peso, el tema, los días por semana, el descanso
-- por defecto y los hitos viajen con tu cuenta (hoy quedan en cada celular).
-- ============================================================

-- 1) Preferencias: una fila por usuario
create table if not exists public.preferencias (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  datos jsonb not null default '{}'::jsonb check (pg_column_size(datos) <= 20000),
  actualizado timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id)
);
alter table public.preferencias enable row level security;

-- Mismas reglas que el resto: cada usuario aprobado solo ve y toca sus propias preferencias.
drop policy if exists preferencias_select on public.preferencias;
drop policy if exists preferencias_insert on public.preferencias;
drop policy if exists preferencias_update on public.preferencias;
drop policy if exists preferencias_delete on public.preferencias;
create policy preferencias_select on public.preferencias for select to authenticated
  using (user_id = auth.uid() and public.esta_aprobado());
create policy preferencias_insert on public.preferencias for insert to authenticated
  with check (user_id = auth.uid() and public.esta_aprobado());
create policy preferencias_update on public.preferencias for update to authenticated
  using (user_id = auth.uid() and public.esta_aprobado())
  with check (user_id = auth.uid() and public.esta_aprobado());
create policy preferencias_delete on public.preferencias for delete to authenticated
  using (user_id = auth.uid() and public.esta_aprobado());

-- 2) Copia a la tabla nueva los mismos triggers que ya tiene "rutinas"
--    (auditoría y bloqueo de cambio de dueño), igual que se hizo con notas_ejercicio en la v10.
do $$
declare t record; def text;
begin
  for t in
    select tg.tgname, pg_get_triggerdef(tg.oid) as d
    from pg_trigger tg
    where tg.tgrelid = 'public.rutinas'::regclass and not tg.tgisinternal
  loop
    if not exists (select 1 from pg_trigger
                   where tgrelid = 'public.preferencias'::regclass and tgname = t.tgname) then
      def := replace(t.d, 'ON public.rutinas', 'ON public.preferencias');
      execute def;
    end if;
  end loop;
end $$;

-- 3) Control: tiene que mostrar la tabla, RLS activado y los triggers copiados.
select 'tabla preferencias' as control,
       exists(select 1 from information_schema.tables where table_schema = 'public' and table_name = 'preferencias') as ok
union all select 'RLS activado',
       coalesce((select relrowsecurity from pg_class where oid = 'public.preferencias'::regclass), false)
union all select 'triggers: ' || coalesce(string_agg(tgname, ', '), 'ninguno'), true
  from pg_trigger where tgrelid = 'public.preferencias'::regclass and not tgisinternal;
