import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  cancelBooking,
  confirmBooking,
  type AgendaBookingListItem,
  type BookingStatusChange,
  type BookingsDataError,
  type CancelledBooking,
  type ConfirmedBooking,
} from '../data/bookings'

interface BookingConfirmDialogProps {
  booking: AgendaBookingListItem
  onClose: () => void
  onConfirmed: (booking: ConfirmedBooking) => void
  onInvalidated: () => void
}

interface BookingCancelDialogProps {
  booking: AgendaBookingListItem
  onClose: () => void
  onCancelled: (booking: CancelledBooking) => void
  onInvalidated: () => void
}

type BookingStatusAction = 'confirm' | 'cancel'

interface BookingStatusDialogProps {
  action: BookingStatusAction
  booking: AgendaBookingListItem
  onClose: () => void
  onChanged: (booking: BookingStatusChange) => void
  onInvalidated: () => void
}

type StatusSubmissionState =
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

function actionCopy(action: BookingStatusAction, currentStatus: string) {
  if (action === 'confirm') {
    return {
      title: 'Confirmar agendamento?',
      description: 'passará de Agendado para Confirmado.',
      pendingLabel: 'Confirmando…',
      submitLabel: 'Confirmar agendamento',
    }
  }

  return {
    title: 'Cancelar agendamento?',
    description: `passará de ${
      currentStatus === 'confirmed' ? 'Confirmado' : 'Agendado'
    } para Cancelado. O horário ficará disponível para outro agendamento.`,
    pendingLabel: 'Cancelando…',
    submitLabel: 'Cancelar agendamento',
  }
}

function friendlyStatusError(
  error: BookingsDataError,
  action: BookingStatusAction,
) {
  const databaseMessage = error.message.toLocaleLowerCase('en-US')
  const actionLabel = action === 'confirm' ? 'confirmado' : 'cancelado'

  if (error.code === 'P0002') {
    return 'Este agendamento não existe mais. A agenda está sendo atualizada.'
  }

  if (error.code === '55000') {
    return `O agendamento mudou de status e não pode mais ser ${actionLabel}. A agenda está sendo atualizada.`
  }

  if (error.code === '42501' || error.code.startsWith('PGRST3')) {
    return `Sua sessão não possui permissão para ${
      action === 'confirm' ? 'confirmar' : 'cancelar'
    } agendamentos.`
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

  return `Não foi possível ${
    action === 'confirm' ? 'confirmar' : 'cancelar'
  } o agendamento. Tente novamente.`
}

function unexpectedStatusError(error: unknown) {
  return error instanceof TypeError
    ? 'Não foi possível conectar ao serviço. Verifique sua conexão e tente novamente.'
    : 'Ocorreu uma falha inesperada. Tente novamente.'
}

function BookingStatusDialog({
  action,
  booking,
  onClose,
  onChanged,
  onInvalidated,
}: BookingStatusDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [submission, setSubmission] = useState<StatusSubmissionState>({
    status: 'idle',
  })
  const isSubmitting = submission.status === 'submitting'
  const isInvalidated =
    submission.status === 'error' && submission.invalidated
  const clientName = booking.client?.name ?? 'Cliente indisponível'
  const copy = actionCopy(action, booking.status)

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

    setSubmission({ status: 'submitting' })

    try {
      const result =
        action === 'confirm'
          ? await confirmBooking(booking.id)
          : await cancelBooking(booking.id)

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

        setSubmission({
          status: 'error',
          kind: 'supabase',
          message: friendlyStatusError(result.error, action),
          cause: result.error,
          invalidated,
        })
        return
      }

      onChanged(result.data)
    } catch (error) {
      setSubmission({
        status: 'error',
        kind: 'unexpected',
        message: unexpectedStatusError(error),
        cause: error,
        invalidated: false,
      })
    }
  }

  return (
    <dialog
      className="client-dialog client-active-dialog"
      ref={dialogRef}
      aria-labelledby={`booking-${action}-title`}
      aria-describedby={`booking-${action}-description`}
      onClose={onClose}
      onCancel={(event) => {
        if (isSubmitting) event.preventDefault()
      }}
    >
      <form className="client-form" onSubmit={handleSubmit}>
        <header className="client-dialog__header">
          <div>
            <span className="eyebrow">Status do agendamento</span>
            <h2 id={`booking-${action}-title`}>{copy.title}</h2>
            <p>{clientName}</p>
          </div>
          <button
            className="client-dialog__close"
            type="button"
            aria-label={
              action === 'confirm' ? 'Fechar confirmação' : 'Fechar cancelamento'
            }
            onClick={closeDialog}
            disabled={isSubmitting}
          >
            ×
          </button>
        </header>

        <div className="client-active-dialog__body">
          <p id={`booking-${action}-description`}>
            O agendamento de {scheduleLabel(booking.starts_at)} {copy.description}
          </p>
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
            Voltar
          </button>
          <button
            className="primary-button client-form__submit"
            type="submit"
            disabled={isSubmitting || isInvalidated}
          >
            {isSubmitting ? copy.pendingLabel : copy.submitLabel}
          </button>
        </footer>
      </form>
    </dialog>
  )
}

export function BookingConfirmDialog({
  booking,
  onClose,
  onConfirmed,
  onInvalidated,
}: BookingConfirmDialogProps) {
  return (
    <BookingStatusDialog
      action="confirm"
      booking={booking}
      onClose={onClose}
      onChanged={onConfirmed}
      onInvalidated={onInvalidated}
    />
  )
}

export function BookingCancelDialog({
  booking,
  onClose,
  onCancelled,
  onInvalidated,
}: BookingCancelDialogProps) {
  return (
    <BookingStatusDialog
      action="cancel"
      booking={booking}
      onClose={onClose}
      onChanged={onCancelled}
      onInvalidated={onInvalidated}
    />
  )
}
