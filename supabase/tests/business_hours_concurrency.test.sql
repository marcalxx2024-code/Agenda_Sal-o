-- Usa fixtures confirmadas porque as duas sessoes dblink precisam observar a
-- mesma configuracao. Execute somente no Supabase local descartavel.
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(4);

-- Recuperacao de uma eventual execucao local interrompida.
drop trigger if exists test_pause_business_hours_update on public.business_hours;
drop function if exists agenda_salao_private.test_pause_business_hours_update();
drop function if exists public.test_try_create_booking(bigint, timestamptz, bigint);
delete from public.booking_services
where booking_id in (
  select id from public.bookings where notes = 'Booking Concorrencia Expediente'
);
delete from public.bookings where notes = 'Booking Concorrencia Expediente';
delete from public.services where name = 'Servico Concorrencia Expediente';
delete from public.clients where name = 'Cliente Concorrencia Expediente';

insert into auth.users (id, email)
values (
  'a4000000-0000-4000-8000-000000000001',
  'hours.concurrent@example.test'
)
on conflict (id) do update set email = excluded.email;

insert into agenda_salao_private.salon_users (user_id)
values ('a4000000-0000-4000-8000-000000000001')
on conflict (user_id) do nothing;

insert into public.clients (name, phone)
values ('Cliente Concorrencia Expediente', '+55 11 95555-4001');

insert into public.services (name, estimated_duration_minutes)
values ('Servico Concorrencia Expediente', 60);

update public.business_hours
set is_open = true,
    opens_at = time '00:00',
    closes_at = time '23:59:59.999999',
    break_starts_at = null,
    break_ends_at = null;

create temporary table concurrent_hours_clock as
select
  local_day,
  extract(dow from local_day)::smallint as weekday,
  (local_day + time '10:00') at time zone 'America/Sao_Paulo' as starts_at
from (
  select (statement_timestamp() at time zone 'America/Sao_Paulo')::date + 40
    as local_day
) anchor;

create temporary table concurrent_closed_week as
select jsonb_agg(
  jsonb_build_object(
    'weekday', weekday,
    'is_open', weekday <> clock.weekday,
    'opens_at', case when weekday = clock.weekday then null else '00:00' end,
    'closes_at', case
      when weekday = clock.weekday then null
      else '23:59:59.999999'
    end,
    'break_starts_at', null,
    'break_ends_at', null
  )
  order by weekday
) as payload
from generate_series(0, 6) as weekday
cross join concurrent_hours_clock as clock;

-- Mantem a RPC dentro da secao critica para a criacao concorrente alcancar o
-- mesmo advisory lock antes do commit da nova semana.
create or replace function agenda_salao_private.test_pause_business_hours_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_sleep(1.5);
  return null;
end;
$$;

create trigger test_pause_business_hours_update
before update on public.business_hours
for each statement
execute function agenda_salao_private.test_pause_business_hours_update();

create or replace function public.test_try_create_booking(
  p_client_id bigint,
  p_starts_at timestamptz,
  p_service_id bigint
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.create_booking(
    p_client_id,
    p_starts_at,
    array[p_service_id],
    null,
    'Booking Concorrencia Expediente'
  );
  return 'ok';
exception
  when others then
    return sqlstate;
end;
$$;

revoke all on function public.test_try_create_booking(bigint, timestamptz, bigint)
from public, anon, authenticated;
grant execute on function public.test_try_create_booking(bigint, timestamptz, bigint)
to authenticated;

do $$
declare
  connection_string text :=
    'host=host.docker.internal port=54322 dbname=' || current_database()
    || ' user=postgres password=postgres';
  update_sql text;
  booking_sql text;
begin
  update_sql := format(
    'select * from public.update_business_hours_week(%L::jsonb, false, null)',
    (select payload::text from concurrent_closed_week)
  );
  booking_sql := format(
    'select public.test_try_create_booking(%s, %L::timestamptz, %s)',
    (select id from public.clients
     where name = 'Cliente Concorrencia Expediente'),
    (select starts_at::text from concurrent_hours_clock),
    (select id from public.services
     where name = 'Servico Concorrencia Expediente')
  );

  perform extensions.dblink_connect('hours_update', connection_string);
  perform extensions.dblink_connect('hours_booking', connection_string);
  perform extensions.dblink_exec(
    'hours_update',
    'set role authenticated; set "request.jwt.claims" = ''{"sub":"a4000000-0000-4000-8000-000000000001","role":"authenticated"}'''
  );
  perform extensions.dblink_exec(
    'hours_booking',
    'set role authenticated; set "request.jwt.claims" = ''{"sub":"a4000000-0000-4000-8000-000000000001","role":"authenticated"}'''
  );

  perform extensions.dblink_send_query('hours_update', update_sql);
  perform pg_sleep(0.2);
  perform extensions.dblink_send_query('hours_booking', booking_sql);
end;
$$;

create temporary table concurrent_hours_update_result as
select *
from extensions.dblink_get_result('hours_update') as result(
  updated boolean,
  requires_confirmation boolean,
  conflicts_changed boolean,
  affected_booking_count integer,
  affected_booking_ids bigint[],
  affected_bookings jsonb
);

create temporary table concurrent_hours_booking_result as
select *
from extensions.dblink_get_result('hours_booking') as result(error_code text);

select is(
  (select updated from concurrent_hours_update_result),
  true,
  'atualizacao concorrente conclui atomicamente'
);
select is(
  (select error_code from concurrent_hours_booking_result),
  '23514'::text,
  'booking concorrente aguarda e valida o novo expediente'
);
select is(
  (select count(*) from public.bookings
   where notes = 'Booking Concorrencia Expediente'),
  0::bigint,
  'booking fora do novo expediente nao e gravado'
);
select is(
  (select is_open from public.business_hours
   where weekday = (select weekday from concurrent_hours_clock)),
  false,
  'estado final preserva a semana confirmada'
);

select extensions.dblink_disconnect('hours_update');
select extensions.dblink_disconnect('hours_booking');

drop trigger test_pause_business_hours_update on public.business_hours;
drop function agenda_salao_private.test_pause_business_hours_update();
drop function public.test_try_create_booking(bigint, timestamptz, bigint);

update public.business_hours
set is_open = true,
    opens_at = time '00:00',
    closes_at = time '23:59:59.999999',
    break_starts_at = null,
    break_ends_at = null;

delete from public.services where name = 'Servico Concorrencia Expediente';
delete from public.clients where name = 'Cliente Concorrencia Expediente';
delete from agenda_salao_private.salon_users
where user_id = 'a4000000-0000-4000-8000-000000000001';
delete from auth.users
where id = 'a4000000-0000-4000-8000-000000000001';

select * from finish();
