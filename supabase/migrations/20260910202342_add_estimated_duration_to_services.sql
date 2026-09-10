-- Prepare the service catalog for future scheduling without assigning made-up
-- durations to existing records.

alter table public.services
add column estimated_duration_minutes smallint;

alter table public.services
add constraint services_estimated_duration_minutes_positive
check (estimated_duration_minutes > 0);

comment on column public.services.estimated_duration_minutes is
  'Estimated service duration in minutes. Optional until the catalog is populated.';
