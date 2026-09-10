begin;

create extension if not exists pgtap with schema extensions;
select plan(102);

-- Public API and privilege shape.
select has_function('public', 'create_booking',
  array['bigint', 'timestamp with time zone', 'bigint[]', 'integer', 'text'],
  'create_booking possui a assinatura publica esperada');
select has_function('public', 'update_booking',
  array['bigint', 'bigint', 'timestamp with time zone', 'bigint[]', 'integer', 'text'],
  'update_booking possui a assinatura publica esperada');
select has_function('public', 'confirm_booking', array['bigint'],
  'confirm_booking existe');
select has_function('public', 'cancel_booking', array['bigint'],
  'cancel_booking existe');
select has_function('public', 'mark_booking_no_show', array['bigint'],
  'mark_booking_no_show existe');

select ok(
  not (select prosecdef from pg_proc
       where oid = 'public.create_booking(bigint,timestamptz,bigint[],integer,text)'::regprocedure),
  'create_booking publico usa security invoker'
);
select ok(
  not (select prosecdef from pg_proc
       where oid = 'public.update_booking(bigint,bigint,timestamptz,bigint[],integer,text)'::regprocedure),
  'update_booking publico usa security invoker'
);
select ok(
  not (select prosecdef from pg_proc
       where oid = 'public.confirm_booking(bigint)'::regprocedure),
  'confirm_booking publico usa security invoker'
);
select ok(
  not (select prosecdef from pg_proc
       where oid = 'public.cancel_booking(bigint)'::regprocedure),
  'cancel_booking publico usa security invoker'
);
select ok(
  not (select prosecdef from pg_proc
       where oid = 'public.mark_booking_no_show(bigint)'::regprocedure),
  'mark_booking_no_show publico usa security invoker'
);

select ok(
  (select prosecdef from pg_proc
   where oid = 'agenda_salao_private.create_booking(bigint,timestamptz,bigint[],integer,text)'::regprocedure),
  'implementacao privada de create_booking usa security definer'
);
select ok(
  (select prosecdef from pg_proc
   where oid = 'agenda_salao_private.update_booking(bigint,bigint,timestamptz,bigint[],integer,text)'::regprocedure),
  'implementacao privada de update_booking usa security definer'
);
select ok(
  (select prosecdef from pg_proc
   where oid = 'agenda_salao_private.transition_booking_status(bigint,text)'::regprocedure),
  'implementacao privada de transicao usa security definer'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'agenda_salao_private'
      and p.proname in (
        'validate_booking_request',
        'create_booking',
        'update_booking',
        'transition_booking_status'
      )
      and coalesce(array_to_string(p.proconfig, ','), '')
          not like '%search_path=""%'
  ),
  'funcoes privadas usam search_path vazio'
);
select ok(
  not exists (
    select 1
    from information_schema.routine_privileges
    where routine_schema = 'agenda_salao_private'
      and routine_name in (
        'validate_booking_request',
        'create_booking',
        'update_booking',
        'transition_booking_status'
      )
      and grantee = 'PUBLIC'
      and privilege_type = 'EXECUTE'
  ),
  'PUBLIC nao executa funcoes privadas'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.create_booking(bigint,timestamptz,bigint[],integer,text)',
    'execute'
  ),
  'authenticated executa create_booking publico'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.create_booking(bigint,timestamptz,bigint[],integer,text)',
    'execute'
  ),
  'anon nao executa create_booking publico'
);

-- Fixtures use only fictional records and a dynamic future anchor.
insert into auth.users (id, email)
values
  ('b0000000-0000-4000-8000-00000000000b', 'operations.salao@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'operations.nao.autorizada@example.test');

insert into agenda_salao_private.salon_users (user_id)
values ('b0000000-0000-4000-8000-00000000000b');

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"b0000000-0000-4000-8000-00000000000b","role":"authenticated"}';

create temporary table booking_test_clock as
select date_trunc('day', statement_timestamp() + interval '30 days')
       + interval '9 hours' as base_at;

insert into public.clients (name, phone, active)
values
  ('Cliente Operacoes A', '+55 11 94444-0001', true),
  ('Cliente Operacoes B', '+55 11 94444-0002', true),
  ('Cliente Operacoes Inativa', '+55 11 94444-0003', false);

insert into public.services (
  name, suggested_return_months, estimated_duration_minutes, active
)
values
  ('Servico Operacoes 30', 1, 30, true),
  ('Servico Operacoes 60', 2, 60, true),
  ('Servico Operacoes 90', 3, 90, true),
  ('Servico Operacoes Inativo', 4, 45, false),
  ('Servico Operacoes Sem Duracao', 5, null, true);

-- create_booking: calculated and manual durations, snapshots and validation.
select is(
  (
    select booking_status
    from public.create_booking(
      (select id from public.clients where name = 'Cliente Operacoes A'),
      (select base_at from booking_test_clock),
      array[(select id from public.services where name = 'Servico Operacoes 60')],
      null,
      'Create um servico'
    )
  ),
  'scheduled'::text,
  'create_booking inicia em scheduled'
);
select is(
  (select ends_at - starts_at
   from public.bookings where notes = 'Create um servico'),
  interval '60 minutes',
  'um servico calcula ends_at pela duracao catalogada'
);
select results_eq(
  $$select service_name, estimated_duration_minutes
    from public.booking_services
    where booking_id = (
      select id from public.bookings where notes = 'Create um servico'
    )$$,
  $$values ('Servico Operacoes 60'::text, 60::smallint)$$,
  'create_booking copia snapshots sem recebe-los do frontend'
);

select is(
  (
    select service_count
    from public.create_booking(
      (select id from public.clients where name = 'Cliente Operacoes A'),
      (select base_at + interval '3 hours' from booking_test_clock),
      array[
        (select id from public.services where name = 'Servico Operacoes 60'),
        (select id from public.services where name = 'Servico Operacoes 90')
      ],
      null,
      'Create varios servicos'
    )
  ),
  2,
  'create_booking aceita varios servicos'
);
select is(
  (select ends_at - starts_at
   from public.bookings where notes = 'Create varios servicos'),
  interval '150 minutes',
  'varios servicos somam as duracoes'
);
select is(
  (select count(*) from public.booking_services
   where booking_id = (
     select id from public.bookings where notes = 'Create varios servicos'
   )),
  2::bigint,
  'varios servicos geram todos os snapshots'
);

select lives_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Operacoes A'),
      (select base_at + interval '6 hours' from booking_test_clock),
      array[
        (select id from public.services where name = 'Servico Operacoes 60'),
        (select id from public.services where name = 'Servico Operacoes 90')
      ],
      45,
      'Create duracao manual'
    )$$,
  'create_booking aceita duracao manual positiva'
);
select is(
  (select ends_at - starts_at
   from public.bookings where notes = 'Create duracao manual'),
  interval '45 minutes',
  'duracao manual substitui a soma no intervalo reservado'
);
select is(
  (select sum(estimated_duration_minutes)::integer
   from public.booking_services
   where booking_id = (
     select id from public.bookings where notes = 'Create duracao manual'
   )),
  150,
  'duracao manual nao adultera snapshots dos servicos'
);

select throws_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Operacoes A'),
      (select base_at + interval '8 hours' from booking_test_clock),
      array[(select id from public.services where name = 'Servico Operacoes 30')],
      0
    )$$,
  '22023', 'p_duration_minutes must be greater than zero',
  'create_booking rejeita duracao manual zero'
);
select throws_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Operacoes A'),
      (select base_at + interval '8 hours' from booking_test_clock),
      array[(select id from public.services where name = 'Servico Operacoes 30')],
      -1
    )$$,
  '22023', 'p_duration_minutes must be greater than zero',
  'create_booking rejeita duracao manual negativa'
);
select throws_ok(
  $$select * from public.create_booking(
      999999999,
      (select base_at + interval '8 hours' from booking_test_clock),
      array[(select id from public.services where name = 'Servico Operacoes 30')]
    )$$,
  '23503', 'client 999999999 does not exist',
  'create_booking rejeita cliente inexistente'
);
select throws_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Operacoes Inativa'),
      (select base_at + interval '8 hours' from booking_test_clock),
      array[(select id from public.services where name = 'Servico Operacoes 30')]
    )$$,
  '55000',
  'client ' || (select id from public.clients where name = 'Cliente Operacoes Inativa') || ' is inactive',
  'create_booking rejeita cliente inativa'
);
select throws_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Operacoes A'),
      (select base_at + interval '8 hours' from booking_test_clock),
      array[]::bigint[]
    )$$,
  '22023', 'p_service_ids must contain at least one service',
  'create_booking rejeita lista vazia'
);
select throws_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Operacoes A'),
      (select base_at + interval '8 hours' from booking_test_clock),
      array[null]::bigint[]
    )$$,
  '22023', 'p_service_ids must not contain null values',
  'create_booking rejeita servico null'
);
select throws_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Operacoes A'),
      (select base_at + interval '8 hours' from booking_test_clock),
      array[
        (select id from public.services where name = 'Servico Operacoes 30'),
        (select id from public.services where name = 'Servico Operacoes 30')
      ]
    )$$,
  '22023', 'p_service_ids must not contain duplicate services',
  'create_booking rejeita servicos duplicados'
);
select throws_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Operacoes A'),
      (select base_at + interval '8 hours' from booking_test_clock),
      array[999999999::bigint]
    )$$,
  '23503', 'one or more services do not exist',
  'create_booking rejeita servico inexistente'
);
select throws_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Operacoes A'),
      (select base_at + interval '8 hours' from booking_test_clock),
      array[(select id from public.services where name = 'Servico Operacoes Inativo')]
    )$$,
  '55000', 'all services must be active',
  'create_booking rejeita servico inativo'
);
select throws_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Operacoes A'),
      (select base_at + interval '8 hours' from booking_test_clock),
      array[(select id from public.services where name = 'Servico Operacoes Sem Duracao')]
    )$$,
  '55000', 'all services must have an estimated duration',
  'create_booking rejeita servico sem duracao'
);
select throws_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Operacoes A'),
      statement_timestamp() - interval '1 minute',
      array[(select id from public.services where name = 'Servico Operacoes 30')]
    )$$,
  '22023', 'p_starts_at must be in the future',
  'create_booking rejeita horario no passado'
);

reset role;
alter table public.booking_services
add constraint test_reject_booking_snapshot
check (service_name <> 'Servico Operacoes 90') not valid;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"b0000000-0000-4000-8000-00000000000b","role":"authenticated"}';

create temporary table counts_before_snapshot_failure as
select
  (select count(*) from public.bookings) as booking_count,
  (select count(*) from public.booking_services) as service_count;

select throws_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Operacoes A'),
      (select base_at + interval '9 hours' from booking_test_clock),
      array[(select id from public.services where name = 'Servico Operacoes 90')],
      null,
      'Nao deve sobreviver a falha de snapshot'
    )$$,
  '23514',
  'new row for relation "booking_services" violates check constraint "test_reject_booking_snapshot"',
  'falha ao criar snapshot desfaz a operacao'
);
select is(
  (select count(*) from public.bookings),
  (select booking_count from counts_before_snapshot_failure),
  'falha de snapshot nao deixa booking parcial'
);
select is(
  (select count(*) from public.booking_services),
  (select service_count from counts_before_snapshot_failure),
  'falha de snapshot nao deixa booking_services parcial'
);

reset role;
alter table public.booking_services
drop constraint test_reject_booking_snapshot;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"b0000000-0000-4000-8000-00000000000b","role":"authenticated"}';

create temporary table counts_before_conflict as
select
  (select count(*) from public.bookings) as booking_count,
  (select count(*) from public.booking_services) as service_count;

select throws_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Operacoes A'),
      (select base_at + interval '30 minutes' from booking_test_clock),
      array[(select id from public.services where name = 'Servico Operacoes 60')]
    )$$,
  '23P01', 'booking time conflicts with another active booking',
  'create_booking traduz conflito para erro de dominio'
);
select is(
  (select count(*) from public.bookings),
  (select booking_count from counts_before_conflict),
  'conflito nao deixa booking parcial'
);
select is(
  (select count(*) from public.booking_services),
  (select service_count from counts_before_conflict),
  'conflito nao deixa snapshots parciais'
);

-- update_booking replaces the editable plan atomically.
create temporary table update_original_status_time as
select status_updated_at
from public.bookings
where notes = 'Create um servico';

select is(
  (
    select booking_client_id
    from public.update_booking(
      (select id from public.bookings where notes = 'Create um servico'),
      (select id from public.clients where name = 'Cliente Operacoes B'),
      (select base_at + interval '1 day' from booking_test_clock),
      array[
        (select id from public.services where name = 'Servico Operacoes 30'),
        (select id from public.services where name = 'Servico Operacoes 90')
      ],
      null,
      'Update completo'
    )
  ),
  (select id from public.clients where name = 'Cliente Operacoes B'),
  'update_booking altera cliente'
);
select is(
  (select starts_at from public.bookings where notes = 'Update completo'),
  (select base_at + interval '1 day' from booking_test_clock),
  'update_booking altera data e hora'
);
select is(
  (select ends_at - starts_at from public.bookings where notes = 'Update completo'),
  interval '120 minutes',
  'update_booking recalcula ends_at'
);
select is(
  (select status from public.bookings where notes = 'Update completo'),
  'scheduled'::text,
  'update_booking preserva scheduled'
);
select is(
  (select status_updated_at from public.bookings where notes = 'Update completo'),
  (select status_updated_at from update_original_status_time),
  'edicao simples preserva status_updated_at'
);
select results_eq(
  $$select service_name, estimated_duration_minutes
    from public.booking_services
    where booking_id = (
      select id from public.bookings where notes = 'Update completo'
    )
    order by estimated_duration_minutes$$,
  $$values
      ('Servico Operacoes 30'::text, 30::smallint),
      ('Servico Operacoes 90'::text, 90::smallint)$$,
  'update_booking remove, adiciona e regenera snapshots'
);
select is(
  (select count(*) from public.booking_services bs
   join public.services s on s.id = bs.service_id
   where bs.booking_id = (
     select id from public.bookings where notes = 'Update completo'
   ) and s.name = 'Servico Operacoes 60'),
  0::bigint,
  'update_booking remove o servico antigo'
);

select lives_ok(
  $$select * from public.update_booking(
      (select id from public.bookings where notes = 'Update completo'),
      (select id from public.clients where name = 'Cliente Operacoes B'),
      (select base_at + interval '1 day 3 hours' from booking_test_clock),
      array[(select id from public.services where name = 'Servico Operacoes 90')],
      35,
      'Update manual'
    )$$,
  'update_booking aceita duracao manual'
);
select is(
  (select ends_at - starts_at from public.bookings where notes = 'Update manual'),
  interval '35 minutes',
  'update_booking usa duracao manual no intervalo'
);

reset role;
update public.bookings
set status_updated_at = timestamptz '2000-01-01 00:00:00+00'
where notes = 'Create varios servicos';
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"b0000000-0000-4000-8000-00000000000b","role":"authenticated"}';

select is(
  (select booking_status from public.confirm_booking(
    (select id from public.bookings where notes = 'Create varios servicos')
  )),
  'confirmed'::text,
  'confirm_booking realiza scheduled para confirmed'
);
select ok(
  (select status_updated_at > timestamptz '2000-01-01 00:00:00+00'
   from public.bookings
   where notes = 'Create varios servicos'),
  'primeira confirmacao atualiza status_updated_at'
);
create temporary table confirmed_status_time as
select status_updated_at, updated_at
from public.bookings
where notes = 'Create varios servicos';

select is(
  (
    select booking_status
    from public.update_booking(
      (select id from public.bookings where notes = 'Create varios servicos'),
      (select id from public.clients where name = 'Cliente Operacoes A'),
      (select base_at + interval '2 days' from booking_test_clock),
      array[(select id from public.services where name = 'Servico Operacoes 30')],
      null,
      'Update confirmado'
    )
  ),
  'confirmed'::text,
  'update_booking preserva confirmed'
);
select is(
  (select status_updated_at from public.bookings where notes = 'Update confirmado'),
  (select status_updated_at from confirmed_status_time),
  'editar confirmed nao muda status_updated_at'
);

-- Terminal rows are owner fixtures because completion is intentionally absent.
reset role;
insert into public.bookings (client_id, starts_at, ends_at, status, notes)
select c.id, t.base_at + offsets.start_offset,
       t.base_at + offsets.end_offset, offsets.booking_status, offsets.note
from public.clients c
cross join booking_test_clock t
cross join (values
  (interval '3 days', interval '3 days 1 hour', 'completed', 'Terminal completed'),
  (interval '3 days 2 hours', interval '3 days 3 hours', 'cancelled', 'Terminal cancelled'),
  (interval '3 days 4 hours', interval '3 days 5 hours', 'no_show', 'Terminal no_show')
) as offsets(start_offset, end_offset, booking_status, note)
where c.name = 'Cliente Operacoes A';
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"b0000000-0000-4000-8000-00000000000b","role":"authenticated"}';

select throws_ok(
  $$select * from public.update_booking(
      (select id from public.bookings where notes = 'Terminal completed'),
      (select id from public.clients where name = 'Cliente Operacoes A'),
      (select base_at + interval '4 days' from booking_test_clock),
      array[(select id from public.services where name = 'Servico Operacoes 30')]
    )$$,
  '55000',
  'booking ' || (select id from public.bookings where notes = 'Terminal completed')
    || ' in status completed cannot be edited',
  'update_booking rejeita completed'
);
select throws_ok(
  $$select * from public.update_booking(
      (select id from public.bookings where notes = 'Terminal cancelled'),
      (select id from public.clients where name = 'Cliente Operacoes A'),
      (select base_at + interval '4 days' from booking_test_clock),
      array[(select id from public.services where name = 'Servico Operacoes 30')]
    )$$,
  '55000',
  'booking ' || (select id from public.bookings where notes = 'Terminal cancelled')
    || ' in status cancelled cannot be edited',
  'update_booking rejeita cancelled'
);
select throws_ok(
  $$select * from public.update_booking(
      (select id from public.bookings where notes = 'Terminal no_show'),
      (select id from public.clients where name = 'Cliente Operacoes A'),
      (select base_at + interval '4 days' from booking_test_clock),
      array[(select id from public.services where name = 'Servico Operacoes 30')]
    )$$,
  '55000',
  'booking ' || (select id from public.bookings where notes = 'Terminal no_show')
    || ' in status no_show cannot be edited',
  'update_booking rejeita no_show'
);
select throws_ok(
  $$select * from public.update_booking(
      (select id from public.bookings where notes = 'Update manual'),
      (select id from public.clients where name = 'Cliente Operacoes B'),
      statement_timestamp() - interval '1 minute',
      array[(select id from public.services where name = 'Servico Operacoes 90')]
    )$$,
  '22023', 'p_starts_at must be in the future',
  'update_booking nao move booking para o passado'
);

-- Conflicting update rolls back both parent and snapshots.
select lives_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Operacoes A'),
      (select base_at + interval '5 days' from booking_test_clock),
      array[(select id from public.services where name = 'Servico Operacoes 30')],
      null,
      'Update conflito origem'
    )$$,
  'fixture editavel para conflito foi criada'
);
select lives_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Operacoes A'),
      (select base_at + interval '5 days 2 hours' from booking_test_clock),
      array[(select id from public.services where name = 'Servico Operacoes 60')],
      null,
      'Update conflito destino'
    )$$,
  'fixture ocupada para conflito foi criada'
);
select throws_ok(
  $$select * from public.update_booking(
      (select id from public.bookings where notes = 'Update conflito origem'),
      (select id from public.clients where name = 'Cliente Operacoes B'),
      (select base_at + interval '5 days 2 hours' from booking_test_clock),
      array[(select id from public.services where name = 'Servico Operacoes 90')],
      null,
      'Nao deve persistir'
    )$$,
  '23P01', 'booking time conflicts with another active booking',
  'update_booking traduz conflito para erro de dominio'
);
select is(
  (select notes from public.bookings where notes = 'Update conflito origem'),
  'Update conflito origem'::text,
  'conflito de edicao preserva o booking original'
);
select results_eq(
  $$select s.name
    from public.booking_services bs
    join public.services s on s.id = bs.service_id
    where bs.booking_id = (
      select id from public.bookings where notes = 'Update conflito origem'
    )$$,
  $$values ('Servico Operacoes 30'::text)$$,
  'conflito de edicao preserva snapshots originais'
);

-- confirm_booking idempotency and invalid terminal transitions.
create temporary table first_confirmation as
select status_updated_at, updated_at
from public.bookings
where notes = 'Update confirmado';

select is(
  (select booking_status from public.confirm_booking(
    (select id from public.bookings where notes = 'Update confirmado')
  )),
  'confirmed'::text,
  'segunda confirmacao e idempotente'
);
select is(
  (select status_updated_at from public.bookings where notes = 'Update confirmado'),
  (select status_updated_at from first_confirmation),
  'segunda confirmacao preserva status_updated_at'
);
select is(
  (select updated_at from public.bookings where notes = 'Update confirmado'),
  (select updated_at from first_confirmation),
  'segunda confirmacao preserva updated_at'
);
select throws_ok(
  $$select * from public.confirm_booking(
      (select id from public.bookings where notes = 'Terminal cancelled')
    )$$,
  '55000',
  'booking ' || (select id from public.bookings where notes = 'Terminal cancelled')
    || ' cannot transition from cancelled to confirmed',
  'cancelled nao pode ser confirmado'
);
select throws_ok(
  $$select * from public.confirm_booking(
      (select id from public.bookings where notes = 'Terminal no_show')
    )$$,
  '55000',
  'booking ' || (select id from public.bookings where notes = 'Terminal no_show')
    || ' cannot transition from no_show to confirmed',
  'no_show nao pode ser confirmado'
);
select throws_ok(
  $$select * from public.confirm_booking(
      (select id from public.bookings where notes = 'Terminal completed')
    )$$,
  '55000',
  'booking ' || (select id from public.bookings where notes = 'Terminal completed')
    || ' cannot transition from completed to confirmed',
  'completed nao pode ser confirmado'
);

-- cancel_booking releases time without producing performed work.
select lives_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Operacoes A'),
      (select base_at + interval '6 days' from booking_test_clock),
      array[(select id from public.services where name = 'Servico Operacoes 30')],
      null,
      'Cancelar scheduled'
    )$$,
  'fixture scheduled para cancelamento foi criada'
);
select is(
  (select booking_status from public.cancel_booking(
    (select id from public.bookings where notes = 'Cancelar scheduled')
  )),
  'cancelled'::text,
  'cancel_booking realiza scheduled para cancelled'
);
select is(
  (select booking_status from public.cancel_booking(
    (select id from public.bookings where notes = 'Update confirmado')
  )),
  'cancelled'::text,
  'cancel_booking realiza confirmed para cancelled'
);
create temporary table first_cancellation as
select status_updated_at, updated_at
from public.bookings
where notes = 'Cancelar scheduled';
select is(
  (select booking_status from public.cancel_booking(
    (select id from public.bookings where notes = 'Cancelar scheduled')
  )),
  'cancelled'::text,
  'cancelamento repetido e idempotente'
);
select results_eq(
  $$select status_updated_at, updated_at
    from public.bookings where notes = 'Cancelar scheduled'$$,
  $$select status_updated_at, updated_at from first_cancellation$$,
  'cancelamento repetido preserva timestamps'
);
select throws_ok(
  $$select * from public.cancel_booking(
      (select id from public.bookings where notes = 'Terminal completed')
    )$$,
  '55000',
  'booking ' || (select id from public.bookings where notes = 'Terminal completed')
    || ' cannot transition from completed to cancelled',
  'completed nao pode ser cancelado'
);
select throws_ok(
  $$select * from public.cancel_booking(
      (select id from public.bookings where notes = 'Terminal no_show')
    )$$,
  '55000',
  'booking ' || (select id from public.bookings where notes = 'Terminal no_show')
    || ' cannot transition from no_show to cancelled',
  'no_show nao pode ser cancelado'
);
select lives_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Operacoes B'),
      (select base_at + interval '6 days' from booking_test_clock),
      array[(select id from public.services where name = 'Servico Operacoes 30')],
      null,
      'Horario liberado apos cancelar'
    )$$,
  'cancelamento libera o horario'
);
select is((select count(*) from public.appointments), 0::bigint,
  'cancelamento nao cria appointment');
select is((select count(*) from public.returns), 0::bigint,
  'cancelamento nao cria return');

-- no_show uses database time and never creates performed work.
reset role;
insert into public.bookings (client_id, starts_at, ends_at, status, notes)
select c.id,
       statement_timestamp() + states.start_offset,
       statement_timestamp() + states.end_offset,
       states.booking_status,
       states.note
from public.clients c
cross join (values
  (interval '-4 hours', interval '-3 hours', 'scheduled', 'No show scheduled passado'),
  (interval '-2 hours', interval '-1 hour', 'confirmed', 'No show confirmed passado')
) as states(start_offset, end_offset, booking_status, note)
where c.name = 'Cliente Operacoes A';
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"b0000000-0000-4000-8000-00000000000b","role":"authenticated"}';

select is(
  (select booking_status from public.mark_booking_no_show(
    (select id from public.bookings where notes = 'No show scheduled passado')
  )),
  'no_show'::text,
  'scheduled iniciado pode virar no_show'
);
select is(
  (select booking_status from public.mark_booking_no_show(
    (select id from public.bookings where notes = 'No show confirmed passado')
  )),
  'no_show'::text,
  'confirmed iniciado pode virar no_show'
);
create temporary table first_no_show as
select status_updated_at, updated_at
from public.bookings
where notes = 'No show scheduled passado';
select is(
  (select booking_status from public.mark_booking_no_show(
    (select id from public.bookings where notes = 'No show scheduled passado')
  )),
  'no_show'::text,
  'no_show repetido e idempotente'
);
select results_eq(
  $$select status_updated_at, updated_at from public.bookings
    where notes = 'No show scheduled passado'$$,
  $$select status_updated_at, updated_at from first_no_show$$,
  'no_show repetido preserva timestamps'
);
select throws_ok(
  $$select * from public.mark_booking_no_show(
      (select id from public.bookings where notes = 'Create duracao manual')
    )$$,
  '55000', 'booking cannot be marked no_show before starts_at',
  'no_show antes de starts_at e rejeitado pelo horario do banco'
);
select throws_ok(
  $$select * from public.mark_booking_no_show(
      (select id from public.bookings where notes = 'Terminal cancelled')
    )$$,
  '55000',
  'booking ' || (select id from public.bookings where notes = 'Terminal cancelled')
    || ' cannot transition from cancelled to no_show',
  'cancelled nao pode virar no_show'
);
select throws_ok(
  $$select * from public.mark_booking_no_show(
      (select id from public.bookings where notes = 'Terminal completed')
    )$$,
  '55000',
  'booking ' || (select id from public.bookings where notes = 'Terminal completed')
    || ' cannot transition from completed to no_show',
  'completed nao pode virar no_show'
);
select is((select count(*) from public.appointments), 0::bigint,
  'no_show nao cria appointment');
select is((select count(*) from public.returns), 0::bigint,
  'no_show nao cria return');

-- Direct writes remain blocked after the RPC grants.
select throws_ok(
  $$insert into public.bookings (client_id, starts_at, ends_at)
    values (999999999, now(), now() + interval '1 hour')$$,
  '42501', 'permission denied for table bookings',
  'frontend continua sem insert direto em bookings'
);
select throws_ok(
  $$update public.booking_services set service_name = 'Forjado'$$,
  '42501', 'permission denied for table booking_services',
  'frontend continua sem update direto em booking_services'
);

-- Authenticated non-members reach wrappers but fail the explicit private check.
set local "request.jwt.claims" =
  '{"sub":"c0000000-0000-4000-8000-00000000000c","role":"authenticated"}';
select throws_ok(
  $$select * from public.create_booking(999999999, now() + interval '1 day', array[999999999::bigint])$$,
  '42501', 'only the authorized salon account can create bookings',
  'authenticated fora da allowlist nao cria booking'
);
select throws_ok(
  $$select * from public.update_booking(999999999, 999999999, now() + interval '1 day', array[999999999::bigint])$$,
  '42501', 'only the authorized salon account can update bookings',
  'authenticated fora da allowlist nao edita booking'
);
select throws_ok(
  $$select * from public.confirm_booking(999999999)$$,
  '42501', 'only the authorized salon account can change booking status',
  'authenticated fora da allowlist nao confirma booking'
);
select throws_ok(
  $$select * from public.cancel_booking(999999999)$$,
  '42501', 'only the authorized salon account can change booking status',
  'authenticated fora da allowlist nao cancela booking'
);
select throws_ok(
  $$select * from public.mark_booking_no_show(999999999)$$,
  '42501', 'only the authorized salon account can change booking status',
  'authenticated fora da allowlist nao marca falta'
);

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(
  $$select * from public.create_booking(999999999, now() + interval '1 day', array[999999999::bigint])$$,
  '42501', 'permission denied for function create_booking',
  'anon nao executa create_booking'
);
select throws_ok(
  $$select * from public.update_booking(999999999, 999999999, now() + interval '1 day', array[999999999::bigint])$$,
  '42501', 'permission denied for function update_booking',
  'anon nao executa update_booking'
);
select throws_ok(
  $$select * from public.confirm_booking(999999999)$$,
  '42501', 'permission denied for function confirm_booking',
  'anon nao executa confirm_booking'
);
select throws_ok(
  $$select * from public.cancel_booking(999999999)$$,
  '42501', 'permission denied for function cancel_booking',
  'anon nao executa cancel_booking'
);
select throws_ok(
  $$select * from public.mark_booking_no_show(999999999)$$,
  '42501', 'permission denied for function mark_booking_no_show',
  'anon nao executa mark_booking_no_show'
);

select * from finish();
rollback;
