-- Complete a booking through the same appointment creation path used by
-- standalone appointments. Planning snapshots remain separate from performed
-- service snapshots.

create or replace function agenda_salao_private.create_appointment_record(
  p_client_id bigint,
  p_performed_on date,
  p_service_ids bigint[],
  p_notes text,
  p_booking_id bigint,
  p_allowed_inactive_service_ids bigint[]
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
  has_disallowed_inactive_service boolean := false;
  new_appointment_id bigint;
  inserted_service_count integer;
  generated_return_count integer;
begin
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

  -- Lock in a deterministic order. Inactive services are accepted only when
  -- the caller proves they were already part of this booking's plan.
  for locked_service in
    select s.id, s.active
    from public.services as s
    where s.id = any (p_service_ids)
    order by s.id
    for share
  loop
    locked_service_count := locked_service_count + 1;
    has_disallowed_inactive_service :=
      has_disallowed_inactive_service
      or (
        not locked_service.active
        and not (
          locked_service.id = any (
            coalesce(p_allowed_inactive_service_ids, array[]::bigint[])
          )
        )
      );
  end loop;

  if locked_service_count <> cardinality(p_service_ids) then
    raise exception 'one or more services do not exist'
      using errcode = '23503';
  end if;

  if has_disallowed_inactive_service then
    if p_booking_id is null then
      raise exception 'all services must be active'
        using errcode = '55000';
    end if;

    raise exception 'inactive services must have been planned in the booking'
      using errcode = '55000';
  end if;

  insert into public.appointments (
    client_id,
    performed_on,
    notes,
    booking_id
  )
  values (
    p_client_id,
    p_performed_on,
    p_notes,
    p_booking_id
  )
  returning id into new_appointment_id;

  -- Existing triggers copy the performed-service snapshots and synchronize
  -- returns. This insert is intentionally identical for both entry points.
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

-- Preserve the standalone appointment RPC and delegate its business rules to
-- the shared core. No inactive service is allowed for standalone records.
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
begin
  if not agenda_salao_private.is_salon_user() then
    raise exception 'only the authorized salon account can create appointments'
      using errcode = '42501';
  end if;

  return query
  select *
  from agenda_salao_private.create_appointment_record(
    p_client_id,
    p_performed_on,
    p_service_ids,
    p_notes,
    null,
    array[]::bigint[]
  );
end;
$$;

create or replace function agenda_salao_private.complete_booking(
  p_booking_id bigint,
  p_performed_on date,
  p_service_ids bigint[],
  p_notes text default null
)
returns table (
  booking_id bigint,
  appointment_id bigint,
  booking_status text,
  performed_on date,
  service_count integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  locked_booking public.bookings%rowtype;
  linked_appointment_id bigint;
  linked_performed_on date;
  linked_service_count integer;
  planned_service_ids bigint[];
  created_appointment record;
begin
  if not agenda_salao_private.is_salon_user() then
    raise exception 'only the authorized salon account can complete bookings'
      using errcode = '42501';
  end if;

  if p_booking_id is null then
    raise exception 'p_booking_id is required'
      using errcode = '22023';
  end if;

  select b.*
  into locked_booking
  from public.bookings as b
  where b.id = p_booking_id
  for update;

  if not found then
    raise exception 'booking % does not exist', p_booking_id
      using errcode = 'P0002';
  end if;

  select a.id, a.performed_on
  into linked_appointment_id, linked_performed_on
  from public.appointments as a
  where a.booking_id = p_booking_id;

  if locked_booking.status = 'completed' then
    if linked_appointment_id is null then
      raise exception 'completed booking % has no linked appointment', p_booking_id
        using errcode = 'XX000';
    end if;

    select count(*)::integer
    into linked_service_count
    from public.appointment_services as aps
    where aps.appointment_id = linked_appointment_id;

    return query
    select
      p_booking_id,
      linked_appointment_id,
      locked_booking.status,
      linked_performed_on,
      linked_service_count;
    return;
  end if;

  if locked_booking.status not in ('scheduled', 'confirmed') then
    raise exception 'booking % cannot be completed from status %',
      p_booking_id, locked_booking.status
      using errcode = '55000';
  end if;

  if linked_appointment_id is not null then
    raise exception 'active booking % already has a linked appointment', p_booking_id
      using errcode = 'XX000';
  end if;

  select coalesce(array_agg(bs.service_id order by bs.service_id), array[]::bigint[])
  into planned_service_ids
  from public.booking_services as bs
  where bs.booking_id = p_booking_id;

  select *
  into created_appointment
  from agenda_salao_private.create_appointment_record(
    locked_booking.client_id,
    p_performed_on,
    p_service_ids,
    p_notes,
    p_booking_id,
    planned_service_ids
  );

  update public.bookings as b
  set status = 'completed'
  where b.id = p_booking_id;

  return query
  select
    p_booking_id,
    created_appointment.appointment_id,
    'completed'::text,
    created_appointment.appointment_performed_on,
    created_appointment.service_count;
end;
$$;

revoke all on function
  agenda_salao_private.create_appointment_record(bigint, date, bigint[], text, bigint, bigint[]),
  agenda_salao_private.complete_booking(bigint, date, bigint[], text)
from public, anon, authenticated;

-- Reassert the existing private RPC privilege after replacing its body.
revoke all on function
  agenda_salao_private.create_appointment_with_services(bigint, date, bigint[], text)
from public, anon, authenticated;

grant execute on function
  agenda_salao_private.create_appointment_with_services(bigint, date, bigint[], text),
  agenda_salao_private.complete_booking(bigint, date, bigint[], text)
to authenticated;

create or replace function public.complete_booking(
  p_booking_id bigint,
  p_performed_on date,
  p_service_ids bigint[],
  p_notes text default null
)
returns table (
  booking_id bigint,
  appointment_id bigint,
  booking_status text,
  performed_on date,
  service_count integer
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from agenda_salao_private.complete_booking(
    p_booking_id,
    p_performed_on,
    p_service_ids,
    p_notes
  );
$$;

revoke all on function public.complete_booking(bigint, date, bigint[], text)
from public, anon, authenticated;

grant execute on function public.complete_booking(bigint, date, bigint[], text)
to authenticated;

comment on function public.complete_booking(bigint, date, bigint[], text) is
  'Completes one scheduled or confirmed booking, atomically creates its linked appointment through the shared performed-service workflow, and returns booking_id, appointment_id, booking_status, performed_on, and service_count. Repeated completion returns the existing consistent link.';
