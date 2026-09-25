begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select is(
  (
    select is_nullable::text
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'booking_services'
      and column_name = 'estimated_duration_minutes'
  ),
  'YES'::text,
  'snapshot de duracao do servico planejado aceita null'
);

insert into auth.users (id, email)
values ('b5000000-0000-4000-8000-000000000005', 'manual.duration@example.test');

insert into agenda_salao_private.salon_users (user_id)
values ('b5000000-0000-4000-8000-000000000005');

delete from public.schedule_blocks;

update public.business_hours
set is_open = true,
    opens_at = time '00:00',
    closes_at = time '23:59:59.999999',
    break_starts_at = null,
    break_ends_at = null;

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"b5000000-0000-4000-8000-000000000005","role":"authenticated"}';

insert into public.clients (name, phone)
values ('Cliente Duracao Manual', '+55 11 95555-5005');

insert into public.services (
  name,
  estimated_duration_minutes,
  suggested_return_months,
  active
)
values
  ('Alisamento Teste Manual', null, 3, true),
  ('Botox Teste Manual', null, 3, true),
  ('Servico Teste Com Duracao', 45, null, true);

create temporary table manual_duration_clock as
select date_trunc('day', statement_timestamp() + interval '45 days')
       + interval '10 hours' as base_at;

select lives_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Duracao Manual'),
      (select base_at from manual_duration_clock),
      array[(select id from public.services where name = 'Alisamento Teste Manual')],
      120,
      'Alisamento com duracao manual'
    )$$,
  'Alisamento sem duracao padrao aceita duracao manual'
);

select is(
  (
    select ends_at - starts_at
    from public.bookings
    where notes = 'Alisamento com duracao manual'
  ),
  interval '120 minutes',
  'duracao manual do Alisamento define o intervalo total'
);

select is(
  (
    select estimated_duration_minutes
    from public.booking_services
    where booking_id = (
      select id
      from public.bookings
      where notes = 'Alisamento com duracao manual'
    )
  ),
  null::smallint,
  'snapshot do Alisamento preserva a ausencia de duracao padrao'
);

select lives_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Duracao Manual'),
      (select base_at + interval '3 hours' from manual_duration_clock),
      array[(select id from public.services where name = 'Botox Teste Manual')],
      90,
      'Botox com duracao manual'
    )$$,
  'Botox sem duracao padrao aceita duracao manual'
);

select is(
  (
    select ends_at - starts_at
    from public.bookings
    where notes = 'Botox com duracao manual'
  ),
  interval '90 minutes',
  'duracao manual do Botox define o intervalo total'
);

select throws_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Duracao Manual'),
      (select base_at + interval '6 hours' from manual_duration_clock),
      array[(select id from public.services where name = 'Alisamento Teste Manual')],
      null,
      'Sem duracao manual'
    )$$,
  '22023',
  'p_duration_minutes is required when a service has no estimated duration',
  'servico sem padrao e sem duracao manual e rejeitado'
);

select lives_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Duracao Manual'),
      (select base_at + interval '9 hours' from manual_duration_clock),
      array[(select id from public.services where name = 'Servico Teste Com Duracao')],
      null,
      'Servico com duracao automatica'
    )$$,
  'servico com duracao padrao continua funcionando sem duracao manual'
);

select is(
  (
    select ends_at - starts_at
    from public.bookings
    where notes = 'Servico com duracao automatica'
  ),
  interval '45 minutes',
  'duracao padrao continua calculando o intervalo reservado'
);

select throws_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Duracao Manual'),
      (select base_at + interval '30 minutes' from manual_duration_clock),
      array[(select id from public.services where name = 'Servico Teste Com Duracao')],
      null,
      'Conflito com duracao manual'
    )$$,
  '23P01',
  'booking time conflicts with another active booking',
  'sobreposicao com agendamento de duracao manual continua bloqueada'
);

select * from finish();
rollback;
