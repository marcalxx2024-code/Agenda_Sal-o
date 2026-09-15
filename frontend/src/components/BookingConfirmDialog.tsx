import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  confirmBooking,
  type AgendaBookingListItem,
  type BookingsDataError,
  type ConfirmedBooking,
} from '../data/bookings'

interface BookingConfirmDialogProps {
  booking: AgendaBookingListItem
  onClose: () => void
  onConfirmed: (booking: ConfirmedBooking) => void
  onInvalidated: () => void
}

type ConfirmationState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | {
      status: 'error'
      kind: 'supabase' | 'unexpected'
      message: string
      cause: BookingsDataError | unknown
      invalidated: boolean
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

function scheduleLabel(startsAt: string) {
  const start = new Date(startsAt)

  if (Number.isNaN(start.getTime())) return 'Horário indisponível'

  return `${dateFormatter.format(start)}, às ${timeFormatter.format(start)}`
}

function friendlyConfirmationError(error: BookingsDataError) {
  const databaseMessage = error.message.toLocaleLowerCase('en-US')

  if (error.code === 'P0002') {
    return 'Este agendamento não existe mais. A agenda está sendo atualizada.'
  }

  if (error.code === '55000') {
    return 'O agendamento mudou de status e não pode mais ser confirmado. A agenda está sendo atualizada.'
  }

  if (error.code === '42501' || error.code.startsWith('PGRST3')) {
    return 'Sua sessão não possui permissão para confirmar agendamentos.'
  }

  if (error.code === '22023') {
    return 'Não foi possível identificar o agendamento. Atualize a agenda e tente novamente.'
  }

  if (error.code === '23P01') {
    return 'O horário entrou em conflito com outra alteração. A agenda está sendo atualizada.'
  }

  if (error.code === '40001' || error.code === '40P01') {
    return 'Outra alteração ocorreu ao mesmo tempo. A agenda está sendo atualizada.'
  }

  if (!error.code || databaseMessage.includes('fetch')) {
    return 'Não foi possível conectar ao serviço. Verifique sua conexão e tente novamente.'
  }

  return 'Não foi possível confirmar o agendamento. Tente novamente.'
}

function unexpectedConfirmationError(error: unknown) {
  return error instanceof TypeError
    ? 'Não foi possível conectar ao serviço. Verifique sua conexão e tente novamente.'
    : 'Ocorreu uma falha inesperada. Tente novamente.'
}

export function BookingConfirmDialog({
  booking,
  onClose,
  onConfirmed,
  onInvalidated,
}: BookingConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [confirmation, setConfirmation] = useState<ConfirmationState>({
    status: 'idle',
  })
  const isSubmitting = confirmation.status === 'submitting'
  const isInvalidated =
    confirmation.status === 'error' && confirmation.invalidated
  const clientName = booking.client?.name ?? 'Cliente indisponível'

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  function closeDialog() {
    if (!isSubmitting) dialogRef.current?.close()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    setConfirmation({ status: 'submitting' })

    try {
      const result = await confirmBooking(booking.id)

      if (result.error) {
        const invalidated = [
          'P0002',
          '55000',
          '23P01',
          '40001',
          '40P01',
        ].includes(result.error.code)

        if (invalidated) {
          onInvalidated()
        }

        setConfirmation({
          status: 'error',
          kind: 'supabase',
          message: friendlyConfirmationError(result.error),
          cause: result.error,
          invalidated,
        })
        return
      }

      onConfirmed(result.data)
    } catch (error) {
      setConfirmation({
        status: 'error',
        kind: 'unexpected',
        message: unexpectedConfirmationError(error),
        cause: error,
        invalidated: false,
      })
    }
  }

  return (
    <dialog
      className="client-dialog client-active-dialog"
      ref={dialogRef}
      aria-labelledby="booking-confirm-title"
      aria-describedby="booking-confirm-description"
      onClose={onClose}
      onCancel={(event) => {
        if (isSubmitting) event.preventDefault()
      }}
    >
      <form className="client-form" onSubmit={handleSubmit}>
        <header className="client-dialog__header">
          <div>
            <span className="eyebrow">Status do agendamento</span>
            <h2 id="booking-confirm-title">Confirmar agendamento?</h2>
            <p>{clientName}</p>
          </div>
          <button
            className="client-dialog__close"
            type="button"
            aria-label="Fechar confirmação"
            onClick={closeDialog}
            disabled={isSubmitting}
          >
            ×
          </button>
        </header>

        <div className="client-active-dialog__body">
          <p id="booking-confirm-description">
            O agendamento de {scheduleLabel(booking.starts_at)} passará de
            Agendado para Confirmado.
          </p>
        </div>

        {confirmation.status === 'error' && (
          <p className="client-form__submit-error" role="alert">
            {confirmation.message}
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
            disabled={isSubmitting || isInvalidated}
          >
            {isSubmitting ? 'Confirmando…' : 'Confirmar agendamento'}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
