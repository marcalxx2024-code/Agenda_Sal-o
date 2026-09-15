import { useEffect, useState } from 'react'
import { BookingConfirmDialog } from '../components/BookingConfirmDialog'
import { BookingDialog } from '../components/BookingDialog'
import {
  listBookings,
  type AgendaBookingListItem,
  type BookingsDataError,
  type ConfirmedBooking,
} from '../data/bookings'

type AgendaLoadState =
  | { status: 'loading' }
  | { status: 'error'; error: BookingsDataError | null }
  | { status: 'loaded'; bookings: AgendaBookingListItem[] }

const bookingStatus = {
  scheduled: { label: 'Agendado', tone: 'scheduled' },
  confirmed: { label: 'Confirmado', tone: 'confirmed' },
  completed: { label: 'Concluído', tone: 'completed' },
  cancelled: { label: 'Cancelado', tone: 'cancelled' },
  no_show: { label: 'Não compareceu', tone: 'no-show' },
} as const

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
})

function bookingCountLabel(count: number) {
  return `${count} ${count === 1 ? 'agendamento' : 'agendamentos'}`
}

function validDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function scheduleLabels(startsAt: string, endsAt: string) {
  const start = validDate(startsAt)
  const end = validDate(endsAt)

  if (!start) {
    return { date: 'Data indisponível', time: 'Horário indisponível' }
  }

  return {
    date: dateFormatter.format(start),
    time: end
      ? `${timeFormatter.format(start)}–${timeFormatter.format(end)}`
      : timeFormatter.format(start),
  }
}

function durationLabel(startsAt: string, endsAt: string) {
  const start = validDate(startsAt)
  const end = validDate(endsAt)

  if (!start || !end) return 'Indisponível'

  const durationMinutes = Math.round(
    (end.getTime() - start.getTime()) / (60 * 1000),
  )

  if (durationMinutes <= 0) return 'Indisponível'
  if (durationMinutes < 60) return `${durationMinutes} min`

  const hours = Math.floor(durationMinutes / 60)
  const minutes = durationMinutes % 60

  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`
}

function statusDetails(status: string) {
  return (
    bookingStatus[status as keyof typeof bookingStatus] ?? {
      label: 'Status desconhecido',
      tone: 'unknown',
    }
  )
}

export function AgendaPage() {
  const [loadState, setLoadState] = useState<AgendaLoadState>({
    status: 'loading',
  })
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [isBookingFormOpen, setIsBookingFormOpen] = useState(false)
  const [bookingToConfirm, setBookingToConfirm] =
    useState<AgendaBookingListItem | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)

  useEffect(() => {
    let isCurrent = true

    void listBookings()
      .then((result) => {
        if (!isCurrent) return

        if (result.error) {
          setLoadState({ status: 'error', error: result.error })
          return
        }

        setLoadState({ status: 'loaded', bookings: result.data })
      })
      .catch(() => {
        if (!isCurrent) return
        setLoadState({ status: 'error', error: null })
      })

    return () => {
      isCurrent = false
    }
  }, [loadAttempt])

  const bookings =
    loadState.status === 'loaded' ? loadState.bookings : []

  function retryLoading() {
    setLoadState({ status: 'loading' })
    setLoadAttempt((attempt) => attempt + 1)
  }

  function openCreateDialog() {
    setSaveSuccess(null)
    setIsBookingFormOpen(true)
  }

  function handleBookingCreated() {
    setIsBookingFormOpen(false)
    setSaveSuccess('Agendamento criado com sucesso.')
    setLoadState({ status: 'loading' })
    setLoadAttempt((attempt) => attempt + 1)
  }

  function openConfirmDialog(booking: AgendaBookingListItem) {
    setSaveSuccess(null)
    setBookingToConfirm(booking)
  }

  function handleBookingConfirmed(confirmedBooking: ConfirmedBooking) {
    setBookingToConfirm(null)
    setSaveSuccess('Agendamento confirmado com sucesso.')
    setLoadState((currentState) =>
      currentState.status === 'loaded'
        ? {
            status: 'loaded',
            bookings: currentState.bookings.map((booking) =>
              booking.id === confirmedBooking.booking_id
                ? { ...booking, status: confirmedBooking.booking_status }
                : booking,
            ),
          }
        : currentState,
    )
    setLoadAttempt((attempt) => attempt + 1)
  }

  function refreshInvalidatedBooking() {
    setLoadState({ status: 'loading' })
    setLoadAttempt((attempt) => attempt + 1)
  }

  return (
    <section className="agenda-page" aria-labelledby="agenda-title">
      <header className="agenda-page__heading">
        <div>
          <span className="eyebrow">Agenda do salão</span>
          <h2 id="agenda-title">Agendamentos</h2>
          <p>Consulte horários, clientes e serviços já programados.</p>
        </div>
        <div className="agenda-page__header-actions">
          {loadState.status === 'loaded' && (
            <span className="agenda-result-count" aria-live="polite">
              {bookingCountLabel(bookings.length)}
            </span>
          )}
          <button
            className="agenda-new-button"
            type="button"
            onClick={openCreateDialog}
          >
            Novo agendamento
          </button>
        </div>
      </header>

      {saveSuccess && (
        <p className="agenda-success" role="status">
          {saveSuccess}
        </p>
      )}

      {loadState.status === 'loading' && (
        <div className="agenda-state" role="status" aria-live="polite">
          <span className="agenda-state__pulse" aria-hidden="true" />
          <h3>Carregando agenda…</h3>
          <p>Aguarde enquanto buscamos os agendamentos do salão.</p>
        </div>
      )}

      {loadState.status === 'error' && (
        <div className="agenda-state" role="alert">
          <span className="eyebrow">Falha na consulta</span>
          <h3>Não foi possível carregar a agenda.</h3>
          <p>Verifique sua conexão e tente novamente.</p>
          <button
            className="primary-button agenda-state__button"
            type="button"
            onClick={retryLoading}
          >
            Tentar novamente
          </button>
        </div>
      )}

      {loadState.status === 'loaded' && bookings.length === 0 && (
        <div className="agenda-state" role="status">
          <span className="eyebrow">Agenda</span>
          <h3>Nenhum agendamento cadastrado.</h3>
          <p>Os próximos horários aparecerão aqui quando forem agendados.</p>
        </div>
      )}

      {loadState.status === 'loaded' && bookings.length > 0 && (
        <section className="agenda-list" aria-label="Lista de agendamentos">
          <div className="agenda-list__header" aria-hidden="true">
            <span>Data e horário</span>
            <span>Cliente</span>
            <span>Serviços</span>
            <span>Duração</span>
            <span>Status e ações</span>
          </div>
          <ul>
            {bookings.map((booking) => {
              const schedule = scheduleLabels(
                booking.starts_at,
                booking.ends_at,
              )
              const details = statusDetails(booking.status)
              const notes = booking.notes?.trim()
              const services = [...(booking.booking_services ?? [])].sort(
                (first, second) => first.id - second.id,
              )

              return (
                <li className="booking-row" key={booking.id}>
                  <div className="booking-row__schedule">
                    <strong>{schedule.date}</strong>
                    <span>{schedule.time}</span>
                  </div>
                  <div className="booking-row__client">
                    <span className="booking-row__label">Cliente</span>
                    <strong>{booking.client?.name ?? 'Cliente indisponível'}</strong>
                  </div>
                  <div className="booking-row__services">
                    <span className="booking-row__label">Serviços</span>
                    {services.length > 0 ? (
                      <ul aria-label={`Serviços de ${booking.client?.name ?? 'cliente indisponível'}`}>
                        {services.map((service) => (
                          <li key={service.id}>{service.service_name}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="booking-row__missing">
                        Nenhum serviço informado
                      </span>
                    )}
                  </div>
                  <div className="booking-row__duration">
                    <span className="booking-row__label">Duração</span>
                    {durationLabel(booking.starts_at, booking.ends_at)}
                  </div>
                  <div className="booking-row__controls">
                    <span
                      className={`booking-status booking-status--${details.tone}`}
                    >
                      {details.label}
                    </span>
                    {booking.status === 'scheduled' && (
                      <button
                        className="booking-row__action"
                        type="button"
                        aria-label={`Confirmar agendamento de ${booking.client?.name ?? 'cliente indisponível'} em ${schedule.date}, ${schedule.time}`}
                        onClick={() => openConfirmDialog(booking)}
                      >
                        Confirmar
                      </button>
                    )}
                  </div>
                  {notes && (
                    <p className="booking-row__notes">
                      <strong>Observações:</strong> {notes}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {isBookingFormOpen && (
        <BookingDialog
          onClose={() => setIsBookingFormOpen(false)}
          onCreated={handleBookingCreated}
        />
      )}

      {bookingToConfirm && (
        <BookingConfirmDialog
          key={bookingToConfirm.id}
          booking={bookingToConfirm}
          onClose={() => setBookingToConfirm(null)}
          onConfirmed={handleBookingConfirmed}
          onInvalidated={refreshInvalidatedBooking}
        />
      )}
    </section>
  )
}
