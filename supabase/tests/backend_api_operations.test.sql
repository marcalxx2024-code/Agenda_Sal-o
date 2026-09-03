begin;

create extension if not exists pgtap with schema extensions;
select plan(35);

select has_function(
  'public',
  'create_appointment_with_services',
  array['bigint', 'date', 'bigint[]', 'text'],
  'a RPC transacional de atendimento existe'
);
select has_function(
  'public',
  'mark_return_contacted',
  array['bigint', 'text'],
  'a RPC de confirmacao de contato existe'
);
select isnt(
  (select prosecdef from pg_proc
   where oid = 'public.create_appointment_with_services(bigint,date,bigint[],text)'::regprocedure),
  true,
  'a RPC de atendimento usa security invoker'
);
select isnt(
  (select prosecdef from pg_proc
   where oid = 'public.mark_return_contacted(bigint,text)'::regprocedure),
  true,
  'a RPC de contato usa security invoker'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.create_appointment_with_services(bigint,date,bigint[],text)',
    'execute'
  ),
  'authenticated pode executar a RPC de atendimento'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.mark_return_contacted(bigint,text)',
    'execute'
  ),
  'authenticated pode executar a RPC de contato'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.create_appointment_with_services(bigint,date,bigint[],text)',
    'execute'
  ),
  'anon nao pode executar a RPC de atendimento'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.mark_return_contacted(bigint,text)',
    'execute'
  ),
  'anon nao pode executar a RPC de contato'
);

insert into auth.users (id, email)
values
  ('30000000-0000-4000-8000-000000000003', 'rpc.salao@example.test'),
  ('40000000-0000-4000-8000-000000000004', 'rpc.nao.autorizada@example.test');

insert into agenda_salao_private.salon_users (user_id)
values ('30000000-0000-4000-8000-000000000003');

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated"}';

insert into public.clients (name, phone)
values
  ('Cliente RPC Ativa', '+55 11 97777-0001'),
  ('Cliente RPC Inativa', '+55 11 97777-0002');

update public.clients
set active = false
where name = 'Cliente RPC Inativa';

insert into public.services (name, suggested_return_months)
values
  ('Servico RPC Um', 1),
  ('Servico RPC Tres', 3),
  ('Servico RPC Inativo', 2);

update public.services
set active = false
where name = 'Servico RPC Inativo';

select is(
  (
    select service_count
    from public.create_appointment_with_services(
      (select id from public.clients where name = 'Cliente RPC Ativa'),
      date '2026-01-31',
      array(
        select id
        from public.services
        where name in ('Servico RPC Um', 'Servico RPC Tres')
        order by id
      ),
      'Atendimento criado pela RPC'
    )
  ),
  2,
  'a RPC registra um atendimento com varios servicos'
);
select is(
  (select count(*) from public.appointments),
  1::bigint,
  'a operacao criou um unico atendimento'
);
select is(
  (select count(*) from public.appointment_services),
  2::bigint,
  'a operacao criou todos os itens'
);
select is(
  (select count(*) from public.returns),
  2::bigint,
  'os triggers criaram todos os retornos'
);

reset role;
do $$
declare
  rejected_service_id bigint;
begin
  select id into rejected_service_id
  from public.services
  where name = 'Servico RPC Tres';

  execute format(
    'alter table public.appointment_services add constraint test_reject_rpc_service check (service_id <> %L) not valid',
    rejected_service_id
  );
end;
$$;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated"}';

select throws_ok(
  $$select *
    from public.create_appointment_with_services(
      (select id from public.clients where name = 'Cliente RPC Ativa'),
      date '2026-02-01',
      array(
        select id
        from public.services
        where name in ('Servico RPC Um', 'Servico RPC Tres')
        order by id
      ),
      'Este atendimento deve ser desfeito'
    )$$,
  '23514',
  'new row for relation "appointment_services" violates check constraint "test_reject_rpc_service"',
  'falha em um item desfaz a operacao inteira'
);
select is(
  (select count(*) from public.appointments),
  1::bigint,
  'a falha nao deixa atendimento parcial'
);
select is(
  (select count(*) from public.appointment_services),
  2::bigint,
  'a falha nao deixa itens parciais'
);
select is(
  (select count(*) from public.returns),
  2::bigint,
  'a falha nao deixa retornos parciais'
);

reset role;
alter table public.appointment_services
drop constraint test_reject_rpc_service;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated"}';

select throws_ok(
  $$select * from public.create_appointment_with_services(
      (select id from public.clients where name = 'Cliente RPC Ativa'),
      date '2026-02-01',
      array[]::bigint[]
    )$$,
  '22023',
  'p_service_ids must contain at least one service',
  'a lista de servicos nao pode ser vazia'
);
select throws_ok(
  $$select * from public.create_appointment_with_services(
      (select id from public.clients where name = 'Cliente RPC Ativa'),
      date '2026-02-01',
      array[(select min(id) from public.services), null]::bigint[]
    )$$,
  '22023',
  'p_service_ids must not contain null values',
  'a lista de servicos nao aceita item nulo'
);
select throws_ok(
  $$select * from public.create_appointment_with_services(
      (select id from public.clients where name = 'Cliente RPC Ativa'),
      date '2026-02-01',
      array[(select min(id) from public.services), (select min(id) from public.services)]
    )$$,
  '22023',
  'p_service_ids must not contain duplicate services',
  'a lista de servicos nao aceita duplicatas'
);
select throws_ok(
  $$select * from public.create_appointment_with_services(
      (select id from public.clients where name = 'Cliente RPC Ativa'),
      date '2026-02-01',
      array[999999999::bigint]
    )$$,
  '23503',
  'one or more services do not exist',
  'a RPC rejeita servico inexistente'
);
select throws_ok(
  $$select * from public.create_appointment_with_services(
      (select id from public.clients where name = 'Cliente RPC Ativa'),
      date '2026-02-01',
      array[(select id from public.services where name = 'Servico RPC Inativo')]
    )$$,
  '55000',
  'all services must be active',
  'a RPC rejeita servico inativo'
);
select throws_ok(
  $$select * from public.create_appointment_with_services(
      999999999,
      date '2026-02-01',
      array[(select id from public.services where name = 'Servico RPC Um')]
    )$$,
  '23503',
  'client 999999999 does not exist',
  'a RPC rejeita cliente inexistente'
);
select throws_ok(
  $$select * from public.create_appointment_with_services(
      (select id from public.clients where name = 'Cliente RPC Inativa'),
      date '2026-02-01',
      array[(select id from public.services where name = 'Servico RPC Um')]
    )$$,
  '55000',
  'client ' || (select id from public.clients where name = 'Cliente RPC Inativa') || ' is inactive',
  'a RPC rejeita cliente inativa'
);

create temporary table contact_clock as
select clock_timestamp() as before_contact;

select is(
  (
    select status
    from public.mark_return_contacted(
      (select id from public.returns order by id limit 1),
      'Contato confirmado pela profissional'
    )
  ),
  'pending'::text,
  'registrar contato preserva o status pendente'
);
select ok(
  (
    select r.contacted_at >= c.before_contact
      and r.contacted_at <= clock_timestamp()
    from public.returns as r
    cross join contact_clock as c
    where r.contacted_at is not null
  ),
  'o horario de contato foi gerado pelo banco'
);
select is(
  (select contact_note from public.returns where contacted_at is not null),
  'Contato confirmado pela profissional'::text,
  'a nota opcional foi registrada'
);

create temporary table first_contact as
select id, contacted_at, status, contact_note
from public.returns
where contacted_at is not null;

select is(
  (
    select contacted_at
    from public.mark_return_contacted(
      (select id from first_contact),
      'Nota que nao deve substituir a primeira'
    )
  ),
  (select contacted_at from first_contact),
  'uma chamada repetida preserva o primeiro horario'
);
select is(
  (select contact_note from public.returns where contacted_at is not null),
  (select contact_note from first_contact),
  'uma chamada repetida preserva a primeira nota'
);
select is(
  (select status from public.returns where contacted_at is not null),
  (select status from first_contact),
  'uma chamada repetida tambem preserva o status'
);
select throws_ok(
  $$select * from public.mark_return_contacted(null, null)$$,
  '22023',
  'p_return_id is required',
  'a RPC de contato rejeita identificador nulo'
);
select throws_ok(
  $$select * from public.mark_return_contacted(999999999, null)$$,
  'P0002',
  'return 999999999 does not exist',
  'a RPC de contato informa identificador inexistente'
);

set local "request.jwt.claims" =
  '{"sub":"40000000-0000-4000-8000-000000000004","role":"authenticated"}';

select throws_ok(
  $$select * from public.create_appointment_with_services(
      999999999, date '2026-02-01', array[999999999::bigint]
    )$$,
  '42501',
  'only the authorized salon account can create appointments',
  'outra conta autenticada nao executa a RPC de atendimento'
);
select throws_ok(
  $$select * from public.mark_return_contacted(999999999, null)$$,
  '42501',
  'only the authorized salon account can mark return contact',
  'outra conta autenticada nao executa a RPC de contato'
);

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';

select throws_ok(
  $$select * from public.create_appointment_with_services(
      999999999, date '2026-02-01', array[999999999::bigint]
    )$$,
  '42501',
  'permission denied for function create_appointment_with_services',
  'anon nao executa a RPC de atendimento'
);
select throws_ok(
  $$select * from public.mark_return_contacted(999999999, null)$$,
  '42501',
  'permission denied for function mark_return_contacted',
  'anon nao executa a RPC de contato'
);

select * from finish();
rollback;
