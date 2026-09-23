begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

select has_function(
  'public',
  'update_business_hours_week',
  array['jsonb', 'boolean', 'bigint[]'],
  'RPC publica de expediente semanal existe'
);
select ok(
  not (
    select prosecdef
    from pg_proc
    where oid = 'public.update_business_hours_week(jsonb,boolean,bigint[])'::regprocedure
  ),
  'wrapper publico preserva privilegios do chamador'
);
select ok(
  (
    select prosecdef
    from pg_proc
    where oid = 'agenda_salao_private.update_business_hours_week(jsonb,boolean,bigint[])'::regprocedure
  ),
  'implementacao privada executa com privilegios controlados'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.update_business_hours_week(jsonb,boolean,bigint[])',
    'EXECUTE'
  ),
  'authenticated pode executar o wrapper publico'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.update_business_hours_week(jsonb,boolean,bigint[])',
    'EXECUTE'
  ),
  'anon nao pode executar o wrapper publico'
);
select ok(
  not has_table_privilege('authenticated', 'public.business_hours', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.business_hours', 'INSERT'),
  'frontend nao possui mais escrita direta no expediente'
);

insert into auth.users (id, email)
values
  ('a3000000-0000-4000-8000-000000000001', 'hours.salao@example.test'),
  ('a3000000-0000-4000-8000-000000000002', 'hours.unauthorized@example.test');

insert into agenda_salao_private.salon_users (user_id)
values ('a3000000-0000-4000-8000-000000000001');

insert into public.clients (name, phone)
values ('Cliente Conflito Expediente', '+55 11 95555-3001');

create temporary table business_hours_clock as
select
  local_day,
  extract(dow from local_day)::smallint as weekday,
  (local_day + time '10:00') at time zone 'America/Sao_Paulo' as starts_at,
  (local_day + time '11:00') at time zone 'America/Sao_Paulo' as ends_at
from (
  select (statement_timestamp() at time zone 'America/Sao_Paulo')::date + 30
    as local_day
) anchor;

update public.business_hours
set is_open = true,
    opens_at = time '08:00',
    closes_at = time '18:00',
    break_starts_at = null,
    break_ends_at = null;

insert into public.bookings (client_id, starts_at, ends_at, status, notes)
select
  c.id,
  clock.starts_at,
  clock.ends_at,
  'scheduled',
  'Conflito expediente transacional'
from public.clients as c
cross join business_hours_clock as clock
where c.name = 'Cliente Conflito Expediente';

create temporary table proposed_closed_week as
select jsonb_agg(
  jsonb_build_object(
    'weekday', day_series.weekday,
    'is_open', day_series.weekday <> clock.weekday,
    'opens_at', case
      when day_series.weekday = clock.weekday then null
      else '08:00'
    end,
    'closes_at', case
      when day_series.weekday = clock.weekday then null
      else '18:00'
    end,
    'break_starts_at', null,
    'break_ends_at', null
  )
  order by day_series.weekday
) as payload
from generate_series(0, 6) as day_series(weekday)
cross join business_hours_clock as clock;

create temporary table invalid_week as
select jsonb_agg(
  jsonb_build_object(
    'weekday', day_series.weekday,
    'is_open', true,
    'opens_at', '18:00',
    'closes_at', '08:00',
    'break_starts_at', null,
    'break_ends_at', null
  )
  order by day_series.weekday
) as payload
from generate_series(0, 6) as day_series(weekday);

-- As fixtures sao criadas pelo owner antes de simular a requisicao da API.
-- O papel authenticated precisa apenas le-las para montar os argumentos e as
-- verificacoes; nenhuma permissao adicional e concedida a tabelas reais.
grant select on table
  business_hours_clock,
  proposed_closed_week,
  invalid_week
to authenticated;

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"a3000000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$update public.business_hours set is_open = false$$,
  '42501',
  'permission denied for table business_hours',
  'usuario autorizado tambem precisa usar a RPC transacional'
);

select throws_ok(
  $$select * from public.update_business_hours_week(
      (select payload from invalid_week)
    )$$,
  '22023',
  'p_hours must contain each weekday exactly once with valid opening and break times',
  'payload semanal invalido e rejeitado antes de qualquer alteracao'
);
select is(
  (select count(*) from public.business_hours
   where is_open and opens_at = time '08:00' and closes_at = time '18:00'),
  7::bigint,
  'falha de validacao preserva atomicamente os sete dias'
);

select is(
  (select requires_confirmation
   from public.update_business_hours_week(
     (select payload from proposed_closed_week)
   )),
  true,
  'conflito futuro exige confirmacao explicita'
);
select is(
  (select affected_booking_count
   from public.update_business_hours_week(
     (select payload from proposed_closed_week)
   )),
  1,
  'RPC informa todos os agendamentos afetados'
);
select is(
  (select bh.is_open from public.business_hours as bh
   where bh.weekday = (
     select clock.weekday from business_hours_clock as clock
   )),
  true,
  'pre-visualizacao de conflitos nao altera o expediente'
);

select is(
  (select conflicts_changed
   from public.update_business_hours_week(
     (select payload from proposed_closed_week),
     true,
     array[]::bigint[]
   )),
  true,
  'confirmacao com lista divergente e recusada'
);
select is(
  (select bh.is_open from public.business_hours as bh
   where bh.weekday = (
     select clock.weekday from business_hours_clock as clock
   )),
  true,
  'lista divergente continua sem alteracao parcial'
);

select is(
  (select updated
   from public.update_business_hours_week(
     (select payload from proposed_closed_week),
     true,
     array[(select id from public.bookings
            where notes = 'Conflito expediente transacional')]
   )),
  true,
  'confirmacao da lista exata atualiza a semana atomicamente'
);
select is(
  (select bh.is_open from public.business_hours as bh
   where bh.weekday = (
     select clock.weekday from business_hours_clock as clock
   )),
  false,
  'dia conflitante recebe o novo expediente'
);
select is(
  (select status from public.bookings
   where notes = 'Conflito expediente transacional'),
  'scheduled'::text,
  'agendamento afetado permanece ativo e inalterado'
);

set local "request.jwt.claims" =
  '{"sub":"a3000000-0000-4000-8000-000000000002","role":"authenticated"}';

select throws_ok(
  $$select * from public.update_business_hours_week(
      (select payload from proposed_closed_week)
    )$$,
  '42501',
  'only the authorized salon account can update business hours',
  'usuario autenticado fora da allowlist nao altera expediente'
);

-- O usuario fora da allowlist nao enxerga bookings por RLS. Volte ao owner
-- somente depois de comprovar a rejeicao para verificar o estado fisico da
-- fixture e diferenciar invisibilidade de exclusao ou alteracao.
reset role;
select is(
  (select b.status from public.bookings as b
   where b.notes = 'Conflito expediente transacional'),
  'scheduled'::text,
  'falha de autorizacao preserva os agendamentos'
);

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(
  $$select * from public.update_business_hours_week('[]'::jsonb)$$,
  '42501',
  'permission denied for function update_business_hours_week',
  'anon nao executa a RPC'
);

select * from finish();
rollback;
