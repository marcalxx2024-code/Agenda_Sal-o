begin;

create extension if not exists pgtap with schema extensions;
select plan(23);

select has_table('public', 'clients', 'clients existe');
select has_table('public', 'services', 'services existe');
select has_table('public', 'appointments', 'appointments existe');
select has_table('public', 'appointment_services', 'appointment_services existe');
select has_table('public', 'returns', 'returns existe');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.clients'::regclass),
  'RLS esta habilitada em clients'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.returns'::regclass),
  'RLS esta habilitada em returns'
);
select ok(
  (select reloptions @> array['security_invoker=true']
   from pg_class where oid = 'public.pending_returns'::regclass),
  'a view de pendencias respeita RLS das tabelas base'
);

select is(
  public.calendar_months_after(date '2025-01-31', 1),
  date '2025-02-28',
  'um mes apos 31/jan usa o ultimo dia valido de fevereiro'
);
select is(
  public.calendar_months_after(date '2024-01-31', 1),
  date '2024-02-29',
  'o calculo respeita ano bissexto'
);
select is(
  public.calendar_months_after(date '2025-01-31', 3),
  date '2025-04-30',
  'tres meses sao meses de calendario, nao 90 dias'
);

insert into auth.users (id, email)
values
  ('10000000-0000-4000-8000-000000000001', 'conta.salao@example.test'),
  ('20000000-0000-4000-8000-000000000002', 'nao.autorizada@example.test');

insert into agenda_salao_private.salon_users (user_id)
values ('10000000-0000-4000-8000-000000000001');

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$insert into public.clients (name, phone)
    values ('Cliente Exemplo', '+55 11 99999-0000')$$,
  'a conta do salao cadastra cliente'
);
select lives_ok(
  $$insert into public.services (name, suggested_return_months)
    values ('Tratamento Exemplo', 3), ('Corte Exemplo', 1)$$,
  'a conta do salao cadastra servicos'
);
select lives_ok(
  $$select * from public.create_appointment_with_services(
      (select id from public.clients where name = 'Cliente Exemplo'),
      date '2025-01-31',
      array(
        select id from public.services
        where name in ('Tratamento Exemplo', 'Corte Exemplo')
        order by id
      )
    )$$,
  'a conta do salao cadastra atendimento pela RPC'
);
select is(
  (select count(*) from public.appointment_services),
  2::bigint,
  'um atendimento criado pela RPC aceita varios servicos'
);

select is(
  (select count(*) from public.returns),
  2::bigint,
  'um retorno foi criado para cada servico com intervalo'
);
select results_eq(
  $$select return_due_on from public.appointment_services order by return_due_on$$,
  $$values (date '2025-02-28'), (date '2025-04-30')$$,
  'cada servico usa seu proprio intervalo em meses'
);

update public.services
set suggested_return_months = 6
where name = 'Tratamento Exemplo';

select is(
  (select return_interval_months
   from public.appointment_services
   where service_name = 'Tratamento Exemplo'),
  3::smallint,
  'alterar o padrao do servico nao altera o snapshot historico'
);

update public.appointments set performed_on = date '2025-02-28';
select results_eq(
  $$select due_on from public.returns order by due_on$$,
  $$values (date '2025-03-28'), (date '2025-05-28')$$,
  'corrigir a data do atendimento recalcula os retornos com o snapshot'
);

do $$
begin
  perform *
  from public.mark_return_contacted(
    (select id from public.returns where due_on = date '2025-03-28'),
    'Contato confirmado manualmente'
  );
end;
$$;
select is(
  (select count(*) from public.pending_returns where contacted_at is not null),
  1::bigint,
  'contato via RPC nao conclui automaticamente o retorno pendente'
);

set local "request.jwt.claims" =
  '{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select count(*) from public.clients),
  0::bigint,
  'outra conta autenticada nao enxerga clientes'
);
select throws_ok(
  $$insert into public.clients (name, phone)
    values ('Acesso Indevido', '+55 11 98888-0000')$$,
  '42501',
  'new row violates row-level security policy for table "clients"',
  'outra conta autenticada nao cadastra clientes'
);

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(
  $$select count(*) from public.clients$$,
  '42501',
  'permission denied for table clients',
  'acesso anonimo nao possui permissao na tabela de clientes'
);

select * from finish();
rollback;
