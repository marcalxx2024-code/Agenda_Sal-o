-- Enforce critical business operations behind RPCs while keeping their public
-- signatures stable. Privileged implementations live outside exposed schemas.

create or replace function agenda_salao_private.create_appointment_with_services(
  p_client_id bigint,
  p_performed_on date,
  p_service_ids bigint[],
  p_notes text default null
)
returns table (
  appointment_id bigint,
  appointment_client_id bigint,
  appointment_performed_on date,
  service_count integer,
  return_count integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  client_is_active boolean;
  locked_service record;
  locked_service_count integer := 0;
  has_inactive_service boolean := false;
  new_appointment_id bigint;
  inserted_service_count integer;
  generated_return_count integer;
begin
  if not agenda_salao_private.is_salon_user() then
    raise exception 'only the authorized salon account can create appointments'
      using errcode = '42501';
  end if;

  if p_client_id is null then
    raise exception 'p_client_id is required'
      using errcode = '22023';
  end if;

  if p_performed_on is null then
    raise exception 'p_performed_on is required'
      using errcode = '22023';
  end if;

  if p_service_ids is null or cardinality(p_service_ids) = 0 then
    raise exception 'p_service_ids must contain at least one service'
      using errcode = '22023';
  end if;

  if array_position(p_service_ids, null) is not null then
    raise exception 'p_service_ids must not contain null values'
      using errcode = '22023';
  end if;

  if (
    select count(distinct requested_service_id)
    from unnest(p_service_ids) as requested(requested_service_id)
  ) <> cardinality(p_service_ids) then
    raise exception 'p_service_ids must not contain duplicate services'
      using errcode = '22023';
  end if;

  select c.active
  into client_is_active
  from public.clients as c
  where c.id = p_client_id
  for share;

  if not found then
    raise exception 'client % does not exist', p_client_id
      using errcode = '23503';
  end if;

  if not client_is_active then
    raise exception 'client % is inactive', p_client_id
      using errcode = '55000';
  end if;

  for locked_service in
    select s.id, s.active
    from public.services as s
    where s.id = any (p_service_ids)
    order by s.id
    for share
  loop
    locked_service_count := locked_service_count + 1;
    has_inactive_service := has_inactive_service or not locked_service.active;
  end loop;

  if locked_service_count <> cardinality(p_service_ids) then
    raise exception 'one or more services do not exist'
      using errcode = '23503';
  end if;

  if has_inactive_service then
    raise exception 'all services must be active'
      using errcode = '55000';
  end if;

  insert into public.appointments (client_id, performed_on, notes)
  values (p_client_id, p_performed_on, p_notes)
  returning id into new_appointment_id;

  insert into public.appointment_services (appointment_id, service_id)
  select new_appointment_id, requested.service_id
  from unnest(p_service_ids) with ordinality
    as requested(service_id, item_order)
  order by requested.item_order;

  get diagnostics inserted_service_count = row_count;

  select count(*)::integer
  into generated_return_count
  from public.returns as r
  join public.appointment_services as aps
    on aps.id = r.appointment_service_id
  where aps.appointment_id = new_appointment_id;

  return query
  select
    new_appointment_id,
    p_client_id,
    p_performed_on,
    inserted_service_count,
    generated_return_count;
end;
$$;

create or replace function agenda_salao_private.mark_return_contacted(
  p_return_id bigint,
  p_note text default null
)
returns table (
  return_id bigint,
  contacted_at timestamptz,
  status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not agenda_salao_private.is_salon_user() then
    raise exception 'only the authorized salon account can mark return contact'
      using errcode = '42501';
  end if;

  if p_return_id is null then
    raise exception 'p_return_id is required'
      using errcode = '22023';
  end if;

  return query
  update public.returns as r
  set contacted_at = statement_timestamp(),
      contact_note = p_note
  where r.id = p_return_id
    and r.contacted_at is null
  returning r.id, r.contacted_at, r.status;

  if found then
    return;
  end if;

  return query
  select r.id, r.contacted_at, r.status
  from public.returns as r
  where r.id = p_return_id;

  if not found then
    raise exception 'return % does not exist', p_return_id
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function
  agenda_salao_private.create_appointment_with_services(bigint, date, bigint[], text),
  agenda_salao_private.mark_return_contacted(bigint, text)
from public, anon, authenticated;

-- The invoker wrappers need EXECUTE, but the private schema is not exposed by
-- the Data API. The implementations also repeat the salon-user authorization.
grant execute on function
  agenda_salao_private.create_appointment_with_services(bigint, date, bigint[], text),
  agenda_salao_private.mark_return_contacted(bigint, text)
to authenticated;

create or replace function public.create_appointment_with_services(
  p_client_id bigint,
  p_performed_on date,
  p_service_ids bigint[],
  p_notes text default null
)
returns table (
  appointment_id bigint,
  appointment_client_id bigint,
  appointment_performed_on date,
  service_count integer,
  return_count integer
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from agenda_salao_private.create_appointment_with_services(
    p_client_id,
    p_performed_on,
    p_service_ids,
    p_notes
  );
$$;

create or replace function public.mark_return_contacted(
  p_return_id bigint,
  p_note text default null
)
returns table (
  return_id bigint,
  contacted_at timestamptz,
  status text
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from agenda_salao_private.mark_return_contacted(p_return_id, p_note);
$$;

revoke all on function
  public.create_appointment_with_services(bigint, date, bigint[], text),
  public.mark_return_contacted(bigint, text)
from public, anon, authenticated;

grant execute on function
  public.create_appointment_with_services(bigint, date, bigint[], text),
  public.mark_return_contacted(bigint, text)
to authenticated;

-- Date corrections still need to refresh protected service items. Run that
-- internal trigger with owner privileges, but retain the explicit caller check.
create or replace function agenda_salao_private.refresh_appointment_services()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not agenda_salao_private.is_salon_user() then
    raise exception 'only the authorized salon account can refresh appointment services'
      using errcode = '42501';
  end if;

  if new.performed_on is distinct from old.performed_on then
    update public.appointment_services
    set appointment_id = appointment_id
    where appointment_id = new.id;
  end if;

  return new;
end;
$$;

-- Appointments can only be created by the transactional RPC. Existing records
-- retain safe direct corrections for their date and free-form notes.
revoke insert, update, delete on table public.appointments from authenticated;
grant select on table public.appointments to authenticated;
grant update (performed_on, notes) on table public.appointments to authenticated;

-- Service items and their historical snapshots are managed only by the RPC and
-- database triggers. The frontend may read them but cannot mutate them.
revoke insert, update, delete on table public.appointment_services
from authenticated;
grant select on table public.appointment_services to authenticated;

-- Contact metadata is written only by mark_return_contacted. Status remains a
-- separate manual action, as designed by the existing model.
revoke update (contacted_at, contact_note) on table public.returns
from authenticated;
grant select on table public.returns to authenticated;
grant update (status) on table public.returns to authenticated;

-- These identity sequences are no longer needed by direct client operations.
revoke usage, select on sequence
  public.appointments_id_seq,
  public.appointment_services_id_seq,
  public.returns_id_seq
from authenticated;

-- Narrow policies as defense in depth so a later accidental GRANT does not
-- silently restore writes that are meant to go through privileged operations.
drop policy salon_account_all on public.appointments;

create policy salon_account_select on public.appointments
for select to authenticated
using ((select agenda_salao_private.is_salon_user()));

create policy salon_account_update on public.appointments
for update to authenticated
using ((select agenda_salao_private.is_salon_user()))
with check ((select agenda_salao_private.is_salon_user()));

drop policy salon_account_all on public.appointment_services;

create policy salon_account_select on public.appointment_services
for select to authenticated
using ((select agenda_salao_private.is_salon_user()));
