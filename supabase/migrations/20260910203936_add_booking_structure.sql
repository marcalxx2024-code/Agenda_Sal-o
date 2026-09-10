-- Persistent structure for future bookings. Mutations remain reserved for the
-- transactional RPCs that will be introduced in a later stage.

create table public.bookings (
  id bigint generated always as identity primary key,
  client_id bigint not null
    references public.clients (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')),
  notes text,
  status_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_valid_time_range check (ends_at > starts_at),
  constraint bookings_no_active_time_overlap exclude using gist (
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('scheduled', 'confirmed'))
);

create table public.booking_services (
  id bigint generated always as identity primary key,
  booking_id bigint not null
    references public.bookings (id) on delete restrict,
  service_id bigint not null
    references public.services (id) on delete restrict,
  service_name text not null,
  estimated_duration_minutes smallint not null
    check (estimated_duration_minutes > 0),
  created_at timestamptz not null default now(),
  constraint booking_services_one_service_per_booking
    unique (booking_id, service_id)
);

alter table public.appointments
add column booking_id bigint
  constraint appointments_booking_id_fkey
    references public.bookings (id) on delete restrict,
add constraint appointments_booking_id_key unique (booking_id);

create index bookings_starts_at_idx
  on public.bookings (starts_at);
create index bookings_client_id_idx
  on public.bookings (client_id);
create index booking_services_service_id_idx
  on public.booking_services (service_id);

create or replace function agenda_salao_private.set_status_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.status_updated_at = now();
  end if;

  return new;
end;
$$;

create trigger bookings_set_updated_at
before update on public.bookings
for each row execute function agenda_salao_private.set_updated_at();

create trigger bookings_set_status_updated_at
before update on public.bookings
for each row execute function agenda_salao_private.set_status_updated_at();

alter table public.bookings enable row level security;
alter table public.booking_services enable row level security;

create policy salon_account_select on public.bookings
for select to authenticated
using ((select agenda_salao_private.is_salon_user()));

create policy salon_account_select on public.booking_services
for select to authenticated
using ((select agenda_salao_private.is_salon_user()));

revoke all on table public.bookings, public.booking_services
from public, anon, authenticated;

grant select on table public.bookings, public.booking_services
to authenticated;

revoke all on sequence
  public.bookings_id_seq,
  public.booking_services_id_seq
from public, anon, authenticated;

-- Existing appointment reads include the optional link, but callers retain
-- only the previously granted updates to performed_on and notes.
revoke update (booking_id) on table public.appointments
from public, anon, authenticated;

revoke execute on function agenda_salao_private.set_status_updated_at()
from public, anon, authenticated;
