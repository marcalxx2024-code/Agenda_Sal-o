import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { BookingClientCreate } from './BookingClientCreate'
import {
  createBooking,
  listBookingFormOptions,
  updateBooking,
  type AgendaBookingListItem,
  type BookingClientOption,
  type BookingFormOptions,
  type BookingsDataError,
  type CreateBookingInput,
  type CreatedBooking,
  type UpdateBookingInput,
  type UpdatedBooking,
} from '../data/bookings'
import {
  isoToSalonInputValues,
  salonDateTimeToIso,
  salonDateValue,
} from '../lib/salon-time'

interface BookingDialogBaseProps {
  onClose: () => void
}

interface BookingCreateDialogProps extends BookingDialogBaseProps {
  booking?: undefined
  initialDate?: string
  onCreated: (
    booking: CreatedBooking,
    client: Pick<BookingClientOption, 'id' | 'name'> | null,
  ) => void
  onUpdated?: never
  onInvalidated?: never
}

interface BookingEditDialogProps extends BookingDialogBaseProps {
  booking: AgendaBookingListItem
  initialDate?: never
  onCreated?: never
  onUpdated: (booking: UpdatedBooking) => void
  onInvalidated: () => void
}

type BookingDialogProps = BookingCreateDialogProps | BookingEditDialogProps

interface BookingFormErrors {
  client?: string
  date?: string
  time?: string
  startsAt?: string
  services?: string
  duration?: string
}

type OptionsLoadState =
  | { status: 'loading' }
  | { status: 'error'; error: BookingsDataError | null }
  | { status: 'loaded'; options: BookingFormOptions }

type BookingSubmissionState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | {
      status: 'error'
      kind: 'supabase' | 'unexpected'
      message: string
      cause: BookingsDataError | unknown
      invalidated: boolean
    }

const postgresIntegerMaximum = 2_147_483_647

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
}

function clientMatchesSearch(
  client: BookingFormOptions['clients'][number],
  query: string,
) {
  const normalizedQuery = normalizeSearch(query.trim())
  if (!normalizedQuery) return true

  const queryDigits = query.replace(/\D/g, '')
  const phoneDigits = client.phone.replace(/\D/g, '')
  return (
    normalizeSearch(client.name).includes(normalizedQuery) ||
    normalizeSearch(client.phone).includes(normalizedQuery) ||
    (queryDigits.length > 0 && phoneDigits.includes(queryDigits))
  )
}

function durationLabel(durationMinutes: number) {
  if (durationMinutes < 60) return `${durationMinutes} min`

  const hours = Math.floor(durationMinutes / 60)
  const minutes = durationMinutes % 60

  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`
}

function bookingManualDurationInput(booking?: AgendaBookingListItem) {
  if (!booking) return ''

  const startsAt = new Date(booking.starts_at)
  const endsAt = new Date(booking.ends_at)

  if (
    Number.isNaN(startsAt.getTime()) ||
    Number.isNaN(endsAt.getTime())
  ) {
    return ''
  }

  const currentDuration = Math.round(
    (endsAt.getTime() - startsAt.getTime()) / (60 * 1000),
  )
  const hasServiceWithoutDefaultDuration = (
    booking.booking_services ?? []
  ).some((service) => service.estimated_duration_minutes === null)
  const snapshotDuration = (booking.booking_services ?? []).reduce(
    (total, service) =>
      total + (service.estimated_duration_minutes ?? 0),
    0,
  )

  if (currentDuration <= 0) return ''
  if (hasServiceWithoutDefaultDuration) return String(currentDuration)
  if (currentDuration === snapshotDuration) return ''
  return String(currentDuration)
}

function parsePositiveInteger(value: string) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function validateBookingForm(
  clientId: string,
  date: string,
  time: string,
  selectedServiceIds: number[],
  durationMinutes: string,
  notes: string,
  options: BookingFormOptions,
): { input: CreateBookingInput | null; errors: BookingFormErrors } {
  const errors: BookingFormErrors = {}
  const parsedClientId = Number(clientId)
  const selectedClient = options.clients.find(
    (client) => client.id === parsedClientId,
  )

  if (!clientId) {
    errors.client = 'Selecione uma cliente.'
  } else if (!selectedClient) {
    errors.client = 'A cliente selecionada não está mais disponível.'
  } else if (!selectedClient.active) {
    errors.client = 'A cliente atual está inativa. Selecione uma cliente ativa.'
  }

  if (!date) errors.date = 'Informe a data.'
  if (!time) errors.time = 'Informe o horário de início.'

  let startsAtIso: string | null = null

  if (date && time) {
    const parsedStartsAtIso = salonDateTimeToIso(date, time)

    if (!parsedStartsAtIso) {
      errors.startsAt = 'Informe uma data e um horário válidos.'
    } else if (new Date(parsedStartsAtIso).getTime() <= Date.now()) {
      errors.startsAt = 'O início do agendamento deve estar no futuro.'
    } else {
      startsAtIso = parsedStartsAtIso
    }
  }

  const selectedServices = selectedServiceIds.map((serviceId) =>
    options.services.find((service) => service.id === serviceId),
  )
  const hasServiceWithoutDefaultDuration = selectedServices.some(
    (service) => service?.estimated_duration_minutes === null,
  )

  if (selectedServiceIds.length === 0) {
    errors.services = 'Selecione pelo menos um serviço.'
  } else if (selectedServices.some((service) => !service)) {
    errors.services = 'Revise os serviços selecionados e tente novamente.'
  } else if (selectedServices.some((service) => !service?.active)) {
    errors.services = 'Remova os serviços inativos antes de salvar.'
  }

  const trimmedDuration = durationMinutes.trim()
  let parsedDuration: number | undefined

  if (trimmedDuration) {
    const duration = parsePositiveInteger(trimmedDuration)

    if (duration === null) {
      errors.duration = 'A duração manual deve ser um número inteiro positivo.'
    } else if (duration > postgresIntegerMaximum) {
      errors.duration = 'A duração manual informada é muito alta.'
    } else {
      parsedDuration = duration
    }
  } else if (hasServiceWithoutDefaultDuration) {
    errors.duration = 'Informe a duração deste agendamento.'
  }

  if (Object.keys(errors).length > 0 || !selectedClient || !startsAtIso) {
    return { input: null, errors }
  }

  const trimmedNotes = notes.trim()
  const input: CreateBookingInput = {
    p_client_id: selectedClient.id,
    p_service_ids: selectedServiceIds,
    p_starts_at: startsAtIso,
  }

  if (parsedDuration !== undefined) {
    input.p_duration_minutes = parsedDuration
  }

  if (trimmedNotes) {
    input.p_notes = trimmedNotes
  }

  return { input, errors }
}

function friendlySaveError(error: BookingsDataError, isEditing: boolean) {
  const databaseMessage = error.message.toLocaleLowerCase('en-US')

  if (error.code === 'P0001') {
    if (databaseMessage.includes('schedule block')) {
      return 'Esse horário está bloqueado nas configurações da agenda.'
    }
    if (databaseMessage.includes('business break')) {
      return 'Esse horário coincide com o intervalo do salão.'
    }
  }

  if (error.code === 'P0002') {
    return 'Este agendamento não existe mais. A agenda está sendo atualizada.'
  }

  if (error.code === '23P01') {
    if (databaseMessage.includes('schedule block')) {
      return 'Esse horário está bloqueado nas configurações da agenda.'
    }
    if (databaseMessage.includes('business break')) {
      return 'Esse horário coincide com o intervalo do salão.'
    }
    return 'Esse horário conflita com outro agendamento ativo. Escolha outro horário.'
  }

  if (error.code === '42501' || error.code.startsWith('PGRST3')) {
    return `Sua sessão não possui permissão para ${
      isEditing ? 'editar' : 'criar'
    } agendamentos.`
  }

  if (error.code === '23503') {
    return databaseMessage.includes('client')
      ? 'A cliente selecionada não existe mais. Reabra o formulário e tente novamente.'
      : 'Um dos serviços selecionados não existe mais. Reabra o formulário e tente novamente.'
  }

  if (error.code === '55000') {
    if (isEditing && databaseMessage.includes('cannot be edited')) {
      return 'O agendamento mudou de status e não pode mais ser editado. A agenda está sendo atualizada.'
    }

    if (databaseMessage.includes('client')) {
      return 'A cliente selecionada foi inativada. Escolha uma cliente ativa.'
    }

    if (databaseMessage.includes('estimated duration')) {
      return 'Um dos serviços selecionados não possui duração estimada.'
    }

    return 'Um dos serviços selecionados foi inativado. Escolha apenas serviços ativos.'
  }

  if (error.code === '22023') {
    if (databaseMessage.includes('starts_at')) {
      return 'Informe uma data e um horário futuros.'
    }

    if (databaseMessage.includes('duration')) {
      if (databaseMessage.includes('required when')) {
        return 'Informe a duração deste agendamento.'
      }
      return 'Informe uma duração manual inteira maior que zero.'
    }

    if (databaseMessage.includes('service_ids')) {
      return 'Selecione pelo menos um serviço válido.'
    }

    if (databaseMessage.includes('client_id')) {
      return 'Selecione uma cliente válida.'
    }

    return 'Revise os dados do agendamento e tente novamente.'
  }

  if (error.code === '22003') {
    return 'A duração total informada ou calculada é muito alta.'
  }

  if (error.code === '23514') {
    if (databaseMessage.includes('closed')) {
      return 'O salão está fechado no dia selecionado.'
    }
    if (databaseMessage.includes('outside business hours')) {
      return 'O horário está fora do expediente configurado.'
    }
    if (databaseMessage.includes('same salon day')) {
      return 'O atendimento precisa começar e terminar no mesmo dia do salão.'
    }
    return 'Os dados não atendem às regras do agendamento. Revise-os e tente novamente.'
  }

  if (error.code === '40001' || error.code === '40P01') {
    return 'Outra alteração ocorreu ao mesmo tempo. A agenda está sendo atualizada.'
  }

  if (!error.code || databaseMessage.includes('fetch')) {
    return 'Não foi possível conectar ao serviço. Verifique sua conexão e tente novamente.'
  }

  return `Não foi possível ${
    isEditing ? 'atualizar' : 'criar'
  } o agendamento. Tente novamente.`
}

function unexpectedSaveError(error: unknown) {
  return error instanceof TypeError
    ? 'Não foi possível conectar ao serviço. Verifique sua conexão e tente novamente.'
    : 'Ocorreu uma falha inesperada. Tente novamente.'
}

export function BookingDialog(props: BookingDialogProps) {
  const { booking, onClose } = props
  const dialogRef = useRef<HTMLDialogElement>(null)
  const initialDateTime = booking
    ? isoToSalonInputValues(booking.starts_at)
    : { date: props.initialDate ?? '', time: '' }
  const [clientId, setClientId] = useState(
    booking?.client?.id === undefined ? '' : String(booking.client.id),
  )
  const [date, setDate] = useState(initialDateTime.date)
  const [time, setTime] = useState(initialDateTime.time)
  const [selectedServiceIds, setSelectedServiceIds] = useState<number[]>(
    () => (booking?.booking_services ?? []).map((service) => service.service_id),
  )
  const [durationMinutes, setDurationMinutes] = useState(() =>
    bookingManualDurationInput(booking),
  )
  const [notes, setNotes] = useState(booking?.notes ?? '')
  const [clientSearch, setClientSearch] = useState('')
  const [isCreatingClient, setIsCreatingClient] = useState(false)
  const [isCreatingClientBusy, setIsCreatingClientBusy] = useState(false)
  const [formErrors, setFormErrors] = useState<BookingFormErrors>({})
  const [optionsState, setOptionsState] = useState<OptionsLoadState>({
    status: 'loading',
  })
  const [optionsLoadAttempt, setOptionsLoadAttempt] = useState(0)
  const [submission, setSubmission] = useState<BookingSubmissionState>({
    status: 'idle',
  })
  const isSubmitting = submission.status === 'submitting'
  const isInvalidated =
    submission.status === 'error' && submission.invalidated
  const isEditing = booking !== undefined

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  useEffect(() => {
    let isCurrent = true

    void listBookingFormOptions(
      booking
        ? {
            currentClientId: booking.client?.id,
            currentServiceIds: (booking.booking_services ?? []).map(
              (service) => service.service_id,
            ),
          }
        : undefined,
    )
      .then((result) => {
        if (!isCurrent) return

        if (result.error) {
          setOptionsState({ status: 'error', error: result.error })
          return
        }

        setOptionsState({ status: 'loaded', options: result.data })
      })
      .catch(() => {
        if (!isCurrent) return
        setOptionsState({ status: 'error', error: null })
      })

    return () => {
      isCurrent = false
    }
  }, [booking, optionsLoadAttempt])

  const options =
    optionsState.status === 'loaded' ? optionsState.options : null
  const visibleClients = useMemo(
    () =>
      options?.clients.filter((client) =>
        clientMatchesSearch(client, clientSearch),
      ) ?? [],
    [clientSearch, options],
  )
  const selectedServices = useMemo(
    () =>
      options?.services.filter((service) =>
        selectedServiceIds.includes(service.id),
      ) ?? [],
    [options, selectedServiceIds],
  )
  const suggestedDuration = selectedServices.reduce(
    (total, service) => total + (service.estimated_duration_minutes ?? 0),
    0,
  )
  const parsedManualDuration = parsePositiveInteger(durationMinutes.trim())
  const hasSelectedServiceWithoutDuration = selectedServices.some(
    (service) => service.estimated_duration_minutes === null,
  )
  const activeClientCount =
    options?.clients.filter((client) => client.active).length ?? 0
  const usableServiceCount =
    options?.services.filter((service) => service.active).length ?? 0
  const canSubmit = Boolean(
    options && activeClientCount > 0 && usableServiceCount > 0,
  )

  function closeDialog() {
    if (!isSubmitting && !isCreatingClientBusy) dialogRef.current?.close()
  }

  function handleClientCreated(client: {
    id: number
    name: string
    phone: string
    active: boolean
  }) {
    setOptionsState((current) => {
      if (current.status !== 'loaded') return current

      const clients = [
        ...current.options.clients.filter((item) => item.id !== client.id),
        {
          id: client.id,
          name: client.name,
          phone: client.phone,
          active: client.active,
        },
      ].sort((first, second) =>
        first.name.localeCompare(second.name, 'pt-BR'),
      )

      return {
        status: 'loaded',
        options: { ...current.options, clients },
      }
    })
    setClientId(String(client.id))
    setClientSearch(client.name)
    setFormErrors((current) => ({ ...current, client: undefined }))
    setIsCreatingClientBusy(false)
    setIsCreatingClient(false)
  }

  function retryOptionsLoading() {
    setOptionsState({ status: 'loading' })
    setOptionsLoadAttempt((attempt) => attempt + 1)
  }

  function toggleService(serviceId: number, checked: boolean) {
    setSelectedServiceIds((currentIds) =>
      checked
        ? currentIds.includes(serviceId)
          ? currentIds
          : [...currentIds, serviceId]
        : currentIds.filter((currentId) => currentId !== serviceId),
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      isSubmitting ||
      isCreatingClient ||
      isCreatingClientBusy ||
      !options
    ) {
      return
    }

    const validation = validateBookingForm(
      clientId,
      date,
      time,
      selectedServiceIds,
      durationMinutes,
      notes,
      options,
    )
    setFormErrors(validation.errors)
    setSubmission({ status: 'idle' })

    if (!validation.input) return
    const validatedInput = validation.input

    setSubmission({ status: 'submitting' })

    try {
      const result = booking
        ? await updateBooking({
            ...validatedInput,
            p_booking_id: booking.id,
          } satisfies UpdateBookingInput)
        : await createBooking(validatedInput)

      if (result.error) {
        const databaseMessage = result.error.message.toLocaleLowerCase('en-US')
        const invalidated = Boolean(
          booking &&
            (result.error.code === 'P0002' ||
              (result.error.code === '55000' &&
                databaseMessage.includes('cannot be edited')) ||
              result.error.code === '40001' ||
              result.error.code === '40P01'),
        )

        if (invalidated && booking) props.onInvalidated()

        setSubmission({
          status: 'error',
          kind: 'supabase',
          message: friendlySaveError(result.error, isEditing),
          cause: result.error,
          invalidated,
        })
        return
      }

      if (booking) {
        props.onUpdated(result.data)
      } else {
        const selectedClient = options.clients.find(
          (client) => client.id === validatedInput.p_client_id,
        )
        props.onCreated(
          result.data,
          selectedClient
            ? { id: selectedClient.id, name: selectedClient.name }
            : null,
        )
      }
    } catch (error) {
      setSubmission({
        status: 'error',
        kind: 'unexpected',
        message: unexpectedSaveError(error),
        cause: error,
        invalidated: false,
      })
    }
  }

  return (
    <dialog
      className="client-dialog booking-dialog"
      ref={dialogRef}
      aria-labelledby="booking-form-title"
      onClose={onClose}
      onCancel={(event) => {
        if (isSubmitting || isCreatingClientBusy) event.preventDefault()
      }}
    >
      <form className="client-form" onSubmit={handleSubmit} noValidate>
        <header className="client-dialog__header">
          <div>
            <span className="eyebrow">
              {isEditing ? 'Alterar horário' : 'Novo horário'}
            </span>
            <h2 id="booking-form-title">
              {isEditing ? 'Editar agendamento' : 'Novo agendamento'}
            </h2>
            <p>
              {isEditing
                ? 'Revise cliente, início e serviços antes de salvar.'
                : 'Defina cliente, início e serviços para reservar o horário.'}
            </p>
          </div>
          <button
            className="client-dialog__close"
            type="button"
            aria-label={
              isEditing ? 'Fechar edição do agendamento' : 'Fechar novo agendamento'
            }
            onClick={closeDialog}
            disabled={isSubmitting || isCreatingClientBusy}
          >
            ×
          </button>
        </header>

        <div className="client-form__fields booking-form__fields">
          {optionsState.status === 'loading' && (
            <div className="booking-form__options-state" role="status">
              <span className="agenda-state__pulse" aria-hidden="true" />
              Carregando clientes e serviços…
            </div>
          )}

          {optionsState.status === 'error' && (
            <div className="booking-form__options-error" role="alert">
              <p>Não foi possível carregar clientes e serviços.</p>
              <button type="button" onClick={retryOptionsLoading}>
                Tentar novamente
              </button>
            </div>
          )}

          {isCreatingClient ? (
            <BookingClientCreate
              initialQuery={clientSearch}
              onBusyChange={setIsCreatingClientBusy}
              onCancel={() => setIsCreatingClient(false)}
              onCreated={handleClientCreated}
            />
          ) : (
            <div className="booking-client-picker">
              <div className="client-form__field">
                <label htmlFor="booking-client-search">
                  Buscar cliente
                </label>
                <input
                  id="booking-client-search"
                  type="search"
                  value={clientSearch}
                  onChange={(event) => {
                    setClientSearch(event.target.value)
                    setClientId('')
                  }}
                  placeholder="Nome ou telefone"
                  autoComplete="off"
                  autoFocus
                  disabled={isSubmitting || !options}
                />
              </div>

              <div className="client-form__field">
                <label htmlFor="booking-client">
                  Cliente <span>Obrigatório</span>
                </label>
                <select
                  id="booking-client"
                  name="client_id"
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  required
                  disabled={isSubmitting || !options || activeClientCount === 0}
                  aria-invalid={Boolean(formErrors.client)}
                  aria-describedby={
                    formErrors.client ? 'booking-client-error' : undefined
                  }
                >
                  <option value="">Selecione uma cliente</option>
                  {visibleClients.map((client) => (
                    <option value={client.id} key={client.id}>
                      {client.name} · {client.phone}
                      {client.active ? '' : ' — inativa'}
                    </option>
                  ))}
                </select>

                {options && visibleClients.length === 0 && clientSearch.trim() && (
                  <small className="client-form__help" role="status">
                    Nenhuma cliente encontrada para essa busca.
                  </small>
                )}
                {options && activeClientCount === 0 && (
                  <small className="client-form__help">
                    Não há clientes ativos disponíveis para agendamento.
                  </small>
                )}
                <button
                  className="booking-client-picker__create"
                  type="button"
                  onClick={() => {
                    setFormErrors((current) => ({
                      ...current,
                      client: undefined,
                    }))
                    setIsCreatingClient(true)
                  }}
                  disabled={isSubmitting || !options}
                >
                  + Cadastrar nova cliente
                </button>
                {formErrors.client && (
                  <p
                    className="client-form__error"
                    id="booking-client-error"
                    role="alert"
                  >
                    {formErrors.client}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="booking-form__date-time">
            <div className="client-form__field">
              <label htmlFor="booking-date">
                Data <span>Obrigatório</span>
              </label>
              <input
                id="booking-date"
                name="date"
                type="date"
                min={salonDateValue()}
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
                disabled={isSubmitting}
                aria-invalid={Boolean(formErrors.date || formErrors.startsAt)}
                aria-describedby={
                  [
                    formErrors.date ? 'booking-date-error' : '',
                    formErrors.startsAt ? 'booking-start-error' : '',
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
              />
              {formErrors.date && (
                <p
                  className="client-form__error"
                  id="booking-date-error"
                  role="alert"
                >
                  {formErrors.date}
                </p>
              )}
            </div>

            <div className="client-form__field">
              <label htmlFor="booking-time">
                Horário de início <span>Obrigatório</span>
              </label>
              <input
                id="booking-time"
                name="time"
                type="time"
                step={60}
                value={time}
                onChange={(event) => setTime(event.target.value)}
                required
                disabled={isSubmitting}
                aria-invalid={Boolean(formErrors.time || formErrors.startsAt)}
                aria-describedby={
                  [
                    formErrors.time ? 'booking-time-error' : '',
                    formErrors.startsAt ? 'booking-start-error' : '',
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
              />
              {formErrors.time && (
                <p
                  className="client-form__error"
                  id="booking-time-error"
                  role="alert"
                >
                  {formErrors.time}
                </p>
              )}
            </div>
          </div>

          {formErrors.startsAt && (
            <p
              className="client-form__error"
              id="booking-start-error"
              role="alert"
            >
              {formErrors.startsAt}
            </p>
          )}

          <fieldset
            className="booking-form__services"
            disabled={isSubmitting}
            aria-invalid={Boolean(formErrors.services)}
            aria-describedby={
              formErrors.services ? 'booking-services-error' : undefined
            }
          >
            <legend>
              Serviços <span>Obrigatório</span>
            </legend>

            {options && usableServiceCount === 0 && (
              <p className="booking-form__empty-option">
                Não há serviços ativos disponíveis para agendamento.
              </p>
            )}

            {options && options.services.length > 0 && (
              <div className="booking-form__service-list">
                {options.services.map((service) => {
                  const estimatedDuration =
                    service.estimated_duration_minutes
                  const hasDuration = estimatedDuration !== null
                  const isSelected = selectedServiceIds.includes(service.id)
                  const isAvailable = service.active
                  const availabilityClass = isAvailable
                    ? ''
                    : isSelected
                      ? ' booking-form__service-option--needs-removal'
                      : ' booking-form__service-option--unavailable'
                  let serviceDetails: string

                  if (!service.active) {
                    serviceDetails = isSelected
                      ? 'Inativo — remova para salvar'
                      : 'Inativo — indisponível'
                  } else if (!hasDuration) {
                    serviceDetails =
                      'Sem duração padrão — informe a duração total'
                  } else {
                    serviceDetails = durationLabel(estimatedDuration)
                  }

                  return (
                    <label
                      className={`booking-form__service-option${availabilityClass}`}
                      key={service.id}
                    >
                      <input
                        type="checkbox"
                        name="service_ids"
                        value={service.id}
                        checked={isSelected}
                        onChange={(event) =>
                          toggleService(service.id, event.target.checked)
                        }
                        disabled={isSubmitting || (!isAvailable && !isSelected)}
                      />
                      <span>
                        <strong>{service.name}</strong>
                        <small>{serviceDetails}</small>
                      </span>
                    </label>
                  )
                })}
              </div>
            )}

            {formErrors.services && (
              <p
                className="client-form__error"
                id="booking-services-error"
                role="alert"
              >
                {formErrors.services}
              </p>
            )}
          </fieldset>

          <div className="client-form__field">
            <label htmlFor="booking-duration">
              Duração total em minutos{' '}
              <span>
                {hasSelectedServiceWithoutDuration ? 'Obrigatório' : 'Opcional'}
              </span>
            </label>
            <input
              id="booking-duration"
              name="duration_minutes"
              type="number"
              inputMode="numeric"
              min={1}
              max={postgresIntegerMaximum}
              step={1}
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(event.target.value)}
              required={hasSelectedServiceWithoutDuration}
              disabled={isSubmitting}
              aria-invalid={Boolean(formErrors.duration)}
              aria-describedby={`booking-duration-help booking-duration-summary${
                formErrors.duration ? ' booking-duration-error' : ''
              }`}
            />
            <small id="booking-duration-help" className="client-form__help">
              {hasSelectedServiceWithoutDuration
                ? 'Informe a duração total deste agendamento.'
                : 'Deixe vazio para o banco usar a soma das durações dos serviços.'}
            </small>
            <div
              className="booking-form__duration-summary"
              id="booking-duration-summary"
              aria-live="polite"
            >
              <span>Previsão pelos serviços</span>
              <strong>
                {selectedServices.length === 0
                  ? 'Selecione os serviços'
                  : hasSelectedServiceWithoutDuration
                    ? 'Duração manual necessária'
                    : durationLabel(suggestedDuration)}
              </strong>
              {durationMinutes.trim() && parsedManualDuration !== null && (
                <small>
                  Reserva manual: {durationLabel(parsedManualDuration)}
                </small>
              )}
            </div>
            {formErrors.duration && (
              <p
                className="client-form__error"
                id="booking-duration-error"
                role="alert"
              >
                {formErrors.duration}
              </p>
            )}
          </div>

          <div className="client-form__field">
            <label htmlFor="booking-notes">
              Observações <span>Opcional</span>
            </label>
            <textarea
              id="booking-notes"
              name="notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              disabled={isSubmitting}
            />
          </div>
        </div>

        {submission.status === 'error' && (
          <p className="client-form__submit-error" role="alert">
            {submission.message}
          </p>
        )}

        <footer className="client-form__actions">
          <button
            className="client-form__cancel"
            type="button"
            onClick={closeDialog}
            disabled={isSubmitting || isCreatingClientBusy}
          >
            Cancelar
          </button>
          <button
            className="primary-button client-form__submit"
            type="submit"
            disabled={
              isSubmitting ||
              isCreatingClient ||
              isCreatingClientBusy ||
              isInvalidated ||
              !canSubmit
            }
          >
            {isSubmitting
              ? isEditing
                ? 'Salvando…'
                : 'Agendando…'
              : isEditing
                ? 'Salvar alterações'
                : 'Criar agendamento'}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
