-- ============================================================
-- gymappnico · migración v10 (para la app v21)
-- Ejecutar UNA vez en Supabase → SQL Editor del proyecto "nicodino-gym".
-- No borra ni modifica datos existentes: solo agrega columnas y una tabla.
-- Se puede ejecutar de nuevo sin problema (usa "if not exists").
-- ============================================================

-- 1) Series: calentamiento / descendente y superseries
alter table public.series
  add column if not exists marca text not null default 'normal';
do $$ begin
  alter table public.series
    add constraint series_marca_valida check (marca in ('normal', 'calentamiento', 'descendente'));
exception when duplicate_object then null; end $$;
alter table public.series
  add column if not exists superserie text;
do $$ begin
  alter table public.series
    add constraint series_superserie_corta check (superserie is null or char_length(superserie) <= 20);
exception when duplicate_object then null; end $$;

-- 2) Rutinas: esquema del programa (series, repeticiones, descanso, semana de descarga)
alter table public.rutinas
  add column if not exists esquema jsonb;

-- 3) Notas fijas por ejercicio (ej.: "asiento en 4")
create table if not exists public.notas_ejercicio (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ejercicio text not null check (char_length(ejercicio) between 1 and 120),
  nota text not null default '' check (char_length(nota) <= 200),
  created_at timestamptz not null default now(),
  unique (user_id, ejercicio)
);
alter table public.notas_ejercicio enable row level security;

-- Mismas reglas que el resto: cada usuario aprobado solo ve y toca sus propias notas.
drop policy if exists notas_select on public.notas_ejercicio;
drop policy if exists notas_insert on public.notas_ejercicio;
drop policy if exists notas_update on public.notas_ejercicio;
drop policy if exists notas_delete on public.notas_ejercicio;
create policy notas_select on public.notas_ejercicio for select to authenticated
  using (user_id = auth.uid() and public.esta_aprobado());
create policy notas_insert on public.notas_ejercicio for insert to authenticated
  with check (user_id = auth.uid() and public.esta_aprobado());
create policy notas_update on public.notas_ejercicio for update to authenticated
  using (user_id = auth.uid() and public.esta_aprobado())
  with check (user_id = auth.uid() and public.esta_aprobado());
create policy notas_delete on public.notas_ejercicio for delete to authenticated
  using (user_id = auth.uid() and public.esta_aprobado());

-- 4) Copia a la tabla nueva los mismos triggers que ya tiene "rutinas"
--    (auditoría y bloqueo de cambio de dueño), sin tener que saber sus nombres.
do $$
declare t record; def text;
begin
  for t in
    select tg.tgname, pg_get_triggerdef(tg.oid) as d
    from pg_trigger tg
    where tg.tgrelid = 'public.rutinas'::regclass and not tg.tgisinternal
  loop
    if not exists (select 1 from pg_trigger
                   where tgrelid = 'public.notas_ejercicio'::regclass and tgname = t.tgname) then
      def := replace(t.d, 'ON public.rutinas', 'ON public.notas_ejercicio');
      execute def;
    end if;
  end loop;
end $$;

-- 5) Control: tiene que mostrar 3 columnas nuevas y los triggers copiados.
select 'series.marca' as columna, exists(select 1 from information_schema.columns where table_schema='public' and table_name='series' and column_name='marca') as ok
union all select 'series.superserie', exists(select 1 from information_schema.columns where table_schema='public' and table_name='series' and column_name='superserie')
union all select 'rutinas.esquema', exists(select 1 from information_schema.columns where table_schema='public' and table_name='rutinas' and column_name='esquema')
union all select 'triggers en notas_ejercicio: ' || coalesce(string_agg(tgname, ', '), 'ninguno'), true
  from pg_trigger where tgrelid = 'public.notas_ejercicio'::regclass and not tgisinternal;
