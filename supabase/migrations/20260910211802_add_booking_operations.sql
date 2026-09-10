-- Transactional booking operations. Public wrappers keep stable Data API
-- signatures; privileged implementations stay outside exposed schemas.

create or replace function agenda_salao_private.validate_booking_request(
  p_client_id bigint,
  p_starts_at timestamptz,
  p_service_ids bigint[],
  p_duration_minutes integer
)
returns table (
  calculated_duration_minutes integer,
  requested_service_count integer
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
  has_service_without_duration boolean := false;
  suggested_duration_minutes bigint := 0;
begin
  if p_client_id is null then
    raise exception 'p_client_id is required'
      using errcode = '22023';
  end if;

  if p_starts_at is null then
    raise exception 'p_starts_at is required'
      using errcode = '22023';
  end if;

  if p_starts_at <= statement_timestamp() then
    raise exception 'p_starts_at must be in the future'
      using errcode = '22023';
  end if;

  if p_duration_minutes is not null and p_duration_minutes <= 0 then
    raise exception 'p_duration_minutes must be greater than zero'
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

  -- Lock services in one deterministic order. The snapshots copied by the
  -- caller cannot change between validation and insertion.
  for locked_service in
    select s.id, s.active, s.estimated_duration_minutes
    from public.services as s
    where s.id = any (p_service_ids)
    order by s.id
    for share
  loop
    locked_service_count := locked_service_count + 1;
    has_inactive_service :=
      has_inactive_service or not locked_service.active;
    has_service_without_duration :=
      has_service_without_duration
      or locked_service.estimated_duration_minutes is null;
    suggested_duration_minutes :=
      suggested_duration_minutes
      + coalesce(locked_service.estimated_duration_minutes, 0);
  end loop;

  if locked_service_count <> cardinality(p_service_ids) then
    raise exception 'one or more services do not exist'
      using errcode = '23503';
  end if;

  if has_inactive_service then
    raise exception 'all services must be active'
      using errcode = '55000';
  end if;

  if has_service_without_duration then
    raise exception 'all services must have an estimated duration'
      using errcode = '55000';
  end if;

  if suggested_duration_minutes > 2147483647 then
    raise exception 'the total estimated duration is too large'
      using errcode = '22003';
  end if;

  return query
  select
    coalesce(p_duration_minutes, suggested_duration_minutes::integer),
    locked_service_count;
end;
$$;

create or replace function agenda_salao_private.create_booking(
  p_client_id bigint,
  p_starts_at timestamptz,
  p_service_ids bigint[],
  p_duration_minutes integer default null,
  p_notes text default null
)
returns table (
  booking_id bigint,
  booking_client_id bigint,
  booking_starts_at timestamptz,
  booking_ends_at timestamptz,
  booking_status text,
  service_count integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  validated_duration_minutes integer;
  validated_service_count integer;
  new_booking_id bigint;
begin
  if not agenda_salao_private.is_salon_user() then
    raise exception 'only the authorized salon account can create bookings'
      using errcode = '42501';
  end if;

  select
    validation.calculated_duration_minutes,
    validation.requested_service_count
  into validated_duration_minutes, validated_service_count
  from agenda_salao_private.validate_booking_request(
    p_client_id,
    p_starts_at,
    p_service_ids,
    p_duration_minutes
  ) as validation;

  begin
    insert into public.bookings (
      client_id,
      starts_at,
      ends_at,
      status,
      notes
    )
    values (
      p_client_id,
      p_starts_at,
      p_starts_at + make_interval(mins => validated_duration_minutes),
      'scheduled',
      p_notes
    )
    returning id into new_booking_id;
  exception
    when exclusion_violation then
      raise exception 'booking time conflicts with another active booking'
        using errcode = '23P01';
  end;

  insert into public.booking_services (
    booking_id,
    service_id,
    service_name,
    estimated_duration_minutes
  )
  select
    new_booking_id,
    s.id,
    s.name,
    s.estimated_duration_minutes
  from public.services as s
  where s.id = any (p_service_ids)
  order by array_position(p_service_ids, s.id);

  return query
  select
    b.id,
    b.client_id,
    b.starts_at,
    b.ends_at,
    b.status,
    validated_service_count
  from public.bookings as b
  where b.id = new_booking_id;
end;
$$;

create or replace function agenda_salao_private.update_booking(
  p_booking_id bigint,
  p_client_id bigint,
  p_starts_at timestamptz,
  p_service_ids bigint[],
  p_duration_minutes integer default null,
  p_notes text default null
)
returns table (
  booking_id bigint,
  booking_client_id bigint,
  booking_starts_at timestamptz,
  booking_ends_at timestamptz,
  booking_status text,
  service_count integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_status text;
  validated_duration_minutes integer;
  validated_service_count integer;
begin
  if not agenda_salao_private.is_salon_user() then
    raise exception 'only the authorized salon account can update bookings'
      using errcode = '42501';
  end if;

  if p_booking_id is null then
    raise exception 'p_booking_id is required'
      using errcode = '22023';
  end if;

  select b.status
  into current_status
  from public.bookings as b
  where b.id = p_booking_id
  for update;

  if not found then
    raise exception 'booking % does not exist', p_booking_id
      using errcode = 'P0002';
  end if;

  if current_status not in ('scheduled', 'confirmed') then
    raise exception 'booking % in status % cannot be edited',
      p_booking_id,
      current_status
      using errcode = '55000';
  end if;

  select
    validation.calculated_duration_minutes,
    validation.requested_service_count
  into validated_duration_minutes, validated_service_count
  from agenda_salao_private.validate_booking_request(
    p_client_id,
    p_starts_at,
    p_service_ids,
    p_duration_minutes
  ) as validation;

  begin
    update public.bookings as b
    set client_id = p_client_id,
        starts_at = p_starts_at,
        ends_at = p_starts_at
          + make_interval(mins => validated_duration_minutes),
        notes = p_notes
    where b.id = p_booking_id;
  exception
    when exclusion_violation then
      raise exception 'booking time conflicts with another active booking'
        using errcode = '23P01';
  end;

  delete from public.booking_services as bs
  where bs.booking_id = p_booking_id;

  insert into public.booking_services (
    booking_id,
    service_id,
    service_name,
    estimated_duration_minutes
  )
  select
    p_booking_id,
    s.id,
    s.name,
    s.estimated_duration_minutes
  from public.services as s
  where s.id = any (p_service_ids)
  order by array_position(p_service_ids, s.id);

  return query
  select
    b.id,
    b.client_id,
    b.starts_at,
    b.ends_at,
    b.status,
    validated_service_count
  from public.bookings as b
  where b.id = p_booking_id;
end;
$$;

create or replace function agenda_salao_private.transition_booking_status(
  p_booking_id bigint,
  p_target_status text
)
returns table (
  booking_id bigint,
  booking_status text,
  status_updated_at timestamptz,
  updated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_booking public.bookings%rowtype;
begin
  if not agenda_salao_private.is_salon_user() then
    raise exception 'only the authorized salon account can change booking status'
      using errcode = '42501';
  end if;

  if p_booking_id is null then
    raise exception 'p_booking_id is required'
      using errcode = '22023';
  end if;

  if p_target_status not in ('confirmed', 'cancelled', 'no_show') then
    raise exception 'unsupported booking target status %', p_target_status
      using errcode = '22023';
  end if;

  select b.*
  into current_booking
  from public.bookings as b
  where b.id = p_booking_id
  for update;

  if not found then
    raise exception 'booking % does not exist', p_booking_id
      using errcode = 'P0002';
  end if;

  -- Repeating the same requested transition is idempotent and does not touch
  -- either timestamp.
  if current_booking.status = p_target_status then
    return query
    select
      current_booking.id,
      current_booking.status,
      current_booking.status_updated_at,
      current_booking.updated_at;
    return;
  end if;

  if p_target_status = 'confirmed'
     and current_booking.status <> 'scheduled' then
    raise exception 'booking % cannot transition from % to confirmed',
      p_booking_id,
      current_booking.status
      using errcode = '55000';
  elsif p_target_status = 'cancelled'
        and current_booking.status not in ('scheduled', 'confirmed') then
    raise exception 'booking % cannot transition from % to cancelled',
      p_booking_id,
      current_booking.status
      using errcode = '55000';
  elsif p_target_status = 'no_show'
        and current_booking.status not in ('scheduled', 'confirmed') then
    raise exception 'booking % cannot transition from % to no_show',
      p_booking_id,
      current_booking.status
      using errcode = '55000';
  end if;

  if p_target_status = 'no_show'
     and current_booking.starts_at > statement_timestamp() then
    raise exception 'booking cannot be marked no_show before starts_at'
      using errcode = '55000';
  end if;

  update public.bookings as b
  set status = p_target_status
  where b.id = p_booking_id
  returning b.* into current_booking;

  return query
  select
    current_booking.id,
    current_booking.status,
    current_booking.status_updated_at,
    current_booking.updated_at;
end;
$$;

revoke all on function
  agenda_salao_private.validate_booking_request(bigint, timestamptz, bigint[], integer),
  agenda_salao_private.create_booking(bigint, timestamptz, bigint[], integer, text),
  agenda_salao_private.update_booking(bigint, bigint, timestamptz, bigint[], integer, text),
  agenda_salao_private.transition_booking_status(bigint, text)
from public, anon, authenticated;

-- Public invoker wrappers need access to the private implementations. The
-- private schema itself remains outside the Data API, and each definer repeats
-- the salon-user authorization check.
grant execute on function
  agenda_salao_private.create_booking(bigint, timestamptz, bigint[], integer, text),
  agenda_salao_private.update_booking(bigint, bigint, timestamptz, bigint[], integer, text),
  agenda_salao_private.transition_booking_status(bigint, text)
to authenticated;

create or replace function public.create_booking(
  p_client_id bigint,
  p_starts_at timestamptz,
  p_service_ids bigint[],
  p_duration_minutes integer default null,
  p_notes text default null
)
returns table (
  booking_id bigint,
  booking_client_id bigint,
  booking_starts_at timestamptz,
  booking_ends_at timestamptz,
  booking_status text,
  service_count integer
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from agenda_salao_private.create_booking(
    p_client_id,
    p_starts_at,
    p_service_ids,
    p_duration_minutes,
    p_notes
  );
$$;

create or replace function public.update_booking(
  p_booking_id bigint,
  p_client_id bigint,
  p_starts_at timestamptz,
  p_service_ids bigint[],
  p_duration_minutes integer default null,
  p_notes text default null
)
returns table (
  booking_id bigint,
  booking_client_id bigint,
  booking_starts_at timestamptz,
  booking_ends_at timestamptz,
  booking_status text,
  service_count integer
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from agenda_salao_private.update_booking(
    p_booking_id,
    p_client_id,
    p_starts_at,
    p_service_ids,
    p_duration_minutes,
    p_notes
  );
$$;

create or replace function public.confirm_booking(p_booking_id bigint)
returns table (
  booking_id bigint,
  booking_status text,
  status_updated_at timestamptz,
  updated_at timestamptz
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from agenda_salao_private.transition_booking_status(
    p_booking_id,
    'confirmed'
  );
$$;

create or replace function public.cancel_booking(p_booking_id bigint)
returns table (
  booking_id bigint,
  booking_status text,
  status_updated_at timestamptz,
  updated_at timestamptz
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from agenda_salao_private.transition_booking_status(
    p_booking_id,
    'cancelled'
  );
$$;

create or replace function public.mark_booking_no_show(p_booking_id bigint)
returns table (
  booking_id bigint,
  booking_status text,
  status_updated_at timestamptz,
  updated_at timestamptz
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from agenda_salao_private.transition_booking_status(
    p_booking_id,
    'no_show'
  );
$$;

comment on function public.create_booking(bigint, timestamptz, bigint[], integer, text) is
  'Creates a scheduled booking atomically. Uses the sum of service duration snapshots unless a positive manual total duration is supplied.';
comment on function public.update_booking(bigint, bigint, timestamptz, bigint[], integer, text) is
  'Replaces editable booking details and service snapshots atomically while preserving scheduled or confirmed status.';
comment on function public.confirm_booking(bigint) is
  'Transitions a scheduled booking to confirmed. Repeated confirmation is idempotent.';
comment on function public.cancel_booking(bigint) is
  'Transitions a scheduled or confirmed booking to cancelled. Repeated cancellation is idempotent.';
comment on function public.mark_booking_no_show(bigint) is
  'Transitions a started scheduled or confirmed booking to no_show using database time. Repeated marking is idempotent.';

revoke all on function
  public.create_booking(bigint, timestamptz, bigint[], integer, text),
  public.update_booking(bigint, bigint, timestamptz, bigint[], integer, text),
  public.confirm_booking(bigint),
  public.cancel_booking(bigint),
  public.mark_booking_no_show(bigint)
from public, anon, authenticated;

grant execute on function
  public.create_booking(bigint, timestamptz, bigint[], integer, text),
  public.update_booking(bigint, bigint, timestamptz, bigint[], integer, text),
  public.confirm_booking(bigint),
  public.cancel_booking(bigint),
  public.mark_booking_no_show(bigint)
to authenticated;
