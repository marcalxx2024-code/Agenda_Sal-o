-- Finaliza o fluxo de retornos sem alterar os contratos publicos existentes.
-- Meses-calendario continuam suportados; dias sao opcionais para prazos exatos
-- (por exemplo, 90 dias). Contato permanece independente de resolucao.

alter table public.services
add column suggested_return_days integer;

alter table public.services
add constraint services_suggested_return_days_check
check (suggested_return_days between 1 and 36500),
add constraint services_one_return_interval_check
check (
  suggested_return_months is null
  or suggested_return_days is null
);

alter table public.appointment_services
add column return_interval_days integer;

alter table public.appointment_services
drop constraint appointment_services_return_consistency;

alter table public.appointment_services
add constraint appointment_services_return_consistency check (
  (
    return_interval_months is null
    and return_interval_days is null
    and return_due_on is null
  )
  or
  (
    return_due_on is not null
    and (return_interval_months is null) <> (return_interval_days is null)
    and (return_interval_months is null or return_interval_months between 1 and 120)
    and (return_interval_days is null or return_interval_days between 1 and 36500)
  )
);

comment on column public.services.suggested_return_days is
  'Prazo opcional em dias corridos. Mutuamente exclusivo com suggested_return_months.';
comment on column public.appointment_services.return_interval_days is
  'Snapshot do prazo em dias corridos no momento do atendimento.';

create or replace function agenda_salao_private.prepare_appointment_service()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_service public.services%rowtype;
  appointment_date date;
begin
  select *
  into selected_service
  from public.services
  where id = new.service_id;

  if not found then
    raise exception 'service % does not exist', new.service_id
      using errcode = '23503';
  end if;

  select performed_on
  into appointment_date
  from public.appointments
  where id = new.appointment_id;

  if not found then
    raise exception 'appointment % does not exist', new.appointment_id
      using errcode = '23503';
  end if;

  if tg_op = 'INSERT' or new.service_id is distinct from old.service_id then
    new.service_name = selected_service.name;
    new.return_interval_months = selected_service.suggested_return_months;
    new.return_interval_days = selected_service.suggested_return_days;
  else
    -- Preserva os dois formatos de snapshot em correcoes historicas.
    new.service_name = old.service_name;
    new.return_interval_months = old.return_interval_months;
    new.return_interval_days = old.return_interval_days;
  end if;

  if new.return_interval_days is not null then
    new.return_due_on = appointment_date + new.return_interval_days;
  elsif new.return_interval_months is not null then
    new.return_due_on = public.calendar_months_after(
      appointment_date,
      new.return_interval_months
    );
  else
    new.return_due_on = null;
  end if;

  return new;
end;
$$;

-- O telefone original nunca e alterado. A funcao so produz o numero para wa.me.
create or replace function public.normalize_whatsapp_phone(p_phone text)
returns text
language sql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $$
  with normalized as (
    select
      btrim(p_phone) as original,
      regexp_replace(btrim(p_phone), '[^0-9]', '', 'g') as digits
  )
  select case
    when digits = '' then null
    when original ~ '^\+' then digits
    when digits like '00%' and length(digits) > 2 then substring(digits from 3)
    when digits like '55%' and length(digits) in (12, 13) then digits
    else '55' || digits
  end
  from normalized;
$$;

comment on function public.normalize_whatsapp_phone(text) is
  'Normaliza um telefone para wa.me: somente digitos e DDI 55 quando nao informado. Nao modifica clients.phone.';

revoke all on function public.normalize_whatsapp_phone(text)
from public, anon, authenticated;
grant execute on function public.normalize_whatsapp_phone(text)
to authenticated;

alter table public.returns
add column resolved_at timestamptz;

-- Registros terminais anteriores recebem a melhor data historica disponivel.
update public.returns
set resolved_at = updated_at
where status in ('completed', 'cancelled')
  and resolved_at is null;

create or replace function agenda_salao_private.prepare_return_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.status in ('completed', 'cancelled')
     and new.status is distinct from old.status then
    raise exception 'return % is already resolved as %', old.id, old.status
      using errcode = '55000';
  end if;

  if new.status = 'pending' then
    new.resolved_at = null;
  elsif tg_op = 'INSERT' or new.status is distinct from old.status then
    new.resolved_at = statement_timestamp();
  else
    new.resolved_at = old.resolved_at;
  end if;

  return new;
end;
$$;

revoke all on function agenda_salao_private.prepare_return_status()
from public, anon, authenticated;

create trigger returns_prepare_status
before insert or update of status, resolved_at on public.returns
for each row execute function agenda_salao_private.prepare_return_status();

alter table public.returns
add constraint returns_resolution_consistency check (
  (status = 'pending' and resolved_at is null)
  or
  (status in ('completed', 'cancelled') and resolved_at is not null)
);

comment on column public.returns.resolved_at is
  'Instante da primeira transicao para completed ou cancelled; estados terminais nao sao reabertos.';

-- A implementacao privilegiada valida a sessao antes de acessar o identificador,
-- bloqueia a linha para idempotencia concorrente e nunca altera retorno terminal.
create or replace function agenda_salao_private.mark_return_contacted(
  p_return_id bigint,
  p_note text default null
)
returns table (
  return_id bigint,
  contacted_at timestamptz,
  status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_return public.returns%rowtype;
begin
  if not agenda_salao_private.is_salon_user() then
    raise exception 'only the authorized salon account can mark return contact'
      using errcode = '42501';
  end if;

  if p_return_id is null then
    raise exception 'p_return_id is required'
      using errcode = '22023';
  end if;

  select r.*
  into current_return
  from public.returns as r
  where r.id = p_return_id
  for update;

  if not found then
    raise exception 'return % does not exist', p_return_id
      using errcode = 'P0002';
  end if;

  if current_return.status <> 'pending' then
    raise exception 'return % cannot be contacted from status %',
      p_return_id, current_return.status
      using errcode = '55000';
  end if;

  if current_return.contacted_at is null then
    return query
    update public.returns as r
    set contacted_at = statement_timestamp(),
        contact_note = p_note
    where r.id = p_return_id
    returning r.id, r.contacted_at, r.status;
    return;
  end if;

  -- Repeticoes preservam o primeiro horario e a primeira observacao.
  return query
  select current_return.id, current_return.contacted_at, current_return.status;
end;
$$;

revoke all on function
  agenda_salao_private.mark_return_contacted(bigint, text)
from public, anon, authenticated;
grant execute on function
  agenda_salao_private.mark_return_contacted(bigint, text)
to authenticated;

comment on function public.mark_return_contacted(bigint, text) is
  'Registra o primeiro contato de um retorno pendente. E idempotente, preserva status pending e rejeita retornos completed/cancelled. A implementacao privada valida auth.uid() pela lista do salao.';

-- As dez colunas originais ficam na mesma ordem para manter consumidores
-- existentes. Os novos dados sao acrescentados ao contrato da view.
create or replace view public.pending_returns
with (security_invoker = true, security_barrier = true)
as
select
  r.id,
  r.due_on,
  r.contacted_at,
  r.contact_note,
  a.performed_on,
  c.id as client_id,
  c.name as client_name,
  c.phone as client_phone,
  aps.service_name,
  aps.return_interval_months,
  a.id as appointment_id,
  aps.id as appointment_service_id,
  aps.service_id,
  aps.return_interval_days,
  public.normalize_whatsapp_phone(c.phone) as client_phone_normalized,
  r.due_on - (statement_timestamp() at time zone 'America/Sao_Paulo')::date
    as days_until_due,
  case
    when r.contacted_at is not null then 'contacted'::text
    else 'pending'::text
  end as status,
  r.resolved_at
from public.returns as r
join public.appointment_services as aps on aps.id = r.appointment_service_id
join public.appointments as a on a.id = aps.appointment_id
join public.clients as c on c.id = a.client_id
where r.status = 'pending';

revoke all on table public.pending_returns from public, anon, authenticated;
grant select on table public.pending_returns to authenticated;

comment on view public.pending_returns is
  'Retornos ainda nao resolvidos. status e pending/contacted; days_until_due usa explicitamente America/Sao_Paulo; telefone original e normalizado sao expostos separadamente.';
