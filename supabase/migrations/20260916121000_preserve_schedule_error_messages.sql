-- The booking RPC translates exclusion_violation (23P01) into the standard
-- booking-overlap message. Use a domain exception for break/block conflicts so
-- their specific messages reach API clients unchanged.
create or replace function agenda_salao_private.validate_booking_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  salon_zone constant text := 'America/Sao_Paulo';
  local_start timestamp;
  local_end timestamp;
  hours public.business_hours%rowtype;
begin
  if new.status not in ('scheduled', 'confirmed') then
    return new;
  end if;

  -- Let the table's existing check constraint keep its established error
  -- contract for invalid ranges before this trigger builds range values.
  if new.starts_at >= new.ends_at then
    return new;
  end if;

  perform pg_advisory_xact_lock(731945210);
  local_start := new.starts_at at time zone salon_zone;
  local_end := new.ends_at at time zone salon_zone;

  if local_start::date <> local_end::date then
    raise exception 'booking must start and end on the same salon day'
      using errcode = '23514';
  end if;

  select bh.* into hours
  from public.business_hours as bh
  where bh.weekday = extract(dow from local_start)::smallint;

  if not found or not hours.is_open then
    raise exception 'salon is closed on the selected day'
      using errcode = '23514';
  end if;

  if local_start::time < hours.opens_at or local_end::time > hours.closes_at then
    raise exception 'booking is outside business hours'
      using errcode = '23514';
  end if;

  if hours.break_starts_at is not null
     and local_start::time < hours.break_ends_at
     and local_end::time > hours.break_starts_at then
    raise exception 'booking conflicts with the business break'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.schedule_blocks as sb
    where tstzrange(sb.starts_at, sb.ends_at, '[)')
          && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'booking time conflicts with a schedule block'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function agenda_salao_private.validate_booking_schedule()
from public, anon, authenticated;
