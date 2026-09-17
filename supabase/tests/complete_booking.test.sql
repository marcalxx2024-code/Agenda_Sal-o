begin;

create extension if not exists pgtap with schema extensions;
select plan(74);

-- Legacy scenarios create bookings through the public RPC and then complete
-- them immediately. Shift only this test's inserted fixtures to the past so
-- they exercise completion after the new database clock guard.
create function pg_temp.shift_complete_fixture_to_past()
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

create trigger complete_test_make_due
after insert on public.bookings
for each row execute function pg_temp.shift_complete_fixture_to_past();

-- Public/private API and privilege shape.
select has_function(
  'public',
  'complete_booking',
  array['bigint', 'date', 'bigint[]', 'text'],
  'complete_booking possui a assinatura publica esperada'
);
select ok(
  not (select prosecdef from pg_proc
       where oid = 'public.complete_booking(bigint,date,bigint[],text)'::regprocedure),
  'complete_booking publico usa security invoker'
);
select ok(
  (select prosecdef from pg_proc
   where oid = 'agenda_salao_private.complete_booking(bigint,date,bigint[],text)'::regprocedure),
  'complete_booking privado usa security definer'
);
select ok(
  coalesce((
    select array_to_string(proconfig, ',') like '%search_path=""%'
    from pg_proc
    where oid = 'agenda_salao_private.complete_booking(bigint,date,bigint[],text)'::regprocedure
  ), false),
  'complete_booking privado usa search_path vazio'
);
select ok(
  not exists (
    select 1
    from information_schema.routine_privileges
    where routine_schema = 'agenda_salao_private'
      and routine_name = 'complete_booking'
      and grantee = 'PUBLIC'
      and privilege_type = 'EXECUTE'
  ),
  'PUBLIC nao executa a implementacao privada'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.complete_booking(bigint,date,bigint[],text)',
    'execute'
  ),
  'authenticated executa o wrapper publico'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.complete_booking(bigint,date,bigint[],text)',
    'execute'
  ),
  'anon nao executa complete_booking'
);

insert into auth.users (id, email)
values
  ('d0000000-0000-4000-8000-00000000000d', 'complete.salao@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'complete.nao.autorizada@example.test');

insert into agenda_salao_private.salon_users (user_id)
values ('d0000000-0000-4000-8000-00000000000d');

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"d0000000-0000-4000-8000-00000000000d","role":"authenticated"}';

insert into public.clients (name, phone)
values ('Cliente Conclusao', '+55 11 95555-0001');

insert into public.services (
  name, suggested_return_months, estimated_duration_minutes, active
)
values
  ('Conclusao A', 1, 30, true),
  ('Conclusao B', 2, 45, true),
  ('Conclusao C sem retorno', null, 60, true),
  ('Conclusao Planejado Inativar', 3, 30, true),
  ('Conclusao Inativo Nao Planejado', 4, 30, false);

create temporary table complete_clock as
select date_trunc('day', statement_timestamp() + interval '40 days')
       + interval '9 hours' as base_at;

-- Main scheduled flow: one planned service is removed and one active,
-- unplanned service is added.
select lives_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Conclusao'),
      (select base_at from complete_clock),
      array[
        (select id from public.services where name = 'Conclusao A'),
        (select id from public.services where name = 'Conclusao B')
      ],
      null,
      'Conclusao principal'
    )$$,
  'fixture scheduled foi criada pela RPC'
);

create temporary table main_booking_before as
select id, starts_at, status_updated_at, updated_at
from public.bookings
where notes = 'Conclusao principal';

reset role;
update public.bookings
set status_updated_at = timestamptz '2000-01-01 00:00:00+00',
    updated_at = timestamptz '2000-01-01 00:00:00+00'
where notes = 'Conclusao principal';
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"d0000000-0000-4000-8000-00000000000d","role":"authenticated"}';

select is(
  (
    select booking_status
    from public.complete_booking(
      (select id from main_booking_before),
      date '2020-10-15',
      array[
        (select id from public.services where name = 'Conclusao A'),
        (select id from public.services where name = 'Conclusao C sem retorno')
      ],
      'Servicos efetivamente realizados'
    )
  ),
  'completed'::text,
  'scheduled vira completed'
);
select is(
  (select count(*) from public.appointments
   where booking_id = (select id from main_booking_before)),
  1::bigint,
  'conclusao cria exatamente um appointment'
);
select is(
  (select a.booking_id from public.appointments a
   where a.booking_id = (select id from main_booking_before)),
  (select id from main_booking_before),
  'appointment recebe o booking_id correto'
);
select is(
  (select a.client_id from public.appointments a
   where a.booking_id = (select id from main_booking_before)),
  (select client_id from public.bookings
   where id = (select id from main_booking_before)),
  'client_id do appointment vem do booking'
);
select is(
  (select a.performed_on from public.appointments a
   where a.booking_id = (select id from main_booking_before)),
  date '2020-10-15',
  'performed_on usa a data efetiva informada'
);
select is(
  (select starts_at from public.bookings
   where id = (select id from main_booking_before)),
  (select starts_at from main_booking_before),
  'conclusao preserva starts_at'
);
select is(
  (select count(*) from public.appointment_services aps
   join public.appointments a on a.id = aps.appointment_id
   where a.booking_id = (select id from main_booking_before)),
  2::bigint,
  'servicos efetivamente realizados sao registrados'
);
select results_eq(
  $$select aps.service_name
    from public.appointment_services aps
    join public.appointments a on a.id = aps.appointment_id
    where a.booking_id = (select id from main_booking_before)
    order by aps.service_name$$,
  $$values
      ('Conclusao A'::text),
      ('Conclusao C sem retorno'::text)$$,
  'appointment_services representam o realizado, nao o planejado'
);
select is(
  (select count(*) from public.returns r
   join public.appointment_services aps on aps.id = r.appointment_service_id
   join public.appointments a on a.id = aps.appointment_id
   where a.booking_id = (select id from main_booking_before)),
  1::bigint,
  'triggers geram retorno somente para servico realizado com intervalo'
);
select is(
  (select due_on from public.returns r
   join public.appointment_services aps on aps.id = r.appointment_service_id
   join public.appointments a on a.id = aps.appointment_id
   where a.booking_id = (select id from main_booking_before)),
  date '2020-11-15',
  'retorno usa performed_on e snapshot da regra existente'
);
select ok(
  (select status_updated_at > timestamptz '2000-01-01 00:00:00+00'
   from public.bookings where id = (select id from main_booking_before)),
  'conclusao atualiza status_updated_at'
);
select ok(
  (select updated_at > timestamptz '2000-01-01 00:00:00+00'
   from public.bookings where id = (select id from main_booking_before)),
  'conclusao atualiza updated_at'
);

-- Idempotency returns the existing link and does not validate/create again.
create temporary table main_completion as
select a.id as appointment_id,
       (select count(*) from public.appointments)::bigint as appointment_count,
       (select count(*) from public.returns)::bigint as return_count
from public.appointments a
where a.booking_id = (select id from main_booking_before);

select is(
  (
    select appointment_id
    from public.complete_booking(
      (select id from main_booking_before),
      null,
      array[]::bigint[],
      'Ignorado em repeticao'
    )
  ),
  (select appointment_id from main_completion),
  'segunda conclusao retorna o mesmo appointment'
);
select is(
  (select count(*) from public.appointments),
  (select appointment_count from main_completion),
  'segunda conclusao nao cria appointment'
);
select is(
  (select count(*) from public.returns),
  (select return_count from main_completion),
  'segunda conclusao nao cria returns'
);

-- Confirmed flow.
select lives_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Conclusao'),
      (select base_at + interval '3 hours' from complete_clock),
      array[(select id from public.services where name = 'Conclusao A')],
      null,
      'Conclusao confirmed'
    )$$,
  'fixture para confirmed foi criada'
);
select lives_ok(
  $$select * from public.confirm_booking(
      (select id from public.bookings where notes = 'Conclusao confirmed')
    )$$,
  'booking foi confirmado antes da conclusao'
);
select is(
  (
    select booking_status
    from public.complete_booking(
      (select id from public.bookings where notes = 'Conclusao confirmed'),
      date '2020-10-16',
      array[(select id from public.services where name = 'Conclusao A')]
    )
  ),
  'completed'::text,
  'confirmed vira completed'
);

-- All planned services may be performed.
select lives_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Conclusao'),
      (select base_at + interval '6 hours' from complete_clock),
      array[
        (select id from public.services where name = 'Conclusao A'),
        (select id from public.services where name = 'Conclusao B')
      ],
      null,
      'Conclusao todos planejados'
    )$$,
  'fixture com todos os planejados foi criada'
);
select is(
  (
    select service_count
    from public.complete_booking(
      (select id from public.bookings where notes = 'Conclusao todos planejados'),
      date '2020-10-17',
      array[
        (select id from public.services where name = 'Conclusao A'),
        (select id from public.services where name = 'Conclusao B')
      ]
    )
  ),
  2,
  'todos os servicos planejados podem ser realizados'
);

-- An inactive service remains eligible only when it was planned.
select lives_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Conclusao'),
      (select base_at + interval '9 hours' from complete_clock),
      array[(select id from public.services
             where name = 'Conclusao Planejado Inativar')],
      null,
      'Conclusao planejado inativo'
    )$$,
  'servico foi planejado enquanto ativo'
);
update public.services
set active = false
where name = 'Conclusao Planejado Inativar';
select lives_ok(
  $$select * from public.complete_booking(
      (select id from public.bookings where notes = 'Conclusao planejado inativo'),
      date '2020-10-18',
      array[(select id from public.services
             where name = 'Conclusao Planejado Inativar')]
    )$$,
  'servico inativado depois do planejamento pode ser registrado'
);
select is(
  (select aps.service_name
   from public.appointment_services aps
   join public.appointments a on a.id = aps.appointment_id
   join public.bookings b on b.id = a.booking_id
   where b.notes = 'Conclusao planejado inativo'),
  'Conclusao Planejado Inativar'::text,
  'snapshot realizado continua vindo de appointment_services'
);

select lives_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Conclusao'),
      (select base_at + interval '12 hours' from complete_clock),
      array[(select id from public.services where name = 'Conclusao A')],
      null,
      'Rejeitar inativo nao planejado'
    )$$,
  'fixture para servico inativo nao planejado foi criada'
);
select throws_ok(
  $$select * from public.complete_booking(
      (select id from public.bookings where notes = 'Rejeitar inativo nao planejado'),
      date '2020-10-19',
      array[
        (select id from public.services where name = 'Conclusao A'),
        (select id from public.services
         where name = 'Conclusao Inativo Nao Planejado')
      ]
    )$$,
  '55000',
  'inactive services must have been planned in the booking',
  'servico inativo nao planejado e rejeitado'
);
select is(
  (select status from public.bookings
   where notes = 'Rejeitar inativo nao planejado'),
  'scheduled'::text,
  'rejeicao preserva o status do booking'
);

-- Input validation uses the same shared appointment core.
select throws_ok(
  $$select * from public.complete_booking(
      (select id from public.bookings where notes = 'Rejeitar inativo nao planejado'),
      date '2020-10-19',
      array[]::bigint[]
    )$$,
  '22023',
  'p_service_ids must contain at least one service',
  'lista realizada vazia e rejeitada'
);
select throws_ok(
  $$select * from public.complete_booking(
      (select id from public.bookings where notes = 'Rejeitar inativo nao planejado'),
      date '2020-10-19',
      array[
        (select id from public.services where name = 'Conclusao A'),
        null
      ]::bigint[]
    )$$,
  '22023',
  'p_service_ids must not contain null values',
  'lista realizada com null e rejeitada'
);
select throws_ok(
  $$select * from public.complete_booking(
      (select id from public.bookings where notes = 'Rejeitar inativo nao planejado'),
      date '2020-10-19',
      array[
        (select id from public.services where name = 'Conclusao A'),
        (select id from public.services where name = 'Conclusao A')
      ]
    )$$,
  '22023',
  'p_service_ids must not contain duplicate services',
  'lista realizada com duplicata e rejeitada'
);
select throws_ok(
  $$select * from public.complete_booking(
      (select id from public.bookings where notes = 'Rejeitar inativo nao planejado'),
      date '2020-10-19',
      array[999999999::bigint]
    )$$,
  '23503',
  'one or more services do not exist',
  'servico realizado inexistente e rejeitado'
);

-- Invalid terminal states and completed-data inconsistency.
select lives_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Conclusao'),
      (select base_at + interval '15 hours' from complete_clock),
      array[(select id from public.services where name = 'Conclusao A')],
      null,
      'Conclusao cancelada'
    )$$,
  'fixture cancelavel foi criada'
);
select lives_ok(
  $$select * from public.cancel_booking(
      (select id from public.bookings where notes = 'Conclusao cancelada')
    )$$,
  'fixture foi cancelada'
);
select throws_ok(
  $$select * from public.complete_booking(
      (select id from public.bookings where notes = 'Conclusao cancelada'),
      date '2020-10-20',
      array[(select id from public.services where name = 'Conclusao A')]
    )$$,
  '55000',
  'booking ' || (select id from public.bookings where notes = 'Conclusao cancelada')
    || ' cannot be completed from status cancelled',
  'cancelled nao pode ser concluido'
);

reset role;
insert into public.bookings (
  client_id, starts_at, ends_at, status, notes
)
select c.id,
       statement_timestamp() - interval '2 hours',
       statement_timestamp() - interval '1 hour',
       'no_show',
       'Conclusao no show'
from public.clients c
where c.name = 'Cliente Conclusao';

insert into public.bookings (
  client_id, starts_at, ends_at, status, notes
)
select c.id,
       t.base_at + interval '18 hours',
       t.base_at + interval '19 hours',
       'completed',
       'Completed inconsistente'
from public.clients c
cross join complete_clock t
where c.name = 'Cliente Conclusao';

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"d0000000-0000-4000-8000-00000000000d","role":"authenticated"}';

select throws_ok(
  $$select * from public.complete_booking(
      (select id from public.bookings where notes = 'Conclusao no show'),
      date '2020-10-20',
      array[(select id from public.services where name = 'Conclusao A')]
    )$$,
  '55000',
  'booking ' || (select id from public.bookings where notes = 'Conclusao no show')
    || ' cannot be completed from status no_show',
  'no_show nao pode ser concluido'
);
select throws_ok(
  $$select * from public.complete_booking(
      (select id from public.bookings where notes = 'Completed inconsistente'),
      date '2020-10-20',
      array[(select id from public.services where name = 'Conclusao A')]
    )$$,
  'XX000',
  'completed booking '
    || (select id from public.bookings where notes = 'Completed inconsistente')
    || ' has no linked appointment',
  'completed sem appointment e detectado como inconsistencia'
);

-- Failure at each downstream layer rolls back the whole completion.
select lives_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Conclusao'),
      (select base_at + interval '21 hours' from complete_clock),
      array[(select id from public.services where name = 'Conclusao A')],
      null,
      'Falha appointment'
    )$$,
  'fixture para falha no appointment foi criada'
);
reset role;
alter table public.appointments
add constraint test_reject_complete_appointment
check (notes is distinct from 'Falhar appointment') not valid;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"d0000000-0000-4000-8000-00000000000d","role":"authenticated"}';
select throws_ok(
  $$select * from public.complete_booking(
      (select id from public.bookings where notes = 'Falha appointment'),
      date '2020-10-21',
      array[(select id from public.services where name = 'Conclusao A')],
      'Falhar appointment'
    )$$,
  '23514',
  'new row for relation "appointments" violates check constraint "test_reject_complete_appointment"',
  'falha ao criar appointment aborta a conclusao'
);
select is(
  (select status from public.bookings where notes = 'Falha appointment'),
  'scheduled'::text,
  'falha no appointment preserva booking ativo'
);
select is(
  (select count(*) from public.appointments a
   join public.bookings b on b.id = a.booking_id
   where b.notes = 'Falha appointment'),
  0::bigint,
  'falha no appointment nao deixa vinculo parcial'
);
reset role;
alter table public.appointments
drop constraint test_reject_complete_appointment;

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"d0000000-0000-4000-8000-00000000000d","role":"authenticated"}';
select lives_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Conclusao'),
      (select base_at + interval '24 hours' from complete_clock),
      array[(select id from public.services where name = 'Conclusao A')],
      null,
      'Falha appointment service'
    )$$,
  'fixture para falha no snapshot realizado foi criada'
);
reset role;
alter table public.appointment_services
add constraint test_reject_complete_service
check (service_name is distinct from 'Conclusao A') not valid;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"d0000000-0000-4000-8000-00000000000d","role":"authenticated"}';
select throws_ok(
  $$select * from public.complete_booking(
      (select id from public.bookings where notes = 'Falha appointment service'),
      date '2020-10-22',
      array[(select id from public.services where name = 'Conclusao A')]
    )$$,
  '23514',
  'new row for relation "appointment_services" violates check constraint "test_reject_complete_service"',
  'falha em appointment_services aborta a conclusao'
);
select is(
  (select status from public.bookings where notes = 'Falha appointment service'),
  'scheduled'::text,
  'falha no snapshot preserva booking ativo'
);
select is(
  (select count(*) from public.appointments a
   join public.bookings b on b.id = a.booking_id
   where b.notes = 'Falha appointment service'),
  0::bigint,
  'falha no snapshot desfaz o appointment'
);
reset role;
alter table public.appointment_services
drop constraint test_reject_complete_service;

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"d0000000-0000-4000-8000-00000000000d","role":"authenticated"}';
select lives_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Conclusao'),
      (select base_at + interval '27 hours' from complete_clock),
      array[(select id from public.services where name = 'Conclusao B')],
      null,
      'Falha return'
    )$$,
  'fixture para falha no trigger de return foi criada'
);
reset role;
alter table public.returns
add constraint test_reject_complete_return
check (due_on is distinct from date '2021-01-23') not valid;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"d0000000-0000-4000-8000-00000000000d","role":"authenticated"}';
select throws_ok(
  $$select * from public.complete_booking(
      (select id from public.bookings where notes = 'Falha return'),
      date '2020-11-23',
      array[(select id from public.services where name = 'Conclusao B')]
    )$$,
  '23514',
  'new row for relation "returns" violates check constraint "test_reject_complete_return"',
  'falha no trigger de returns aborta a conclusao'
);
select is(
  (select status from public.bookings where notes = 'Falha return'),
  'scheduled'::text,
  'falha em returns preserva booking ativo'
);
select is(
  (select count(*) from public.appointments a
   join public.bookings b on b.id = a.booking_id
   where b.notes = 'Falha return'),
  0::bigint,
  'falha em returns desfaz appointment e snapshots'
);
select is(
  (select count(*) from public.returns r
   join public.appointment_services aps on aps.id = r.appointment_service_id
   join public.appointments a on a.id = aps.appointment_id
   join public.bookings b on b.id = a.booking_id
   where b.notes = 'Falha return'),
  0::bigint,
  'falha em returns nao deixa retorno parcial'
);
reset role;
alter table public.returns
drop constraint test_reject_complete_return;

-- Successful rows always preserve the one-to-one invariant.
select is(
  (select count(*) from public.bookings b
   where b.status = 'completed'
     and b.notes <> 'Completed inconsistente'
     and not exists (
       select 1 from public.appointments a where a.booking_id = b.id
     )),
  0::bigint,
  'nenhum booking concluido com sucesso fica sem appointment'
);
select is(
  (select count(*) from (
     select a.booking_id
     from public.appointments a
     where a.booking_id is not null
     group by a.booking_id
     having count(*) > 1
   ) duplicated),
  0::bigint,
  'nenhum booking possui appointments duplicados'
);

-- Existing operations remain available and non-completion operations produce
-- no performed records.
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"d0000000-0000-4000-8000-00000000000d","role":"authenticated"}';
select lives_ok(
  $$select * from public.create_booking(
      (select id from public.clients where name = 'Cliente Conclusao'),
      (select base_at + interval '30 hours' from complete_clock),
      array[(select id from public.services where name = 'Conclusao A')],
      null,
      'Regressao operacoes'
    )$$,
  'create_booking continua funcionando'
);
select lives_ok(
  $$select * from public.update_booking(
      (select id from public.bookings where notes = 'Regressao operacoes'),
      (select id from public.clients where name = 'Cliente Conclusao'),
      (select base_at + interval '31 hours' from complete_clock),
      array[(select id from public.services where name = 'Conclusao B')],
      null,
      'Regressao operacoes atualizada'
    )$$,
  'update_booking continua funcionando'
);
select lives_ok(
  $$select * from public.confirm_booking(
      (select id from public.bookings where notes = 'Regressao operacoes atualizada')
    )$$,
  'confirm_booking continua funcionando'
);
select lives_ok(
  $$select * from public.cancel_booking(
      (select id from public.bookings where notes = 'Regressao operacoes atualizada')
    )$$,
  'cancel_booking continua funcionando'
);
select lives_ok(
  $$select * from public.mark_booking_no_show(
      (select id from public.bookings where notes = 'Conclusao no show')
    )$$,
  'mark_booking_no_show idempotente continua funcionando'
);
select is(
  (select count(*) from public.appointments a
   join public.bookings b on b.id = a.booking_id
   where b.notes in ('Regressao operacoes', 'Regressao operacoes atualizada',
                     'Conclusao cancelada', 'Conclusao no show')),
  0::bigint,
  'criar editar confirmar cancelar e no_show nao criam appointment'
);

select lives_ok(
  $$select * from public.create_appointment_with_services(
      (select id from public.clients where name = 'Cliente Conclusao'),
      date '2020-12-01',
      array[(select id from public.services where name = 'Conclusao A')],
      'Atendimento avulso regressao'
    )$$,
  'create_appointment_with_services avulso continua funcionando'
);
select is(
  (select booking_id from public.appointments
   where notes = 'Atendimento avulso regressao'),
  null::bigint,
  'appointment avulso continua com booking_id null'
);
select is(
  (select count(*) from public.returns r
   join public.appointment_services aps on aps.id = r.appointment_service_id
   join public.appointments a on a.id = aps.appointment_id
   where a.notes = 'Atendimento avulso regressao'),
  1::bigint,
  'returns de atendimento avulso continuam funcionando'
);

-- Authorization and direct-write protections.
set local "request.jwt.claims" =
  '{"sub":"e0000000-0000-4000-8000-00000000000e","role":"authenticated"}';
select throws_ok(
  $$select * from public.complete_booking(
      999999999, date '2020-10-20', array[999999999::bigint]
    )$$,
  '42501',
  'only the authorized salon account can complete bookings',
  'authenticated fora da allowlist nao conclui booking'
);
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(
  $$select * from public.complete_booking(
      999999999, date '2020-10-20', array[999999999::bigint]
    )$$,
  '42501',
  'permission denied for function complete_booking',
  'anon nao executa complete_booking'
);
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"d0000000-0000-4000-8000-00000000000d","role":"authenticated"}';
select throws_ok(
  $$update public.bookings set status = 'completed'
    where notes = 'Falha appointment'$$,
  '42501',
  'permission denied for table bookings',
  'frontend continua sem escrita direta em bookings'
);
select throws_ok(
  $$insert into public.appointments (client_id, performed_on, booking_id)
    values (
      (select id from public.clients where name = 'Cliente Conclusao'),
      current_date,
      (select id from public.bookings where notes = 'Falha appointment')
    )$$,
  '42501',
  'permission denied for table appointments',
  'frontend continua sem inserir appointment diretamente'
);
select throws_ok(
  $$update public.appointments set booking_id = null
    where booking_id = (select id from main_booking_before)$$,
  '42501',
  'permission denied for table appointments',
  'frontend continua sem alterar appointments.booking_id'
);
select throws_ok(
  $$insert into public.appointment_services (appointment_id, service_id)
    values (999999999, 999999999)$$,
  '42501',
  'permission denied for table appointment_services',
  'frontend continua sem inserir appointment_services'
);
select throws_ok(
  $$insert into public.returns (appointment_service_id, due_on)
    values (999999999, current_date)$$,
  '42501',
  'permission denied for table returns',
  'frontend continua sem inserir returns'
);

select * from finish();
rollback;
