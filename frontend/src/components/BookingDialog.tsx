import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import {
  createBooking,
  listBookingFormOptions,
  type BookingFormOptions,
  type BookingsDataError,
  type CreateBookingInput,
} from '../data/bookings'

interface BookingDialogProps {
  onClose: () => void
  onCreated: () => void
}

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
    }

const postgresIntegerMaximum = 2_147_483_647

function durationLabel(durationMinutes: number) {
  if (durationMinutes < 60) return `${durationMinutes} min`

  const hours = Math.floor(durationMinutes / 60)
  const minutes = durationMinutes % 60

  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`
}

function todayInputValue() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
  }

  if (!date) errors.date = 'Informe a data.'
  if (!time) errors.time = 'Informe o horário de início.'

  let startsAt: Date | null = null

  if (date && time) {
    const parsedStartsAt = new Date(`${date}T${time}`)

    if (Number.isNaN(parsedStartsAt.getTime())) {
      errors.startsAt = 'Informe uma data e um horário válidos.'
    } else if (parsedStartsAt.getTime() <= Date.now()) {
      errors.startsAt = 'O início do agendamento deve estar no futuro.'
    } else {
      startsAt = parsedStartsAt
    }
  }

  const selectedServices = selectedServiceIds.map((serviceId) =>
    options.services.find((service) => service.id === serviceId),
  )

  if (selectedServiceIds.length === 0) {
    errors.services = 'Selecione pelo menos um serviço.'
  } else if (
    selectedServices.some(
      (service) => !service || service.estimated_duration_minutes === null,
    )
  ) {
    errors.services = 'Revise os serviços selecionados e tente novamente.'
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
  }

  if (Object.keys(errors).length > 0 || !selectedClient || !startsAt) {
    return { input: null, errors }
  }

  const trimmedNotes = notes.trim()
  const input: CreateBookingInput = {
    p_client_id: selectedClient.id,
    p_service_ids: selectedServiceIds,
    p_starts_at: startsAt.toISOString(),
  }

  if (parsedDuration !== undefined) {
    input.p_duration_minutes = parsedDuration
  }

  if (trimmedNotes) {
    input.p_notes = trimmedNotes
  }

  return { input, errors }
}

function friendlyCreateError(error: BookingsDataError) {
  const databaseMessage = error.message.toLocaleLowerCase('en-US')

  if (error.code === '23P01') {
    return 'Esse horário conflita com outro agendamento ativo. Escolha outro horário.'
  }

  if (error.code === '42501' || error.code.startsWith('PGRST3')) {
    return 'Sua sessão não possui permissão para criar agendamentos.'
  }

  if (error.code === '23503') {
    return databaseMessage.includes('client')
      ? 'A cliente selecionada não existe mais. Reabra o formulário e tente novamente.'
      : 'Um dos serviços selecionados não existe mais. Reabra o formulário e tente novamente.'
  }

  if (error.code === '55000') {
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
    return 'Os dados não atendem às regras do agendamento. Revise-os e tente novamente.'
  }

  if (!error.code || databaseMessage.includes('fetch')) {
    return 'Não foi possível conectar ao serviço. Verifique sua conexão e tente novamente.'
  }

  return 'Não foi possível criar o agendamento. Tente novamente.'
}

function unexpectedCreateError(error: unknown) {
  return error instanceof TypeError
    ? 'Não foi possível conectar ao serviço. Verifique sua conexão e tente novamente.'
    : 'Ocorreu uma falha inesperada. Tente novamente.'
}

export function BookingDialog({ onClose, onCreated }: BookingDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [clientId, setClientId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [selectedServiceIds, setSelectedServiceIds] = useState<number[]>([])
  const [durationMinutes, setDurationMinutes] = useState('')
  const [notes, setNotes] = useState('')
  const [formErrors, setFormErrors] = useState<BookingFormErrors>({})
  const [optionsState, setOptionsState] = useState<OptionsLoadState>({
    status: 'loading',
  })
  const [optionsLoadAttempt, setOptionsLoadAttempt] = useState(0)
  const [submission, setSubmission] = useState<BookingSubmissionState>({
    status: 'idle',
  })
  const isSubmitting = submission.status === 'submitting'

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  useEffect(() => {
    let isCurrent = true

    void listBookingFormOptions()
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
  }, [optionsLoadAttempt])

  const options =
    optionsState.status === 'loaded' ? optionsState.options : null
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
  const usableServiceCount =
    options?.services.filter(
      (service) => service.estimated_duration_minutes !== null,
    ).length ?? 0
  const canSubmit = Boolean(
    options && options.clients.length > 0 && usableServiceCount > 0,
  )

  function closeDialog() {
    if (!isSubmitting) dialogRef.current?.close()
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
    if (isSubmitting || !options) return

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

    setSubmission({ status: 'submitting' })

    try {
      const result = await createBooking(validation.input)

      if (result.error) {
        setSubmission({
          status: 'error',
          kind: 'supabase',
          message: friendlyCreateError(result.error),
          cause: result.error,
        })
        return
      }

      onCreated(result.data)
    } catch (error) {
      setSubmission({
        status: 'error',
        kind: 'unexpected',
        message: unexpectedCreateError(error),
        cause: error,
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
        if (isSubmitting) event.preventDefault()
      }}
    >
      <form className="client-form" onSubmit={handleSubmit} noValidate>
        <header className="client-dialog__header">
          <div>
            <span className="eyebrow">Novo horário</span>
            <h2 id="booking-form-title">Novo agendamento</h2>
            <p>Defina cliente, início e serviços para reservar o horário.</p>
          </div>
          <button
            className="client-dialog__close"
            type="button"
            aria-label="Fechar novo agendamento"
            onClick={closeDialog}
            disabled={isSubmitting}
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

          <div className="client-form__field">
            <label htmlFor="booking-client">
              Cliente <span>Obrigatório</span>
            </label>
            <select
              id="booking-client"
              name="client_id"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              autoFocus
              required
              disabled={isSubmitting || !options || options.clients.length === 0}
              aria-invalid={Boolean(formErrors.client)}
              aria-describedby={
                formErrors.client ? 'booking-client-error' : undefined
              }
            >
              <option value="">Selecione uma cliente</option>
              {options?.clients.map((client) => (
                <option value={client.id} key={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
            {options && options.clients.length === 0 && (
              <small className="client-form__help">
                Não há clientes ativos disponíveis para agendamento.
              </small>
            )}
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

          <div className="booking-form__date-time">
            <div className="client-form__field">
              <label htmlFor="booking-date">
                Data <span>Obrigatório</span>
              </label>
              <input
                id="booking-date"
                name="date"
                type="date"
                min={todayInputValue()}
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

            {options && options.services.length === 0 && (
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

                  return (
                    <label
                      className={`booking-form__service-option${
                        hasDuration
                          ? ''
                          : ' booking-form__service-option--unavailable'
                      }`}
                      key={service.id}
                    >
                      <input
                        type="checkbox"
                        name="service_ids"
                        value={service.id}
                        checked={selectedServiceIds.includes(service.id)}
                        onChange={(event) =>
                          toggleService(service.id, event.target.checked)
                        }
                        disabled={!hasDuration || isSubmitting}
                      />
                      <span>
                        <strong>{service.name}</strong>
                        <small>
                          {hasDuration
                            ? durationLabel(estimatedDuration)
                            : 'Sem duração estimada — indisponível'}
                        </small>
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
              Duração total em minutos <span>Opcional</span>
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
              disabled={isSubmitting}
              aria-invalid={Boolean(formErrors.duration)}
              aria-describedby={`booking-duration-help booking-duration-summary${
                formErrors.duration ? ' booking-duration-error' : ''
              }`}
            />
            <small id="booking-duration-help" className="client-form__help">
              Deixe vazio para o banco usar a soma das durações dos serviços.
            </small>
            <div
              className="booking-form__duration-summary"
              id="booking-duration-summary"
              aria-live="polite"
            >
              <span>Previsão pelos serviços</span>
              <strong>
                {suggestedDuration > 0
                  ? durationLabel(suggestedDuration)
                  : 'Selecione os serviços'}
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
            disabled={isSubmitting}
          >
            Cancelar
          </button>
          <button
            className="primary-button client-form__submit"
            type="submit"
            disabled={isSubmitting || !canSubmit}
          >
            {isSubmitting ? 'Agendando…' : 'Criar agendamento'}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
