begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email)
values ('a1000000-0000-4000-8000-000000000001', 'schedule.salao@example.test')
on conflict (id) do nothing;
insert into agenda_salao_private.salon_users (user_id)
values ('a1000000-0000-4000-8000-000000000001')
on conflict (user_id) do nothing;

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into public.clients (name, phone, active)
values
  ('Cliente Expediente Ativa', '+55 11 96666-0001', true),
  ('Cliente Expediente Inativa', '+55 11 96666-0002', false);
insert into public.services (name, estimated_duration_minutes, active)
values ('Servico Expediente', 60, true);

create temporary table schedule_clock as
select
  local_day,
  (local_day + time '08:00') at time zone 'America/Sao_Paulo' as before_open,
  (local_day + time '10:00') at time zone 'America/Sao_Paulo' as valid_at,
  (local_day + time '10:30') at time zone 'America/Sao_Paulo' as overlap_at,
  (local_day + time '12:15') at time zone 'America/Sao_Paulo' as break_at,
  (local_day + time '14:00') at time zone 'America/Sao_Paulo' as block_start,
  (local_day + time '15:00') at time zone 'America/Sao_Paulo' as block_end,
  (local_day + interval '1 day' + time '10:00') at time zone 'America/Sao_Paulo' as closed_at
from (
  select ((statement_timestamp() at time zone 'America/Sao_Paulo')::date + 30) as local_day
) anchor;

update public.business_hours
set is_open = false,
    opens_at = null,
    closes_at = null,
    break_starts_at = null,
    break_ends_at = null;
update public.business_hours
set is_open = true,
    opens_at = time '09:00',
    closes_at = time '18:00',
    break_starts_at = time '12:00',
    break_ends_at = time '13:00'
where weekday = (
  select extract(dow from local_day)::smallint from schedule_clock
);

select lives_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Expediente Ativa'),
      (select valid_at from schedule_clock),
      array[(select id from public.services where name = 'Servico Expediente')]
    )$$,
  'agendamento dentro do expediente e aceito'
);

select throws_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Expediente Ativa'),
      (select before_open from schedule_clock),
      array[(select id from public.services where name = 'Servico Expediente')]
    )$$,
  '23514', 'booking is outside business hours',
  'agendamento fora do expediente e rejeitado'
);

select throws_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Expediente Ativa'),
      (select closed_at from schedule_clock),
      array[(select id from public.services where name = 'Servico Expediente')]
    )$$,
  '23514', 'salon is closed on the selected day',
  'agendamento em dia fechado e rejeitado'
);

select throws_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Expediente Ativa'),
      (select break_at from schedule_clock),
      array[(select id from public.services where name = 'Servico Expediente')]
    )$$,
  'P0001', 'booking conflicts with the business break',
  'agendamento no intervalo e rejeitado'
);

insert into public.schedule_blocks (starts_at, ends_at, reason)
select block_start, block_end, 'Bloqueio de teste' from schedule_clock;
select throws_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Expediente Ativa'),
      (select block_start + interval '15 minutes' from schedule_clock),
      array[(select id from public.services where name = 'Servico Expediente')]
    )$$,
  'P0001', 'booking time conflicts with a schedule block',
  'agendamento em bloqueio e rejeitado'
);

select throws_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Expediente Ativa'),
      (select overlap_at from schedule_clock),
      array[(select id from public.services where name = 'Servico Expediente')]
    )$$,
  '23P01', 'booking time conflicts with another active booking',
  'sobreposicao entre agendamentos ativos continua rejeitada'
);

select throws_ok(
  $$select * from public.complete_booking(
      (select id from public.bookings where starts_at = (select valid_at from schedule_clock)),
      current_date,
      array[(select id from public.services where name = 'Servico Expediente')]
    )$$,
  '55000', 'booking cannot be completed before starts_at',
  'conclusao futura e bloqueada no banco'
);

-- Historical fixtures are inserted by the database owner, then exercised only
-- through the authenticated public RPC.
reset role;
update public.business_hours
set is_open = true,
    opens_at = time '00:00',
    closes_at = time '23:59:59.999999',
    break_starts_at = null,
    break_ends_at = null;

insert into public.bookings (client_id, starts_at, ends_at, status, notes)
select c.id,
       (salon_day + time '10:00') at time zone 'America/Sao_Paulo',
       (salon_day + time '11:00') at time zone 'America/Sao_Paulo',
       'scheduled', 'Conclusao passada valida'
from public.clients c
cross join lateral (
  select (statement_timestamp() at time zone 'America/Sao_Paulo')::date - 2 as salon_day
) clock
where c.name = 'Cliente Expediente Ativa';

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select booking_status from public.complete_booking(
    (select id from public.bookings where notes = 'Conclusao passada valida'),
    ((statement_timestamp() at time zone 'America/Sao_Paulo')::date - 2),
    array[(select id from public.services where name = 'Servico Expediente')]
  )),
  'completed'::text,
  'conclusao valida apos o horario e aceita'
);

reset role;
insert into public.bookings (client_id, starts_at, ends_at, status, notes)
select c.id,
       (salon_day + time '12:00') at time zone 'America/Sao_Paulo',
       (salon_day + time '13:00') at time zone 'America/Sao_Paulo',
       'scheduled', 'Conclusao cliente inativada'
from public.clients c
cross join lateral (
  select (statement_timestamp() at time zone 'America/Sao_Paulo')::date - 2 as salon_day
) clock
where c.name = 'Cliente Expediente Ativa';
update public.clients set active = false where name = 'Cliente Expediente Ativa';

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select booking_status from public.complete_booking(
    (select id from public.bookings where notes = 'Conclusao cliente inativada'),
    ((statement_timestamp() at time zone 'America/Sao_Paulo')::date - 2),
    array[(select id from public.services where name = 'Servico Expediente')]
  )),
  'completed'::text,
  'agendamento existente pode ser concluido apos cliente ser inativada'
);

select throws_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Expediente Inativa'),
      (select valid_at + interval '3 hours' from schedule_clock),
      array[(select id from public.services where name = 'Servico Expediente')]
    )$$,
  '55000',
  'client ' || (select id from public.clients where name = 'Cliente Expediente Inativa') || ' is inactive',
  'novo agendamento para cliente inativa continua proibido'
);

select * from finish();
rollback;
