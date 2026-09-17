import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  completeBooking,
  listCompletionServiceOptions,
  type AgendaBookingListItem,
  type BookingsDataError,
  type CompletedBooking,
  type CompletionServiceOption,
} from '../data/bookings'

interface BookingCompleteDialogProps {
  booking: AgendaBookingListItem
  onClose: () => void
  onCompleted: (booking: CompletedBooking) => void
  onInvalidated: () => void
}

type OptionsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; services: CompletionServiceOption[] }

function localDateValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function friendlyCompletionError(error: BookingsDataError) {
  const message = error.message.toLocaleLowerCase('en-US')

  if (error.code === 'P0002') {
    return 'Este agendamento não existe mais. A agenda está sendo atualizada.'
  }
  if (error.code === '42501' || error.code.startsWith('PGRST3')) {
    return 'Sua sessão não possui permissão para concluir atendimentos.'
  }
  if (error.code === '55000') {
    if (message.includes('client')) {
      return 'A cliente está inativa. Reative o cadastro antes de concluir este atendimento.'
    }
    if (message.includes('status')) {
      return 'O agendamento mudou de status e não pode mais ser concluído.'
    }
    return 'Um serviço adicionado não está mais ativo. Revise os serviços realizados.'
  }
  if (error.code === '23503') {
    return 'A cliente ou um dos serviços não existe mais. Atualize a agenda e tente novamente.'
  }
  if (error.code === '22023') {
    return 'Revise a data e selecione pelo menos um serviço realizado.'
  }
  if (error.code === '40001' || error.code === '40P01') {
    return 'Outra alteração ocorreu ao mesmo tempo. Atualize a agenda e tente novamente.'
  }
  return 'Não foi possível concluir o atendimento. Tente novamente.'
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
})

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
})

export function BookingCompleteDialog({
  booking,
  onClose,
  onCompleted,
  onInvalidated,
}: BookingCompleteDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const plannedServiceIds = useMemo(
    () =>
      (booking.booking_services ?? []).map((service) => service.service_id),
    [booking.booking_services],
  )
  const scheduledDate = new Date(booking.starts_at)
  const [openedAt] = useState(() => Date.now())
  const today = localDateValue(new Date())
  const isScheduledInFuture =
    !Number.isNaN(scheduledDate.getTime()) && scheduledDate.getTime() > openedAt
  const [performedOn, setPerformedOn] = useState(
    !Number.isNaN(scheduledDate.getTime()) && localDateValue(scheduledDate) <= today
      ? localDateValue(scheduledDate)
      : today,
  )
  const [selectedServiceIds, setSelectedServiceIds] =
    useState<number[]>(plannedServiceIds)
  const [notes, setNotes] = useState(booking.notes ?? '')
  const [optionsState, setOptionsState] = useState<OptionsState>({
    status: 'loading',
  })
  const [optionsAttempt, setOptionsAttempt] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isInvalidated, setIsInvalidated] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  useEffect(() => {
    let isCurrent = true

    void listCompletionServiceOptions(plannedServiceIds)
      .then((result) => {
        if (!isCurrent) return
        setOptionsState(
          result.error
            ? { status: 'error' }
            : { status: 'loaded', services: result.data },
        )
      })
      .catch(() => {
        if (isCurrent) setOptionsState({ status: 'error' })
      })

    return () => {
      isCurrent = false
    }
  }, [optionsAttempt, plannedServiceIds])

  function closeDialog() {
    if (!isSubmitting) dialogRef.current?.close()
  }

  function toggleService(serviceId: number, checked: boolean) {
    setSelectedServiceIds((current) =>
      checked
        ? current.includes(serviceId)
          ? current
          : [...current, serviceId]
        : current.filter((id) => id !== serviceId),
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    if (isScheduledInFuture) {
      setFormError('O atendimento só pode ser concluído depois do horário agendado.')
      return
    }
    if (!performedOn || performedOn > today) {
      setFormError('Informe uma data efetiva válida, que não esteja no futuro.')
      return
    }
    if (selectedServiceIds.length === 0) {
      setFormError('Selecione pelo menos um serviço realmente realizado.')
      return
    }

    setFormError(null)
    setIsSubmitting(true)

    try {
      const trimmedNotes = notes.trim()
      const result = await completeBooking({
        p_booking_id: booking.id,
        p_performed_on: performedOn,
        p_service_ids: selectedServiceIds,
        ...(trimmedNotes ? { p_notes: trimmedNotes } : {}),
      })

      if (result.error) {
        if (['P0002', '55000', '40001', '40P01'].includes(result.error.code)) {
          setIsInvalidated(true)
          onInvalidated()
        }
        setFormError(friendlyCompletionError(result.error))
        setIsSubmitting(false)
        return
      }

      onCompleted(result.data)
    } catch {
      setFormError('Não foi possível conectar ao serviço. Tente novamente.')
      setIsSubmitting(false)
    }
  }

  return (
    <dialog
      className="client-dialog booking-dialog"
      ref={dialogRef}
      aria-labelledby="complete-booking-title"
      onClose={onClose}
      onCancel={(event) => {
        if (isSubmitting) event.preventDefault()
      }}
    >
      <form className="client-form" onSubmit={handleSubmit} noValidate>
        <header className="client-dialog__header">
          <div>
            <span className="eyebrow">Atendimento realizado</span>
            <h2 id="complete-booking-title">Concluir atendimento</h2>
            <p>{booking.client?.name ?? 'Cliente indisponível'}</p>
          </div>
          <button
            className="client-dialog__close"
            type="button"
            aria-label="Fechar conclusão"
            onClick={closeDialog}
            disabled={isSubmitting}
          >
            ×
          </button>
        </header>

        <div className="client-form__fields">
          <div className="completion-summary">
            <span>Agendado para</span>
            <strong>
              {Number.isNaN(scheduledDate.getTime())
                ? 'Data indisponível'
                : `${dateFormatter.format(scheduledDate)}, às ${timeFormatter.format(scheduledDate)}`}
            </strong>
            <small>
              Planejado: {(booking.booking_services ?? [])
                .map((service) => service.service_name)
                .join(', ') || 'nenhum serviço'}
            </small>
          </div>

          {isScheduledInFuture && (
            <p className="client-form__submit-error" role="alert">
              Este horário ainda não chegou. A conclusão ficará disponível depois
              do início agendado.
            </p>
          )}

          <div className="client-form__field">
            <label htmlFor="completion-date">Data efetiva do atendimento</label>
            <input
              id="completion-date"
              type="date"
              value={performedOn}
              max={today}
              onChange={(event) => setPerformedOn(event.target.value)}
              required
              disabled={isSubmitting}
            />
          </div>

          <fieldset className="booking-form__services" disabled={isSubmitting}>
            <legend>Serviços realmente realizados</legend>
            {optionsState.status === 'loading' && (
              <p className="booking-form__empty-option">Carregando serviços…</p>
            )}
            {optionsState.status === 'error' && (
              <div className="booking-form__empty-option" role="alert">
                <p>Não foi possível carregar os serviços.</p>
                <button
                  className="booking-row__action"
                  type="button"
                  onClick={() => {
                    setOptionsState({ status: 'loading' })
                    setOptionsAttempt((attempt) => attempt + 1)
                  }}
                >
                  Tentar novamente
                </button>
              </div>
            )}
            {optionsState.status === 'loaded' && (
              <div className="booking-form__service-list">
                {optionsState.services.map((service) => {
                  const isPlanned = plannedServiceIds.includes(service.id)
                  const isSelected = selectedServiceIds.includes(service.id)
                  const canSelect = service.active || isPlanned

                  return (
                    <label className="booking-form__service-option" key={service.id}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={!canSelect || isSubmitting}
                        onChange={(event) =>
                          toggleService(service.id, event.target.checked)
                        }
                      />
                      <span>
                        <strong>{service.name}</strong>
                        <small>
                          {isPlanned
                            ? service.active
                              ? 'Planejado'
                              : 'Planejado · serviço inativo'
                            : 'Adicionado ao atendimento'}
                        </small>
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </fieldset>

          <div className="client-form__field">
            <label htmlFor="completion-notes">
              Observações do atendimento <span>Opcional</span>
            </label>
            <textarea
              id="completion-notes"
              rows={4}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={isSubmitting}
            />
          </div>
        </div>

        {formError && (
          <p className="client-form__submit-error" role="alert">
            {formError}
          </p>
        )}

        <footer className="client-form__actions">
          <button
            className="client-form__cancel"
            type="button"
            onClick={closeDialog}
            disabled={isSubmitting}
          >
            Voltar
          </button>
          <button
            className="primary-button client-form__submit"
            type="submit"
            disabled={
              isSubmitting ||
              isInvalidated ||
              isScheduledInFuture ||
              optionsState.status !== 'loaded'
            }
          >
            {isSubmitting ? 'Concluindo…' : 'Confirmar conclusão'}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
