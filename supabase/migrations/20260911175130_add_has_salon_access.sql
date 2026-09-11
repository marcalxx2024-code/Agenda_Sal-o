-- Expose only the caller's salon-membership result through the Data API.
-- The private function owns the protected lookup and derives the identity from
-- auth.uid(); this public wrapper does not receive or expose user identifiers.
create or replace function public.has_salon_access()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select agenda_salao_private.is_salon_user();
$$;

comment on function public.has_salon_access() is
  'Returns whether the authenticated caller belongs to the salon.';

revoke all on function public.has_salon_access()
from public, anon, authenticated;

grant execute on function public.has_salon_access()
to authenticated;
