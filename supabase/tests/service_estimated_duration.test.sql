begin;

create extension if not exists pgtap with schema extensions;
select plan(15);

select has_column(
  'public',
  'services',
  'estimated_duration_minutes',
  'services possui duracao estimada em minutos'
);
select col_type_is(
  'public',
  'services',
  'estimated_duration_minutes',
  'smallint',
  'a duracao estimada usa smallint'
);

insert into auth.users (id, email)
values
  ('70000000-0000-4000-8000-000000000007', 'duration.salao@example.test'),
  ('80000000-0000-4000-8000-000000000008', 'duration.nao.autorizada@example.test');

insert into agenda_salao_private.salon_users (user_id)
values ('70000000-0000-4000-8000-000000000007');

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"70000000-0000-4000-8000-000000000007","role":"authenticated"}';

select lives_ok(
  $$insert into public.services (name, suggested_return_months)
    values ('Servico Sem Duracao', 1)$$,
  'a duracao estimada aceita null'
);
select is(
  (select estimated_duration_minutes
   from public.services
   where name = 'Servico Sem Duracao'),
  null::smallint,
  'servico sem duracao permanece com null'
);

select lives_ok(
  $$insert into public.services (
      name,
      suggested_return_months,
      estimated_duration_minutes
    ) values ('Servico Com Duracao', 3, 180)$$,
  'a duracao estimada aceita valor positivo'
);
select is(
  (select estimated_duration_minutes
   from public.services
   where name = 'Servico Com Duracao'),
  180::smallint,
  'a duracao positiva foi armazenada'
);
select is(
  (select suggested_return_months
   from public.services
   where name = 'Servico Com Duracao'),
  3::smallint,
  'o intervalo sugerido de retorno continua funcionando'
);

select lives_ok(
  $$update public.services
    set estimated_duration_minutes = 210
    where name = 'Servico Com Duracao'$$,
  'a conta autorizada continua podendo atualizar services'
);
select is(
  (select estimated_duration_minutes
   from public.services
   where name = 'Servico Com Duracao'),
  210::smallint,
  'a atualizacao autorizada da duracao foi aplicada'
);

select throws_ok(
  $$insert into public.services (name, estimated_duration_minutes)
    values ('Servico Duracao Zero', 0)$$,
  '23514',
  'new row for relation "services" violates check constraint "services_estimated_duration_minutes_positive"',
  'duracao zero e rejeitada'
);
select throws_ok(
  $$insert into public.services (name, estimated_duration_minutes)
    values ('Servico Duracao Negativa', -1)$$,
  '23514',
  'new row for relation "services" violates check constraint "services_estimated_duration_minutes_positive"',
  'duracao negativa e rejeitada'
);

set local "request.jwt.claims" =
  '{"sub":"80000000-0000-4000-8000-000000000008","role":"authenticated"}';

select is(
  (select count(*) from public.services),
  0::bigint,
  'outra conta autenticada nao enxerga services'
);
select lives_ok(
  $$update public.services set estimated_duration_minutes = 240$$,
  'RLS bloqueia a atualizacao de outra conta sem expor dados'
);

set local "request.jwt.claims" =
  '{"sub":"70000000-0000-4000-8000-000000000007","role":"authenticated"}';

select is(
  (select estimated_duration_minutes
   from public.services
   where name = 'Servico Com Duracao'),
  210::smallint,
  'a tentativa de outra conta nao alterou services'
);

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';

select throws_ok(
  $$select count(*) from public.services$$,
  '42501',
  'permission denied for table services',
  'anon continua sem permissao em services'
);

select * from finish();
rollback;
