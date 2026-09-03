begin;

create extension if not exists pgtap with schema extensions;
select plan(44);

select ok(
  (select prosecdef from pg_proc
   where oid = 'agenda_salao_private.create_appointment_with_services(bigint,date,bigint[],text)'::regprocedure),
  'a implementacao privada de atendimento usa security definer'
);
select ok(
  (select prosecdef from pg_proc
   where oid = 'agenda_salao_private.mark_return_contacted(bigint,text)'::regprocedure),
  'a implementacao privada de contato usa security definer'
);
select isnt(
  (select prosecdef from pg_proc
   where oid = 'public.create_appointment_with_services(bigint,date,bigint[],text)'::regprocedure),
  true,
  'a RPC publica de atendimento permanece security invoker'
);
select isnt(
  (select prosecdef from pg_proc
   where oid = 'public.mark_return_contacted(bigint,text)'::regprocedure),
  true,
  'a RPC publica de contato permanece security invoker'
);

select ok(
  not has_table_privilege('authenticated', 'public.appointments', 'insert'),
  'authenticated nao possui insert direto em appointments'
);
select ok(
  not has_table_privilege('authenticated', 'public.appointments', 'delete'),
  'authenticated nao possui delete direto em appointments'
);
select ok(
  not has_column_privilege('authenticated', 'public.appointments', 'client_id', 'update'),
  'authenticated nao pode trocar diretamente a cliente do atendimento'
);
select ok(
  has_column_privilege('authenticated', 'public.appointments', 'performed_on', 'update'),
  'authenticated pode corrigir diretamente a data com triggers ativos'
);
select ok(
  has_table_privilege('authenticated', 'public.appointment_services', 'select'),
  'authenticated pode consultar itens do atendimento'
);
select ok(
  not has_table_privilege('authenticated', 'public.appointment_services', 'insert'),
  'authenticated nao possui insert direto em appointment_services'
);
select ok(
  not has_table_privilege('authenticated', 'public.appointment_services', 'update'),
  'authenticated nao possui update direto em appointment_services'
);
select ok(
  not has_table_privilege('authenticated', 'public.appointment_services', 'delete'),
  'authenticated nao possui delete direto em appointment_services'
);
select ok(
  has_column_privilege('authenticated', 'public.returns', 'status', 'update'),
  'authenticated preserva a atualizacao manual de status'
);
select ok(
  not has_column_privilege('authenticated', 'public.returns', 'contacted_at', 'update'),
  'authenticated nao pode fornecer horario de contato diretamente'
);
select ok(
  not has_column_privilege('authenticated', 'public.returns', 'contact_note', 'update'),
  'authenticated nao pode substituir nota de contato diretamente'
);
select ok(
  not has_sequence_privilege('authenticated', 'public.appointments_id_seq', 'usage'),
  'authenticated nao usa diretamente a sequence de appointments'
);
select ok(
  not has_sequence_privilege('authenticated', 'public.appointment_services_id_seq', 'usage'),
  'authenticated nao usa diretamente a sequence de appointment_services'
);
select ok(
  not has_sequence_privilege('authenticated', 'public.returns_id_seq', 'usage'),
  'authenticated nao usa diretamente a sequence de returns'
);

insert into auth.users (id, email)
values
  ('50000000-0000-4000-8000-000000000005', 'hardening.salao@example.test'),
  ('60000000-0000-4000-8000-000000000006', 'hardening.nao.autorizada@example.test');

insert into agenda_salao_private.salon_users (user_id)
values ('50000000-0000-4000-8000-000000000005');

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"50000000-0000-4000-8000-000000000005","role":"authenticated"}';

insert into public.clients (name, phone, active)
values
  ('Cliente Hardening Ativa', '+55 11 96666-0001', true),
  ('Cliente Hardening Inativa', '+55 11 96666-0002', false);

insert into public.services (name, suggested_return_months, active)
values
  ('Servico Hardening Um', 1, true),
  ('Servico Hardening Tres', 3, true),
  ('Servico Hardening Inativo', 2, false);

select lives_ok(
  $$select * from public.create_appointment_with_services(
      (select id from public.clients where name = 'Cliente Hardening Ativa'),
      date '2026-01-31',
      array(
        select id from public.services
        where name in ('Servico Hardening Um', 'Servico Hardening Tres')
        order by id
      ),
      'Criado pela RPC endurecida'
    )$$,
  'a conta autorizada continua criando atendimento pela RPC'
);
select is(
  (select count(*) from public.appointments),
  1::bigint,
  'a RPC criou um atendimento'
);
select is(
  (select count(*) from public.appointment_services),
  2::bigint,
  'a RPC criou os itens do atendimento'
);
select is(
  (select count(*) from public.returns),
  2::bigint,
  'os triggers continuam criando retornos'
);

select throws_ok(
  $$insert into public.appointments (client_id, performed_on)
    values (
      (select id from public.clients where name = 'Cliente Hardening Ativa'),
      date '2026-02-01'
    )$$,
  '42501',
  'permission denied for table appointments',
  'a conta autorizada nao contorna a RPC com insert direto'
);
select throws_ok(
  $$insert into public.appointments (client_id, performed_on)
    values (
      (select id from public.clients where name = 'Cliente Hardening Inativa'),
      date '2026-02-01'
    )$$,
  '42501',
  'permission denied for table appointments',
  'cliente inativa nao pode ser usada em insert direto'
);
select throws_ok(
  $$update public.appointments
    set client_id = (
      select id from public.clients where name = 'Cliente Hardening Inativa'
    )$$,
  '42501',
  'permission denied for table appointments',
  'a cliente do atendimento nao pode ser trocada diretamente'
);
select throws_ok(
  $$insert into public.appointment_services (appointment_id, service_id)
    values (
      (select id from public.appointments limit 1),
      (select id from public.services where name = 'Servico Hardening Um')
    )$$,
  '42501',
  'permission denied for table appointment_services',
  'servico ativo tambem nao pode ser associado fora da RPC'
);
select throws_ok(
  $$insert into public.appointment_services (appointment_id, service_id)
    values (
      (select id from public.appointments limit 1),
      (select id from public.services where name = 'Servico Hardening Inativo')
    )$$,
  '42501',
  'permission denied for table appointment_services',
  'servico inativo nao pode ser associado diretamente'
);
select throws_ok(
  $$update public.appointment_services set service_name = 'Snapshot adulterado'$$,
  '42501',
  'permission denied for table appointment_services',
  'o nome historico do servico nao pode ser alterado diretamente'
);
select throws_ok(
  $$update public.appointment_services set return_interval_months = 120$$,
  '42501',
  'permission denied for table appointment_services',
  'o intervalo historico nao pode ser alterado diretamente'
);
select throws_ok(
  $$update public.appointment_services set return_due_on = date '2099-12-31'$$,
  '42501',
  'permission denied for table appointment_services',
  'a data historica de retorno nao pode ser alterada diretamente'
);
select throws_ok(
  $$delete from public.appointment_services$$,
  '42501',
  'permission denied for table appointment_services',
  'itens historicos nao podem ser apagados diretamente'
);
select throws_ok(
  $$delete from public.appointments$$,
  '42501',
  'permission denied for table appointments',
  'atendimentos nao podem ser apagados diretamente'
);
select throws_ok(
  $$update public.returns set contacted_at = timestamptz '2099-12-31 23:59:59+00'$$,
  '42501',
  'permission denied for table returns',
  'authenticated nao define contacted_at arbitrariamente'
);
select throws_ok(
  $$update public.returns set contact_note = 'Nota adulterada'$$,
  '42501',
  'permission denied for table returns',
  'authenticated nao define contact_note fora da RPC'
);

select lives_ok(
  $$update public.appointments
    set performed_on = date '2026-02-28',
        notes = 'Data corrigida com seguranca'$$,
  'a correcao segura de data e observacoes continua permitida'
);
select results_eq(
  $$select due_on from public.returns order by due_on$$,
  $$values (date '2026-03-28'), (date '2026-05-28')$$,
  'a correcao da data continua recalculando retornos'
);
select lives_ok(
  $$update public.returns
    set status = 'completed'
    where id = (select max(id) from public.returns)$$,
  'a atualizacao manual e independente de status continua permitida'
);

create temporary table hardening_contact_clock as
select clock_timestamp() as before_contact;

select lives_ok(
  $$select * from public.mark_return_contacted(
      (select min(id) from public.returns),
      'Contato confirmado pela RPC endurecida'
    )$$,
  'a conta autorizada continua registrando contato pela RPC'
);
select ok(
  (
    select r.contacted_at >= c.before_contact
      and r.contacted_at <= clock_timestamp()
    from public.returns as r
    cross join hardening_contact_clock as c
    where r.id = (select min(id) from public.returns)
  ),
  'o horario confirmado continua sendo gerado pelo banco'
);
select is(
  (select contact_note from public.returns where id = (select min(id) from public.returns)),
  'Contato confirmado pela RPC endurecida'::text,
  'a RPC continua armazenando a nota de contato'
);

set local "request.jwt.claims" =
  '{"sub":"60000000-0000-4000-8000-000000000006","role":"authenticated"}';

select is(
  (select count(*) from public.appointments),
  0::bigint,
  'outra conta autenticada continua sem leitura por RLS'
);
select throws_ok(
  $$select * from public.create_appointment_with_services(
      999999999, date '2026-03-01', array[999999999::bigint]
    )$$,
  '42501',
  'only the authorized salon account can create appointments',
  'outra conta autenticada continua bloqueada na RPC'
);

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';

select throws_ok(
  $$select count(*) from public.appointments$$,
  '42501',
  'permission denied for table appointments',
  'anon continua sem acesso direto'
);
select throws_ok(
  $$select * from public.mark_return_contacted(999999999, null)$$,
  '42501',
  'permission denied for function mark_return_contacted',
  'anon continua sem acesso a RPC'
);

select * from finish();
rollback;
