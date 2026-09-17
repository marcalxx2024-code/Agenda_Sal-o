-- Close two integrity gaps without changing the public API:
-- 1. appointment dates cannot be in the future in the salon timezone;
-- 2. schedule blocks cannot overlap each other.

create or replace function agenda_salao_private.validate_schedule_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Serialize block validation with booking validation/creation so that a
  -- concurrent booking or block cannot pass a stale conflict check.
  perform pg_advisory_xact_lock(731945210);

  if exists (
    select 1
    from public.bookings as b
    where b.status in ('scheduled', 'confirmed')
      and tstzrange(b.starts_at, b.ends_at, '[)')
          && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'schedule block conflicts with an active booking'
      using errcode = '23P01';
  end if;

  if exists (
    select 1
    from public.schedule_blocks as sb
    where sb.id <> new.id
      and tstzrange(sb.starts_at, sb.ends_at, '[)')
          && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'schedule block conflicts with another schedule block'
      using errcode = '23P01';
  end if;

  return new;
end;
$$;

revoke all on function agenda_salao_private.validate_schedule_block()
from public, anon, authenticated;

create or replace function agenda_salao_private.validate_appointment_performed_on()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.performed_on >
      (statement_timestamp() at time zone 'America/Sao_Paulo')::date then
    raise exception 'p_performed_on must not be in the future'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all on function agenda_salao_private.validate_appointment_performed_on()
from public, anon, authenticated;

drop trigger if exists appointments_validate_performed_on
on public.appointments;

create trigger appointments_validate_performed_on
before insert or update of performed_on on public.appointments
for each row
execute function agenda_salao_private.validate_appointment_performed_on();
