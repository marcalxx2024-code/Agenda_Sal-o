$ErrorActionPreference = 'Stop'

$localDatabaseContainer = 'supabase_db_agenda-salao'
$localAdminEmail = 'admin.monica@gmail.com'

$authorizationSql = @'
do $authorize_local_admin$
declare
  local_user_id uuid;
begin
  select id
  into strict local_user_id
  from auth.users
  where lower(email) = lower('admin.monica@gmail.com');

  insert into agenda_salao_private.salon_users (user_id)
  values (local_user_id)
  on conflict (user_id) do nothing;
end;
$authorize_local_admin$;

select
  u.id,
  u.email,
  su.created_at as authorized_at
from auth.users as u
join agenda_salao_private.salon_users as su on su.user_id = u.id
where lower(u.email) = lower('admin.monica@gmail.com');
'@

Write-Output "Authorizing $localAdminEmail in local Supabase project agenda-salao..."

& docker exec $localDatabaseContainer psql `
  -U postgres `
  -d postgres `
  -v ON_ERROR_STOP=1 `
  -P pager=off `
  -c $authorizationSql

if ($LASTEXITCODE -ne 0) {
  throw 'Local authorization failed. Recreate the Auth user first, then run this command again.'
}
