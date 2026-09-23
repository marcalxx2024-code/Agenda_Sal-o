-- Atualiza a semana inteira de expediente em uma unica transacao. Agendamentos
-- existentes nunca sao alterados; conflitos precisam de confirmacao explicita
-- sobre a lista exata observada sob o mesmo lock usado pela agenda.

create or replace function agenda_salao_private.update_business_hours_week(
  p_hours jsonb,
  p_confirm_conflicts boolean default false,
  p_expected_affected_booking_ids bigint[] default null
)
returns table (
  updated boolean,
  requires_confirmation boolean,
  conflicts_changed boolean,
  affected_booking_count integer,
  affected_booking_ids bigint[],
  affected_bookings jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_is_valid boolean := false;
  v_updated_count integer := 0;
  v_affected_booking_count integer := 0;
  v_affected_booking_ids bigint[] := array[]::bigint[];
  v_sorted_affected_booking_ids bigint[] := array[]::bigint[];
  v_expected_booking_ids bigint[] := array[]::bigint[];
  v_affected_bookings jsonb := '[]'::jsonb;
begin
  if not agenda_salao_private.is_salon_user() then
    raise exception 'only the authorized salon account can update business hours'
      using errcode = '42501';
  end if;

  if p_hours is null or jsonb_typeof(p_hours) <> 'array' then
    raise exception 'p_hours must be an array containing all seven weekdays'
      using errcode = '22023';
  end if;

  -- Parsing and validating the complete payload happens before any UPDATE.
  select
    count(*) = 7
    and count(distinct proposed.weekday) = 7
    and bool_and(
      proposed.weekday between 0 and 6
      and proposed.is_open is not null
      and (
        (
          proposed.is_open
          and proposed.opens_at is not null
          and proposed.closes_at is not null
          and proposed.opens_at < proposed.closes_at
        )
        or
        (
          not proposed.is_open
          and proposed.opens_at is null
          and proposed.closes_at is null
          and proposed.break_starts_at is null
          and proposed.break_ends_at is null
        )
      )
      and (
        (
          proposed.break_starts_at is null
          and proposed.break_ends_at is null
        )
        or
        (
          proposed.is_open
          and proposed.opens_at < proposed.break_starts_at
          and proposed.break_starts_at < proposed.break_ends_at
          and proposed.break_ends_at < proposed.closes_at
        )
      )
    )
  into v_is_valid
  from jsonb_to_recordset(p_hours) as proposed(
    weekday smallint,
    is_open boolean,
    opens_at time,
    closes_at time,
    break_starts_at time,
    break_ends_at time
  );

  if not coalesce(v_is_valid, false) then
    raise exception 'p_hours must contain each weekday exactly once with valid opening and break times'
      using errcode = '22023';
  end if;

  -- This is the same transaction lock used by booking and schedule-block
  -- validation. A booking cannot pass validation against stale hours while the
  -- week is inspected or updated.
  perform pg_advisory_xact_lock(731945210);

  with proposed as (
    select *
    from jsonb_to_recordset(p_hours) as item(
      weekday smallint,
      is_open boolean,
      opens_at time,
      closes_at time,
      break_starts_at time,
      break_ends_at time
    )
  ), future_bookings as (
    select
      b.id,
      b.client_id,
      c.name as client_name,
      b.starts_at,
      b.ends_at,
      b.status,
      b.starts_at at time zone 'America/Sao_Paulo' as local_start,
      b.ends_at at time zone 'America/Sao_Paulo' as local_end
    from public.bookings as b
    join public.clients as c on c.id = b.client_id
    where b.status in ('scheduled', 'confirmed')
      and b.starts_at > statement_timestamp()
  ), affected as (
    select future_bookings.*
    from future_bookings
    join proposed
      on proposed.weekday = extract(dow from future_bookings.local_start)::smallint
    where not proposed.is_open
      or future_bookings.local_start::date <> future_bookings.local_end::date
      or future_bookings.local_start::time < proposed.opens_at
      or future_bookings.local_end::time > proposed.closes_at
      or (
        proposed.break_starts_at is not null
        and future_bookings.local_start::time < proposed.break_ends_at
        and future_bookings.local_end::time > proposed.break_starts_at
      )
  )
  select
    count(*)::integer,
    coalesce(
      array_agg(affected.id order by affected.starts_at, affected.id),
      array[]::bigint[]
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', affected.id,
          'client_id', affected.client_id,
          'client_name', affected.client_name,
          'starts_at', affected.starts_at,
          'ends_at', affected.ends_at,
          'status', affected.status
        )
        order by affected.starts_at, affected.id
      ),
      '[]'::jsonb
    )
  into
    v_affected_booking_count,
    v_affected_booking_ids,
    v_affected_bookings
  from affected;

  if v_affected_booking_count > 0 and p_confirm_conflicts is not true then
    return query
    select
      false,
      true,
      false,
      v_affected_booking_count,
      v_affected_booking_ids,
      v_affected_bookings;
    return;
  end if;

  if v_affected_booking_count > 0 then
    select coalesce(
      array_agg(actual_id order by actual_id),
      array[]::bigint[]
    )
    into v_sorted_affected_booking_ids
    from unnest(v_affected_booking_ids) as actual(actual_id);

    select coalesce(
      array_agg(distinct expected_id order by expected_id),
      array[]::bigint[]
    )
    into v_expected_booking_ids
    from unnest(
      coalesce(p_expected_affected_booking_ids, array[]::bigint[])
    ) as expected(expected_id);

    if v_sorted_affected_booking_ids is distinct from v_expected_booking_ids then
      return query
      select
        false,
        true,
        true,
        v_affected_booking_count,
        v_affected_booking_ids,
        v_affected_bookings;
      return;
    end if;
  end if;

  with proposed as (
    select *
    from jsonb_to_recordset(p_hours) as item(
      weekday smallint,
      is_open boolean,
      opens_at time,
      closes_at time,
      break_starts_at time,
      break_ends_at time
    )
  )
  update public.business_hours as current_hours
  set is_open = proposed.is_open,
      opens_at = proposed.opens_at,
      closes_at = proposed.closes_at,
      break_starts_at = proposed.break_starts_at,
      break_ends_at = proposed.break_ends_at
  from proposed
  where current_hours.weekday = proposed.weekday;

  get diagnostics v_updated_count = row_count;

  if v_updated_count <> 7 then
    raise exception 'business_hours must contain exactly seven weekday rows'
      using errcode = '55000';
  end if;

  return query
  select
    true,
    false,
    false,
    v_affected_booking_count,
    v_affected_booking_ids,
    v_affected_bookings;
end;
$$;

revoke all on function
  agenda_salao_private.update_business_hours_week(jsonb, boolean, bigint[])
from public, anon, authenticated;

grant execute on function
  agenda_salao_private.update_business_hours_week(jsonb, boolean, bigint[])
to authenticated;

create or replace function public.update_business_hours_week(
  p_hours jsonb,
  p_confirm_conflicts boolean default false,
  p_expected_affected_booking_ids bigint[] default null
)
returns table (
  updated boolean,
  requires_confirmation boolean,
  conflicts_changed boolean,
  affected_booking_count integer,
  affected_booking_ids bigint[],
  affected_bookings jsonb
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from agenda_salao_private.update_business_hours_week(
    p_hours,
    p_confirm_conflicts,
    p_expected_affected_booking_ids
  );
$$;

revoke all on function public.update_business_hours_week(jsonb, boolean, bigint[])
from public, anon, authenticated;

grant execute on function public.update_business_hours_week(jsonb, boolean, bigint[])
to authenticated;

-- The browser now reads the weekly rows and mutates them only through the
-- transaction above. Existing policies remain as defense in depth.
revoke insert, update on table public.business_hours from authenticated;
grant select on table public.business_hours to authenticated;

comment on function public.update_business_hours_week(jsonb, boolean, bigint[]) is
  'Validates and updates all seven business-hours rows atomically. Future active bookings are preserved and returned for explicit confirmation. Confirmation succeeds only when the caller acknowledges the exact current conflict set.';
