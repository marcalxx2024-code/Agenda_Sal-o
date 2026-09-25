-- Allow services without a catalog duration to be scheduled when the caller
-- supplies the total booking duration explicitly.

alter table public.booking_services
alter column estimated_duration_minutes drop not null;

comment on column public.booking_services.estimated_duration_minutes is
  'Snapshot of the optional catalog duration. Null requires a manual total booking duration.';

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

  if has_service_without_duration and p_duration_minutes is null then
    raise exception 'p_duration_minutes is required when a service has no estimated duration'
      using errcode = '22023';
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
