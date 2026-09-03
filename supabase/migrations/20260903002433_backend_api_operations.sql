-- Operacoes transacionais expostas ao futuro frontend pela Data API.
-- Ambas executam com os privilegios do chamador e, portanto, respeitam RLS.

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
language plpgsql
volatile
security invoker
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

  -- Lock in a deterministic order so validation remains true until insertion.
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

  -- The existing triggers populate snapshots and create the corresponding
  -- returns. The API never accepts snapshot fields from the caller.
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

comment on function public.create_appointment_with_services(bigint, date, bigint[], text) is
  'Creates one appointment and its service items atomically. Inputs: active client id, performed date, non-empty unique active service ids, and optional notes. Returns the appointment identity, performed date and item/return counts. Raises 22023 for invalid input, 23503 for missing records, 55000 for inactive records, and 42501 for an unauthorized caller.';

create or replace function public.mark_return_contacted(
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
security invoker
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

  -- Repeated confirmations are idempotent: preserve the first timestamp,
  -- first note and current status, then return the existing row.
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

comment on function public.mark_return_contacted(bigint, text) is
  'Confirms a return contact using the database statement timestamp and an optional note without changing status. Repeated calls preserve the first contact timestamp and note and return the existing identity, timestamp and status. Raises 22023 for a null id, P0002 for a missing return, and 42501 for an unauthorized caller.';

revoke all on function
  public.create_appointment_with_services(bigint, date, bigint[], text),
  public.mark_return_contacted(bigint, text)
from public, anon, authenticated;

grant execute on function
  public.create_appointment_with_services(bigint, date, bigint[], text),
  public.mark_return_contacted(bigint, text)
to authenticated;
