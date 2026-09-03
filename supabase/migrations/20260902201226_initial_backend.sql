-- Agenda Salao: schema inicial.
-- A aplicacao usa o schema public pela Data API. A lista de contas autorizadas
-- fica em agenda_salao_private, fora dos schemas expostos no config.toml.

create schema if not exists agenda_salao_private;

revoke all on schema agenda_salao_private from public, anon, authenticated;

create table agenda_salao_private.salon_users (
  user_id uuid primary key references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table agenda_salao_private.salon_users enable row level security;

create or replace function agenda_salao_private.is_salon_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from agenda_salao_private.salon_users
      where user_id = (select auth.uid())
    );
$$;

create or replace function agenda_salao_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.calendar_months_after(
  base_date date,
  month_count integer
)
returns date
language plpgsql
immutable
strict
set search_path = ''
as $$
begin
  if month_count < 1 or month_count > 120 then
    raise exception 'month_count must be between 1 and 120'
      using errcode = '22023';
  end if;

  return (base_date + make_interval(months => month_count))::date;
end;
$$;

create table public.clients (
  id bigint generated always as identity primary key,
  name text not null check (length(btrim(name)) between 2 and 150),
  phone text not null check (length(btrim(phone)) between 8 and 30),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.services (
  id bigint generated always as identity primary key,
  name text not null check (length(btrim(name)) between 2 and 120),
  suggested_return_months smallint
    check (suggested_return_months between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.appointments (
  id bigint generated always as identity primary key,
  client_id bigint not null references public.clients (id) on delete restrict,
  performed_on date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.appointment_services (
  id bigint generated always as identity primary key,
  appointment_id bigint not null
    references public.appointments (id) on delete cascade,
  service_id bigint not null references public.services (id) on delete restrict,
  -- O default torna o campo opcional nos tipos gerados. O trigger sempre o
  -- substitui pelo nome atual do servico antes de validar/gravar a linha.
  service_name text not null default '',
  return_interval_months smallint,
  return_due_on date,
  created_at timestamptz not null default now(),
  constraint appointment_services_one_service_per_appointment
    unique (appointment_id, service_id),
  constraint appointment_services_return_consistency check (
    (return_interval_months is null and return_due_on is null)
    or
    (
      return_interval_months between 1 and 120
      and return_due_on is not null
    )
  )
);

create table public.returns (
  id bigint generated always as identity primary key,
  appointment_service_id bigint not null unique
    references public.appointment_services (id) on delete cascade,
  due_on date not null,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'cancelled')),
  contacted_at timestamptz,
  contact_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.appointment_services.return_interval_months is
  'Snapshot do intervalo do servico no momento em que o atendimento foi registrado.';
comment on column public.appointment_services.return_due_on is
  'Data calculada em meses de calendario, preservada no historico.';
comment on column public.returns.contacted_at is
  'Preencher somente apos confirmacao humana do contato; abrir o WhatsApp nao confirma envio.';

create index appointments_client_id_idx
  on public.appointments (client_id);
create unique index services_name_unique_ci_idx
  on public.services (lower(name));
create index appointments_performed_on_idx
  on public.appointments (performed_on desc);
create index appointment_services_service_id_idx
  on public.appointment_services (service_id);
create index returns_pending_due_on_idx
  on public.returns (due_on)
  where status = 'pending';

create or replace function agenda_salao_private.prepare_appointment_service()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_service public.services%rowtype;
  appointment_date date;
begin
  select *
  into selected_service
  from public.services
  where id = new.service_id;

  if not found then
    raise exception 'service % does not exist', new.service_id
      using errcode = '23503';
  end if;

  select performed_on
  into appointment_date
  from public.appointments
  where id = new.appointment_id;

  if not found then
    raise exception 'appointment % does not exist', new.appointment_id
      using errcode = '23503';
  end if;

  if tg_op = 'INSERT' or new.service_id is distinct from old.service_id then
    new.service_name = selected_service.name;
    new.return_interval_months = selected_service.suggested_return_months;
  else
    -- Impede que uma atualizacao comum reescreva o snapshot historico.
    new.service_name = old.service_name;
    new.return_interval_months = old.return_interval_months;
  end if;

  if new.return_interval_months is null then
    new.return_due_on = null;
  else
    new.return_due_on = public.calendar_months_after(
      appointment_date,
      new.return_interval_months
    );
  end if;

  return new;
end;
$$;

create or replace function agenda_salao_private.sync_return_from_service()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not agenda_salao_private.is_salon_user() then
    raise exception 'only the authorized salon account can synchronize returns'
      using errcode = '42501';
  end if;

  if new.return_due_on is null then
    delete from public.returns
    where appointment_service_id = new.id;
  else
    insert into public.returns (appointment_service_id, due_on)
    values (new.id, new.return_due_on)
    on conflict (appointment_service_id) do update
      set due_on = excluded.due_on,
          updated_at = now();
  end if;

  return new;
end;
$$;

create or replace function agenda_salao_private.refresh_appointment_services()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.performed_on is distinct from old.performed_on then
    update public.appointment_services
    set appointment_id = appointment_id
    where appointment_id = new.id;
  end if;

  return new;
end;
$$;

create trigger clients_set_updated_at
before update on public.clients
for each row execute function agenda_salao_private.set_updated_at();

create trigger services_set_updated_at
before update on public.services
for each row execute function agenda_salao_private.set_updated_at();

create trigger appointments_set_updated_at
before update on public.appointments
for each row execute function agenda_salao_private.set_updated_at();

create trigger returns_set_updated_at
before update on public.returns
for each row execute function agenda_salao_private.set_updated_at();

create trigger appointment_services_prepare
before insert or update on public.appointment_services
for each row execute function agenda_salao_private.prepare_appointment_service();

create trigger appointment_services_sync_return
after insert or update on public.appointment_services
for each row execute function agenda_salao_private.sync_return_from_service();

create trigger appointments_refresh_services
after update of performed_on on public.appointments
for each row execute function agenda_salao_private.refresh_appointment_services();

alter table public.clients enable row level security;
alter table public.services enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_services enable row level security;
alter table public.returns enable row level security;

create policy salon_account_all on public.clients
for all to authenticated
using ((select agenda_salao_private.is_salon_user()))
with check ((select agenda_salao_private.is_salon_user()));

create policy salon_account_all on public.services
for all to authenticated
using ((select agenda_salao_private.is_salon_user()))
with check ((select agenda_salao_private.is_salon_user()));

create policy salon_account_all on public.appointments
for all to authenticated
using ((select agenda_salao_private.is_salon_user()))
with check ((select agenda_salao_private.is_salon_user()));

create policy salon_account_all on public.appointment_services
for all to authenticated
using ((select agenda_salao_private.is_salon_user()))
with check ((select agenda_salao_private.is_salon_user()));

create policy salon_account_select on public.returns
for select to authenticated
using ((select agenda_salao_private.is_salon_user()));

create policy salon_account_update on public.returns
for update to authenticated
using ((select agenda_salao_private.is_salon_user()))
with check ((select agenda_salao_private.is_salon_user()));

create view public.pending_returns
with (security_invoker = true, security_barrier = true)
as
select
  r.id,
  r.due_on,
  r.contacted_at,
  r.contact_note,
  a.performed_on,
  c.id as client_id,
  c.name as client_name,
  c.phone as client_phone,
  aps.service_name,
  aps.return_interval_months
from public.returns r
join public.appointment_services aps on aps.id = r.appointment_service_id
join public.appointments a on a.id = aps.appointment_id
join public.clients c on c.id = a.client_id
where r.status = 'pending';

revoke all on table
  public.clients,
  public.services,
  public.appointments,
  public.appointment_services,
  public.returns,
  public.pending_returns
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.clients,
  public.services,
  public.appointments,
  public.appointment_services
to authenticated;

grant select on table public.returns to authenticated;
grant update (status, contacted_at, contact_note) on table public.returns
to authenticated;
grant select on table public.pending_returns to authenticated;

revoke all on sequence
  public.clients_id_seq,
  public.services_id_seq,
  public.appointments_id_seq,
  public.appointment_services_id_seq,
  public.returns_id_seq
from public, anon, authenticated;

grant usage, select on sequence
  public.clients_id_seq,
  public.services_id_seq,
  public.appointments_id_seq,
  public.appointment_services_id_seq,
  public.returns_id_seq
to authenticated;

revoke execute on function public.calendar_months_after(date, integer)
from public, anon, authenticated;
grant execute on function public.calendar_months_after(date, integer)
to authenticated;

revoke execute on all functions in schema agenda_salao_private
from public, anon, authenticated;
grant usage on schema agenda_salao_private to authenticated;
grant execute on function agenda_salao_private.is_salon_user()
to authenticated;
