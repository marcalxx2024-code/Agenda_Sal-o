-- This test intentionally uses committed fixtures because the two dblink
-- sessions must observe the same booking from independent transactions.
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(4);

create function pg_temp.shift_concurrency_fixture_to_past()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('scheduled', 'confirmed')
     and new.starts_at > statement_timestamp() then
    update public.bookings
    set starts_at = new.starts_at - interval '100 years',
        ends_at = new.ends_at - interval '100 years'
    where id = new.id;
  end if;
  return null;
end;
$$;

create trigger complete_concurrency_test_make_due
after insert on public.bookings
for each row execute function pg_temp.shift_concurrency_fixture_to_past();

-- Recover cleanly when a previous local run was interrupted before cleanup.
delete from public.appointments
where booking_id in (
  select id from public.bookings where notes = 'Booking Concorrencia Complete'
);
delete from public.booking_services
where booking_id in (
  select id from public.bookings where notes = 'Booking Concorrencia Complete'
);
delete from public.bookings where notes = 'Booking Concorrencia Complete';
delete from public.services where name = 'Servico Concorrencia Complete';
delete from public.clients where name = 'Cliente Concorrencia Complete';

insert into auth.users (id, email)
values ('f0000000-0000-4000-8000-00000000000f', 'complete.concurrent@example.test')
on conflict (id) do update set email = excluded.email;

insert into agenda_salao_private.salon_users (user_id)
values ('f0000000-0000-4000-8000-00000000000f')
on conflict (user_id) do nothing;

insert into public.clients (name, phone)
values ('Cliente Concorrencia Complete', '+55 11 96666-0001');

insert into public.services (
  name, suggested_return_months, estimated_duration_minutes
)
values ('Servico Concorrencia Complete', 1, 30);

insert into public.bookings (
  client_id, starts_at, ends_at, status, notes
)
select c.id,
       statement_timestamp() + interval '60 days',
       statement_timestamp() + interval '60 days 30 minutes',
       'scheduled',
       'Booking Concorrencia Complete'
from public.clients c
where c.name = 'Cliente Concorrencia Complete';

insert into public.booking_services (
  booking_id, service_id, service_name, estimated_duration_minutes
)
select b.id, s.id, s.name, s.estimated_duration_minutes
from public.bookings b
cross join public.services s
where b.notes = 'Booking Concorrencia Complete'
  and s.name = 'Servico Concorrencia Complete';

-- Keep the first transaction inside the critical section long enough for the
-- second request to reach the same row lock.
drop trigger if exists test_pause_booking_completion on public.appointments;
drop function if exists agenda_salao_private.test_pause_booking_completion();
create or replace function agenda_salao_private.test_pause_booking_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.booking_id = (
    select b.id
    from public.bookings b
    where b.notes = 'Booking Concorrencia Complete'
  ) then
    perform pg_sleep(1.5);
  end if;
  return new;
end;
$$;

create trigger test_pause_booking_completion
before insert on public.appointments
for each row execute function agenda_salao_private.test_pause_booking_completion();

do $$
declare
  connection_string text :=
    'host=host.docker.internal port=54322 dbname=' || current_database()
    || ' user=postgres password=postgres';
  booking_to_complete bigint;
  service_to_perform bigint;
  complete_sql text;
begin
  select id into booking_to_complete
  from public.bookings
  where notes = 'Booking Concorrencia Complete';

  select id into service_to_perform
  from public.services
  where name = 'Servico Concorrencia Complete';

  complete_sql := format(
    'select * from public.complete_booking(%s, date %L, array[%s::bigint])',
    booking_to_complete,
    '2020-12-20',
    service_to_perform
  );

  perform extensions.dblink_connect('complete_one', connection_string);
  perform extensions.dblink_connect('complete_two', connection_string);

  perform extensions.dblink_exec(
    'complete_one',
    'set role authenticated; set "request.jwt.claims" = ''{"sub":"f0000000-0000-4000-8000-00000000000f","role":"authenticated"}'''
  );
  perform extensions.dblink_exec(
    'complete_two',
    'set role authenticated; set "request.jwt.claims" = ''{"sub":"f0000000-0000-4000-8000-00000000000f","role":"authenticated"}'''
  );

  perform extensions.dblink_send_query('complete_one', complete_sql);
  perform pg_sleep(0.2);
  perform extensions.dblink_send_query('complete_two', complete_sql);
end;
$$;

create temporary table concurrent_complete_one as
select *
from extensions.dblink_get_result('complete_one') as result(
  booking_id bigint,
  appointment_id bigint,
  booking_status text,
  performed_on date,
  service_count integer
);

create temporary table concurrent_complete_two as
select *
from extensions.dblink_get_result('complete_two') as result(
  booking_id bigint,
  appointment_id bigint,
  booking_status text,
  performed_on date,
  service_count integer
);

select is(
  (select appointment_id from concurrent_complete_one),
  (select appointment_id from concurrent_complete_two),
  'duas conclusoes concorrentes retornam o mesmo appointment'
);
select is(
  (select count(*) from public.appointments a
   join public.bookings b on b.id = a.booking_id
   where b.notes = 'Booking Concorrencia Complete'),
  1::bigint,
  'duas conclusoes concorrentes criam exatamente um appointment'
);
select is(
  (select status from public.bookings
   where notes = 'Booking Concorrencia Complete'),
  'completed'::text,
  'estado final concorrente e completed'
);
select is(
  (select count(*) from public.returns r
   join public.appointment_services aps on aps.id = r.appointment_service_id
   join public.appointments a on a.id = aps.appointment_id
   join public.bookings b on b.id = a.booking_id
   where b.notes = 'Booking Concorrencia Complete'),
  1::bigint,
  'concorrencia gera apenas o retorno do unico atendimento'
);

select extensions.dblink_disconnect('complete_one');
select extensions.dblink_disconnect('complete_two');

drop trigger test_pause_booking_completion on public.appointments;
drop function agenda_salao_private.test_pause_booking_completion();

delete from public.appointments
where booking_id = (
  select id from public.bookings where notes = 'Booking Concorrencia Complete'
);
delete from public.booking_services
where booking_id = (
  select id from public.bookings where notes = 'Booking Concorrencia Complete'
);
delete from public.bookings where notes = 'Booking Concorrencia Complete';
delete from public.services where name = 'Servico Concorrencia Complete';
delete from public.clients where name = 'Cliente Concorrencia Complete';
delete from agenda_salao_private.salon_users
where user_id = 'f0000000-0000-4000-8000-00000000000f';
delete from auth.users
where id = 'f0000000-0000-4000-8000-00000000000f';

select * from finish();
