begin;

create extension if not exists pgtap with schema extensions;
select plan(36);

-- Estrutura publica, seguranca e contratos preservados.
select has_function(
  'public',
  'normalize_whatsapp_phone',
  array['text'],
  'funcao de normalizacao de telefone existe'
);
select ok(
  not (select prosecdef from pg_proc
       where oid = 'public.normalize_whatsapp_phone(text)'::regprocedure),
  'normalizacao de telefone usa security invoker'
);
select ok(
  (select prosecdef from pg_proc
   where oid = 'agenda_salao_private.mark_return_contacted(bigint,text)'::regprocedure),
  'implementacao privada do contato usa security definer'
);
select is(
  (select proconfig
   from pg_proc
   where oid = 'agenda_salao_private.mark_return_contacted(bigint,text)'::regprocedure),
  array['search_path=""']::text[],
  'implementacao privada do contato usa search_path vazio'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.returns'::regclass),
  'RLS continua habilitada em returns'
);
select ok(
  (select reloptions @> array['security_invoker=true']
   from pg_class where oid = 'public.pending_returns'::regclass),
  'view de retornos continua respeitando RLS'
);
select matches(
  pg_get_viewdef('public.pending_returns'::regclass, true),
  'America/Sao_Paulo',
  'calculo de hoje fixa explicitamente o timezone do salao'
);

-- Normalizacao e preservacao do telefone original.
select is(
  public.normalize_whatsapp_phone('(51) 99999-9999'),
  '5551999999999'::text,
  'telefone brasileiro recebe DDI 55 e fica somente com digitos'
);
select is(
  public.normalize_whatsapp_phone('+55 (51) 99999-9999'),
  '5551999999999'::text,
  'telefone que ja possui DDI nao recebe prefixo duplicado'
);
select is(
  public.normalize_whatsapp_phone('0055 51 99999-9999'),
  '5551999999999'::text,
  'prefixo internacional 00 e removido corretamente'
);

insert into auth.users (id, email)
values
  ('71000000-0000-4000-8000-000000000071', 'retornos.salao@example.test'),
  ('72000000-0000-4000-8000-000000000072', 'retornos.nao.autorizada@example.test');

insert into agenda_salao_private.salon_users (user_id)
values ('71000000-0000-4000-8000-000000000071');

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"71000000-0000-4000-8000-000000000071","role":"authenticated"}';

insert into public.clients (name, phone)
values
  ('Maria Retorno', '(51) 99999-9999'),
  ('Cliente Agenda Existente', '(11) 98888-0000');

insert into public.services (
  name,
  suggested_return_days,
  estimated_duration_minutes
)
values
  ('Progressiva 90 Dias', 90, 120),
  ('Servico Sem Retorno', null, 30);

insert into public.services (
  name,
  suggested_return_months,
  estimated_duration_minutes
)
values ('Servico Mensal Existente', 3, 60);

select is(
  (
    select return_count
    from public.create_appointment_with_services(
      (select id from public.clients where name = 'Maria Retorno'),
      date '2026-09-10',
      array[
        (select id from public.services where name = 'Progressiva 90 Dias'),
        (select id from public.services where name = 'Servico Sem Retorno')
      ],
      'Atendimento concluido para teste de retorno'
    )
  ),
  1,
  'atendimento concluido gera retorno apenas para servico configurado'
);
select is(
  (select count(*) from public.returns),
  1::bigint,
  'um unico retorno foi gerado para o atendimento'
);
select is(
  (select due_on from public.returns),
  date '2026-12-09',
  'prazo de 90 dias calcula 09/12/2026 a partir de 10/09/2026'
);
select is(
  (select return_interval_days
   from public.appointment_services
   where service_name = 'Progressiva 90 Dias'),
  90,
  'prazo em dias fica preservado no snapshot historico'
);

-- A sincronizacao usa UPSERT pela chave unica e nao duplica o retorno.
update public.appointments
set performed_on = date '2026-09-11'
where notes = 'Atendimento concluido para teste de retorno';
update public.appointments
set performed_on = date '2026-09-10'
where notes = 'Atendimento concluido para teste de retorno';

select is(
  (select count(*) from public.returns),
  1::bigint,
  'recalcular atendimento nao duplica retorno'
);
select is(
  (select due_on from public.returns),
  date '2026-12-09',
  'recalculo restaura a data prevista correta'
);

select is(
  (select count(*) from public.pending_returns),
  1::bigint,
  'retorno pendente aparece na listagem'
);
select is(
  (select status from public.pending_returns),
  'pending'::text,
  'listagem distingue retorno ainda nao contatado'
);
select is(
  (select client_phone_normalized from public.pending_returns),
  '5551999999999'::text,
  'listagem fornece telefone pronto para wa.me'
);
select is(
  (select client_phone from public.pending_returns),
  '(51) 99999-9999'::text,
  'normalizacao nao altera o telefone original'
);
select is(
  (select days_until_due from public.pending_returns),
  date '2026-12-09'
    - (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
  'dias ate o retorno usam a data atual de America/Sao_Paulo'
);
select ok(
  (select appointment_id is not null
          and appointment_service_id is not null
          and service_id is not null
   from public.pending_returns),
  'listagem identifica atendimento e servico de origem'
);

create temporary table first_return_contact as
select clock_timestamp() as before_contact, null::timestamptz as contacted_at;

update first_return_contact
set contacted_at = (
  select contacted_at
  from public.mark_return_contacted(
    (select id from public.returns),
    'WhatsApp confirmado manualmente'
  )
);

select ok(
  (select contacted_at >= before_contact
          and contacted_at <= clock_timestamp()
   from first_return_contact),
  'mark_return_contacted grava horario do banco'
);
select is(
  (select status from public.returns),
  'pending'::text,
  'contato nao resolve o retorno'
);
select is(
  (select status from public.pending_returns),
  'contacted'::text,
  'listagem distingue retorno contatado ainda pendente'
);
select is(
  (
    select contacted_at
    from public.mark_return_contacted(
      (select id from public.returns),
      'Esta nota nao deve substituir a primeira'
    )
  ),
  (select contacted_at from first_return_contact),
  'chamada duplicada preserva o primeiro horario de contato'
);
select is(
  (select contact_note from public.returns),
  'WhatsApp confirmado manualmente'::text,
  'chamada duplicada preserva a primeira observacao'
);

update public.clients
set active = false
where name = 'Maria Retorno';

select ok(
  (select not c.active
          and count(distinct a.id) = 1
          and count(r.id) = 1
   from public.clients as c
   join public.appointments as a on a.client_id = c.id
   join public.appointment_services as aps on aps.appointment_id = a.id
   left join public.returns as r on r.appointment_service_id = aps.id
   where c.name = 'Maria Retorno'
   group by c.active),
  'cliente inativa preserva atendimento e retorno existentes'
);

update public.returns set status = 'completed';

select ok(
  (select resolved_at is not null from public.returns),
  'resolver retorno grava resolved_at'
);
select is(
  (select count(*) from public.pending_returns),
  0::bigint,
  'retorno resolvido nao aparece na listagem pendente'
);
select throws_ok(
  $$select * from public.mark_return_contacted(
      (select id from public.returns), null
    )$$,
  '55000',
  'return ' || (select id from public.returns) || ' cannot be contacted from status completed',
  'contato nao altera retorno ja resolvido'
);
select throws_ok(
  $$update public.returns set status = 'pending'$$,
  '55000',
  'return ' || (select id from public.returns) || ' is already resolved as completed',
  'retorno terminal nao pode ser reaberto por update direto'
);

-- As regras novas nao interferem no fluxo de agendamentos existente.
create temporary table return_booking_clock as
select (
  (
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date + 30
  )::timestamp + time '10:00'
) at time zone 'America/Sao_Paulo' as starts_at;

select is(
  (
    select booking_status
    from public.create_booking(
      (select id from public.clients where name = 'Cliente Agenda Existente'),
      (select starts_at from return_booking_clock),
      array[
        (select id from public.services where name = 'Servico Mensal Existente')
      ],
      null,
      'Agendamento preservado pelo fluxo de retornos'
    )
  ),
  'scheduled'::text,
  'novas regras nao quebram a criacao de agendamentos'
);

-- Uma conta autenticada fora da allowlist nao le nem muta dados do salao.
set local "request.jwt.claims" =
  '{"sub":"72000000-0000-4000-8000-000000000072","role":"authenticated"}';

select is(
  (select count(*) from public.returns),
  0::bigint,
  'RLS impede outra conta de ler retornos'
);
select is(
  (select count(*) from public.pending_returns),
  0::bigint,
  'RLS da view impede outra conta de ler dados de clientes'
);
select throws_ok(
  $$select * from public.mark_return_contacted(1, null)$$,
  '42501',
  'only the authorized salon account can mark return contact',
  'RPC rejeita conta sem acesso antes de confiar no id'
);

select * from finish();
rollback;
