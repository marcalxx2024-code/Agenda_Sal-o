begin;

create extension if not exists pgtap with schema extensions;
select plan(55);

-- Structure and column contracts.
select has_table('public', 'bookings', 'bookings existe');
select has_table('public', 'booking_services', 'booking_services existe');
select columns_are(
  'public',
  'bookings',
  array[
    'id',
    'client_id',
    'starts_at',
    'ends_at',
    'status',
    'notes',
    'status_updated_at',
    'created_at',
    'updated_at'
  ],
  'bookings possui somente as colunas esperadas'
);
select columns_are(
  'public',
  'booking_services',
  array[
    'id',
    'booking_id',
    'service_id',
    'service_name',
    'estimated_duration_minutes',
    'created_at'
  ],
  'booking_services possui somente as colunas esperadas'
);
select has_column(
  'public',
  'appointments',
  'booking_id',
  'appointments possui booking_id'
);
select col_is_null(
  'public',
  'appointments',
  'booking_id',
  'appointments.booking_id permite null'
);
select col_is_unique(
  'public',
  'appointments',
  'booking_id',
  'appointments.booking_id e unique'
);
select fk_ok(
  'public', 'bookings', 'client_id',
  'public', 'clients', 'id',
  'bookings referencia clients'
);
select fk_ok(
  'public', 'booking_services', 'booking_id',
  'public', 'bookings', 'id',
  'booking_services referencia bookings'
);
select fk_ok(
  'public', 'booking_services', 'service_id',
  'public', 'services', 'id',
  'booking_services referencia services'
);
select fk_ok(
  'public', 'appointments', 'booking_id',
  'public', 'bookings', 'id',
  'appointments referencia bookings'
);
select is(
  (select confdeltype::text
   from pg_constraint
   where conname = 'bookings_client_id_fkey'
     and conrelid = 'public.bookings'::regclass),
  'r'::text,
  'cliente com booking relacionado usa on delete restrict'
);
select is(
  (select confdeltype::text
   from pg_constraint
   where conname = 'booking_services_booking_id_fkey'
     and conrelid = 'public.booking_services'::regclass),
  'r'::text,
  'booking com snapshot relacionado usa on delete restrict'
);
select is(
  (select confdeltype::text
   from pg_constraint
   where conname = 'booking_services_service_id_fkey'
     and conrelid = 'public.booking_services'::regclass),
  'r'::text,
  'servico com snapshot relacionado usa on delete restrict'
);
select is(
  (select confdeltype::text
   from pg_constraint
   where conname = 'appointments_booking_id_fkey'
     and conrelid = 'public.appointments'::regclass),
  'r'::text,
  'booking ligado a atendimento usa on delete restrict'
);
select ok(
  (select relrowsecurity
   from pg_class
   where oid = 'public.bookings'::regclass),
  'RLS esta habilitada em bookings'
);
select ok(
  (select relrowsecurity
   from pg_class
   where oid = 'public.booking_services'::regclass),
  'RLS esta habilitada em booking_services'
);
select has_index(
  'public',
  'bookings',
  'bookings_starts_at_idx',
  'bookings possui indice por inicio'
);
select has_index(
  'public',
  'bookings',
  'bookings_client_id_idx',
  'bookings possui indice da FK de cliente'
);
select has_index(
  'public',
  'booking_services',
  'booking_services_service_id_idx',
  'booking_services possui indice da FK de servico'
);
select has_index(
  'public',
  'booking_services',
  'booking_services_one_service_per_booking',
  'a unicidade tambem indexa booking_id como primeira coluna'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'bookings_no_active_time_overlap'
      and contype = 'x'
  ),
  'bookings possui exclusao de horarios ativos sobrepostos'
);

-- Owner-level fixture data is used to exercise constraints because application
-- roles intentionally have read-only access in this stage.
insert into auth.users (id, email)
values
  ('90000000-0000-4000-8000-000000000009', 'booking.salao@example.test'),
  ('a0000000-0000-4000-8000-00000000000a', 'booking.nao.autorizada@example.test');

insert into agenda_salao_private.salon_users (user_id)
values ('90000000-0000-4000-8000-000000000009');

insert into public.clients (name, phone)
values ('Cliente Booking', '+55 11 95555-0001');

insert into public.services (
  name,
  suggested_return_months,
  estimated_duration_minutes
)
values ('Servico Booking', 3, 60);

select throws_ok(
  $$insert into public.bookings (client_id, starts_at, ends_at)
    values (
      (select id from public.clients where name = 'Cliente Booking'),
      timestamptz '2030-01-10 10:00:00-03',
      timestamptz '2030-01-10 10:00:00-03'
    )$$,
  '23514',
  'new row for relation "bookings" violates check constraint "bookings_valid_time_range"',
  'fim igual ao inicio e rejeitado'
);
select throws_ok(
  $$insert into public.bookings (client_id, starts_at, ends_at)
    values (
      (select id from public.clients where name = 'Cliente Booking'),
      timestamptz '2030-01-10 11:00:00-03',
      timestamptz '2030-01-10 10:00:00-03'
    )$$,
  '23514',
  'new row for relation "bookings" violates check constraint "bookings_valid_time_range"',
  'fim anterior ao inicio e rejeitado'
);
select throws_ok(
  $$insert into public.bookings (client_id, starts_at, ends_at, status)
    values (
      (select id from public.clients where name = 'Cliente Booking'),
      timestamptz '2030-01-10 11:00:00-03',
      timestamptz '2030-01-10 12:00:00-03',
      'invalid'
    )$$,
  '23514',
  'new row for relation "bookings" violates check constraint "bookings_status_check"',
  'status invalido e rejeitado'
);

insert into public.bookings (
  client_id,
  starts_at,
  ends_at,
  status,
  notes,
  status_updated_at,
  updated_at
)
values (
  (select id from public.clients where name = 'Cliente Booking'),
  timestamptz '2030-01-10 09:00:00-03',
  timestamptz '2030-01-10 10:00:00-03',
  'scheduled',
  'Horario base',
  timestamptz '2000-01-01 00:00:00+00',
  timestamptz '2000-01-01 00:00:00+00'
);

update public.bookings
set notes = notes
where notes = 'Horario base';

select ok(
  (select updated_at > timestamptz '2000-01-01 00:00:00+00'
   from public.bookings
   where notes = 'Horario base'),
  'updated_at reutiliza o trigger generico existente'
);
select is(
  (select status_updated_at
   from public.bookings
   where notes = 'Horario base'),
  timestamptz '2000-01-01 00:00:00+00',
  'status_updated_at nao muda quando o status permanece igual'
);

update public.bookings
set status = 'confirmed'
where notes = 'Horario base';

select ok(
  (select status_updated_at > timestamptz '2000-01-01 00:00:00+00'
   from public.bookings
   where notes = 'Horario base'),
  'status_updated_at muda junto com o status'
);

select throws_ok(
  $$insert into public.booking_services (
      booking_id, service_id, service_name, estimated_duration_minutes
    ) values (
      (select id from public.bookings where notes = 'Horario base'),
      (select id from public.services where name = 'Servico Booking'),
      'Servico Booking',
      0
    )$$,
  '23514',
  'new row for relation "booking_services" violates check constraint "booking_services_estimated_duration_minutes_check"',
  'snapshot com duracao zero e rejeitado'
);
select throws_ok(
  $$insert into public.booking_services (
      booking_id, service_id, service_name, estimated_duration_minutes
    ) values (
      (select id from public.bookings where notes = 'Horario base'),
      (select id from public.services where name = 'Servico Booking'),
      'Servico Booking',
      -1
    )$$,
  '23514',
  'new row for relation "booking_services" violates check constraint "booking_services_estimated_duration_minutes_check"',
  'snapshot com duracao negativa e rejeitado'
);

insert into public.booking_services (
  booking_id, service_id, service_name, estimated_duration_minutes
)
values (
  (select id from public.bookings where notes = 'Horario base'),
  (select id from public.services where name = 'Servico Booking'),
  'Servico Booking',
  60
);

select throws_ok(
  $$insert into public.booking_services (
      booking_id, service_id, service_name, estimated_duration_minutes
    ) values (
      (select id from public.bookings where notes = 'Horario base'),
      (select id from public.services where name = 'Servico Booking'),
      'Servico Booking',
      60
    )$$,
  '23505',
  'duplicate key value violates unique constraint "booking_services_one_service_per_booking"',
  'servico duplicado no mesmo booking e rejeitado'
);

-- Active intervals use [starts_at, ends_at), so overlap fails but adjacency is valid.
select throws_ok(
  $$insert into public.bookings (client_id, starts_at, ends_at, notes)
    values (
      (select id from public.clients where name = 'Cliente Booking'),
      timestamptz '2030-01-10 09:00:00-03',
      timestamptz '2030-01-10 10:00:00-03',
      'Sobreposicao total'
    )$$,
  '23P01',
  'conflicting key value violates exclusion constraint "bookings_no_active_time_overlap"',
  'sobreposicao total e rejeitada'
);
select throws_ok(
  $$insert into public.bookings (client_id, starts_at, ends_at, notes)
    values (
      (select id from public.clients where name = 'Cliente Booking'),
      timestamptz '2030-01-10 08:30:00-03',
      timestamptz '2030-01-10 09:30:00-03',
      'Sobreposicao no inicio'
    )$$,
  '23P01',
  'conflicting key value violates exclusion constraint "bookings_no_active_time_overlap"',
  'sobreposicao parcial no inicio e rejeitada'
);
select throws_ok(
  $$insert into public.bookings (client_id, starts_at, ends_at, notes)
    values (
      (select id from public.clients where name = 'Cliente Booking'),
      timestamptz '2030-01-10 09:30:00-03',
      timestamptz '2030-01-10 10:30:00-03',
      'Sobreposicao no fim'
    )$$,
  '23P01',
  'conflicting key value violates exclusion constraint "bookings_no_active_time_overlap"',
  'sobreposicao parcial no fim e rejeitada'
);
select throws_ok(
  $$insert into public.bookings (client_id, starts_at, ends_at, notes)
    values (
      (select id from public.clients where name = 'Cliente Booking'),
      timestamptz '2030-01-10 09:15:00-03',
      timestamptz '2030-01-10 09:45:00-03',
      'Intervalo contido'
    )$$,
  '23P01',
  'conflicting key value violates exclusion constraint "bookings_no_active_time_overlap"',
  'intervalo contido e rejeitado'
);
select lives_ok(
  $$insert into public.bookings (client_id, starts_at, ends_at, notes)
    values (
      (select id from public.clients where name = 'Cliente Booking'),
      timestamptz '2030-01-10 10:00:00-03',
      timestamptz '2030-01-10 11:00:00-03',
      'Horario adjacente'
    )$$,
  'horario adjacente e aceito'
);

insert into public.bookings (client_id, starts_at, ends_at, status, notes)
values
  (
    (select id from public.clients where name = 'Cliente Booking'),
    timestamptz '2030-01-10 12:00:00-03',
    timestamptz '2030-01-10 13:00:00-03',
    'cancelled',
    'Cancelado nao bloqueia'
  ),
  (
    (select id from public.clients where name = 'Cliente Booking'),
    timestamptz '2030-01-10 14:00:00-03',
    timestamptz '2030-01-10 15:00:00-03',
    'no_show',
    'Falta nao bloqueia'
  ),
  (
    (select id from public.clients where name = 'Cliente Booking'),
    timestamptz '2030-01-10 16:00:00-03',
    timestamptz '2030-01-10 17:00:00-03',
    'completed',
    'Concluido nao bloqueia'
  );

select lives_ok(
  $$insert into public.bookings (client_id, starts_at, ends_at, notes)
    values (
      (select id from public.clients where name = 'Cliente Booking'),
      timestamptz '2030-01-10 12:00:00-03',
      timestamptz '2030-01-10 13:00:00-03',
      'Sobre cancelado'
    )$$,
  'cancelled nao bloqueia horario'
);
select lives_ok(
  $$insert into public.bookings (client_id, starts_at, ends_at, notes)
    values (
      (select id from public.clients where name = 'Cliente Booking'),
      timestamptz '2030-01-10 14:00:00-03',
      timestamptz '2030-01-10 15:00:00-03',
      'Sobre falta'
    )$$,
  'no_show nao bloqueia horario'
);
select lives_ok(
  $$insert into public.bookings (client_id, starts_at, ends_at, notes)
    values (
      (select id from public.clients where name = 'Cliente Booking'),
      timestamptz '2030-01-10 16:00:00-03',
      timestamptz '2030-01-10 17:00:00-03',
      'Sobre concluido'
    )$$,
  'completed nao bloqueia horario'
);

-- Security: only allowlisted authenticated users can read, and nobody in the
-- frontend roles can mutate the new structures directly.
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"90000000-0000-4000-8000-000000000009","role":"authenticated"}';

select ok(
  (select count(*) > 0 from public.bookings),
  'salon_user autorizado consegue ler bookings'
);
select ok(
  (select count(*) > 0 from public.booking_services),
  'salon_user autorizado consegue ler booking_services'
);
select throws_ok(
  $$insert into public.bookings (client_id, starts_at, ends_at)
    values (999999999, now(), now() + interval '1 hour')$$,
  '42501',
  'permission denied for table bookings',
  'salon_user nao insere diretamente em bookings'
);
select throws_ok(
  $$update public.bookings set notes = 'Alteracao direta'$$,
  '42501',
  'permission denied for table bookings',
  'salon_user nao atualiza diretamente bookings'
);
select throws_ok(
  $$delete from public.bookings$$,
  '42501',
  'permission denied for table bookings',
  'salon_user nao apaga diretamente bookings'
);
select throws_ok(
  $$insert into public.booking_services (
      booking_id, service_id, service_name, estimated_duration_minutes
    ) values (999999999, 999999999, 'Direto', 60)$$,
  '42501',
  'permission denied for table booking_services',
  'salon_user nao insere diretamente em booking_services'
);
select throws_ok(
  $$update public.booking_services set service_name = 'Alteracao direta'$$,
  '42501',
  'permission denied for table booking_services',
  'salon_user nao atualiza diretamente booking_services'
);
select throws_ok(
  $$delete from public.booking_services$$,
  '42501',
  'permission denied for table booking_services',
  'salon_user nao apaga diretamente booking_services'
);
select throws_ok(
  $$update public.appointments set booking_id = null$$,
  '42501',
  'permission denied for table appointments',
  'salon_user nao altera appointments.booking_id diretamente'
);

set local "request.jwt.claims" =
  '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}';

select is(
  (select count(*) from public.bookings),
  0::bigint,
  'authenticated fora da allowlist nao le bookings'
);
select is(
  (select count(*) from public.booking_services),
  0::bigint,
  'authenticated fora da allowlist nao le booking_services'
);

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';

select throws_ok(
  $$select count(*) from public.bookings$$,
  '42501',
  'permission denied for table bookings',
  'anon nao le bookings'
);
select throws_ok(
  $$select count(*) from public.booking_services$$,
  '42501',
  'permission denied for table booking_services',
  'anon nao le booking_services'
);

-- Regression: the existing RPC still creates an unlinked walk-in appointment
-- and its return through the original trigger chain.
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"90000000-0000-4000-8000-000000000009","role":"authenticated"}';

select lives_ok(
  $$select * from public.create_appointment_with_services(
      (select id from public.clients where name = 'Cliente Booking'),
      date '2030-01-10',
      array[(select id from public.services where name = 'Servico Booking')],
      'Atendimento avulso'
    )$$,
  'RPC atual continua criando atendimento avulso'
);
select is(
  (select booking_id
   from public.appointments
   where notes = 'Atendimento avulso'),
  null::bigint,
  'atendimento avulso permanece com booking_id null'
);
select is(
  (select count(*)
   from public.returns r
   join public.appointment_services aps
     on aps.id = r.appointment_service_id
   join public.appointments a
     on a.id = aps.appointment_id
   where a.notes = 'Atendimento avulso'),
  1::bigint,
  'atendimento avulso continua gerando retorno'
);

select * from finish();
rollback;
