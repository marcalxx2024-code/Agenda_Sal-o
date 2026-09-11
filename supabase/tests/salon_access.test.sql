begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

select has_function(
  'public',
  'has_salon_access',
  array[]::text[],
  'has_salon_access existe sem parametros'
);
select function_returns(
  'public',
  'has_salon_access',
  array[]::text[],
  'boolean',
  'has_salon_access retorna boolean'
);
select volatility_is(
  'public',
  'has_salon_access',
  array[]::text[],
  'stable',
  'has_salon_access e read-only para o planejador'
);
select ok(
  not (
    select prosecdef
    from pg_proc
    where oid = 'public.has_salon_access()'::regprocedure
  ),
  'o wrapper publico nao eleva privilegios'
);

insert into auth.users (id, email)
values
  ('a0000000-0000-4000-8000-000000000001', 'access.salao@example.test'),
  ('a0000000-0000-4000-8000-000000000002', 'access.sem.salao@example.test');

insert into agenda_salao_private.salon_users (user_id)
values ('a0000000-0000-4000-8000-000000000001');

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  public.has_salon_access(),
  true,
  'usuario presente em salon_users possui acesso'
);

set local "request.jwt.claims" =
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  public.has_salon_access(),
  false,
  'usuario ausente de salon_users nao possui acesso'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'agenda_salao_private.salon_users',
    'INSERT, UPDATE, DELETE'
  ),
  'authenticated nao recebe privilegios de escrita em salon_users'
);
select throws_ok(
  $$insert into agenda_salao_private.salon_users (user_id)
    values ('a0000000-0000-4000-8000-000000000002')$$,
  '42501',
  'permission denied for table salon_users',
  'a funcao nao permite manipular salon_users'
);

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';

select throws_ok(
  $$select public.has_salon_access()$$,
  '42501',
  'permission denied for function has_salon_access',
  'anon nao pode executar has_salon_access'
);

select * from finish();
rollback;
