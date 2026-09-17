import { useEffect, useState, type FormEvent } from 'react'
import { BookingCompleteDialog } from '../components/BookingCompleteDialog'
import {
  BookingCancelDialog,
  BookingConfirmDialog,
  BookingNoShowDialog,
} from '../components/BookingConfirmDialog'
import { BookingDialog } from '../components/BookingDialog'
import {
  listBookings,
  type AgendaBookingListItem,
  type BookingStatusChange,
  type BookingsDataError,
  type CancelledBooking,
  type ConfirmedBooking,
  type CompletedBooking,
  type NoShowBooking,
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

function localDateValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function initialPeriod() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 29)
  return { from: localDateValue(start), to: localDateValue(end) }
}

function periodToQuery(from: string, to: string, status: string) {
  const start = from ? new Date(`${from}T00:00:00`) : null
  const end = to ? new Date(`${to}T00:00:00`) : null
  if (end) end.setDate(end.getDate() + 1)
  return {
    ...(start && !Number.isNaN(start.getTime())
      ? { from: start.toISOString() }
      : {}),
    ...(end && !Number.isNaN(end.getTime()) ? { to: end.toISOString() } : {}),
    ...(status ? { status } : {}),
  }
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

function canMarkBookingNoShow(
  booking: AgendaBookingListItem,
  currentTime: number,
) {
  if (booking.status !== 'scheduled' && booking.status !== 'confirmed') {
    return false
  }

  const startsAt = validDate(booking.starts_at)
  return startsAt !== null && startsAt.getTime() <= currentTime
}

export function AgendaPage() {
  const defaultPeriod = initialPeriod()
  const [loadState, setLoadState] = useState<AgendaLoadState>({
    status: 'loading',
  })
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [isBookingFormOpen, setIsBookingFormOpen] = useState(false)
  const [bookingToEdit, setBookingToEdit] =
    useState<AgendaBookingListItem | null>(null)
  const [bookingToConfirm, setBookingToConfirm] =
    useState<AgendaBookingListItem | null>(null)
  const [bookingToCancel, setBookingToCancel] =
    useState<AgendaBookingListItem | null>(null)
  const [bookingToMarkNoShow, setBookingToMarkNoShow] =
    useState<AgendaBookingListItem | null>(null)
  const [bookingToComplete, setBookingToComplete] =
    useState<AgendaBookingListItem | null>(null)
  const [filterFrom, setFilterFrom] = useState(defaultPeriod.from)
  const [filterTo, setFilterTo] = useState(defaultPeriod.to)
  const [filterStatus, setFilterStatus] = useState('')
  const [appliedFilters, setAppliedFilters] = useState(() =>
    periodToQuery(defaultPeriod.from, defaultPeriod.to, ''),
  )
  const [currentTime, setCurrentTime] = useState(() => Date.now())
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCurrentTime(Date.now())
    }, 30_000)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    let isCurrent = true

    void listBookings(appliedFilters)
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
  }, [appliedFilters, loadAttempt])

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

  function openEditDialog(booking: AgendaBookingListItem) {
    setSaveSuccess(null)
    setBookingToEdit(booking)
  }

  function handleBookingUpdated() {
    setBookingToEdit(null)
    setSaveSuccess('Agendamento atualizado com sucesso.')
    setLoadState({ status: 'loading' })
    setLoadAttempt((attempt) => attempt + 1)
  }

  function openConfirmDialog(booking: AgendaBookingListItem) {
    setSaveSuccess(null)
    setBookingToConfirm(booking)
  }

  function reflectBookingStatus(changedBooking: BookingStatusChange) {
    setLoadState((currentState) =>
      currentState.status === 'loaded'
        ? {
            status: 'loaded',
            bookings: currentState.bookings.map((booking) =>
              booking.id === changedBooking.booking_id
                ? { ...booking, status: changedBooking.booking_status }
                : booking,
            ),
          }
        : currentState,
    )
    setLoadAttempt((attempt) => attempt + 1)
  }

  function handleBookingConfirmed(confirmedBooking: ConfirmedBooking) {
    setBookingToConfirm(null)
    setSaveSuccess('Agendamento confirmado com sucesso.')
    reflectBookingStatus(confirmedBooking)
  }

  function openCancelDialog(booking: AgendaBookingListItem) {
    setSaveSuccess(null)
    setBookingToCancel(booking)
  }

  function handleBookingCancelled(cancelledBooking: CancelledBooking) {
    setBookingToCancel(null)
    setSaveSuccess('Agendamento cancelado com sucesso.')
    reflectBookingStatus(cancelledBooking)
  }

  function openNoShowDialog(booking: AgendaBookingListItem) {
    setSaveSuccess(null)
    setBookingToMarkNoShow(booking)
  }

  function handleBookingMarkedNoShow(noShowBooking: NoShowBooking) {
    setBookingToMarkNoShow(null)
    setSaveSuccess('Não comparecimento registrado com sucesso.')
    reflectBookingStatus(noShowBooking)
  }

  function openCompleteDialog(booking: AgendaBookingListItem) {
    setSaveSuccess(null)
    setBookingToComplete(booking)
  }

  function handleBookingCompleted(completedBooking: CompletedBooking) {
    setBookingToComplete(null)
    setSaveSuccess('Atendimento concluído e registrado no histórico.')
    setLoadState((currentState) =>
      currentState.status === 'loaded'
        ? {
            status: 'loaded',
            bookings: currentState.bookings.map((booking) =>
              booking.id === completedBooking.booking_id
                ? { ...booking, status: completedBooking.booking_status }
                : booking,
            ),
          }
        : currentState,
    )
    setLoadAttempt((attempt) => attempt + 1)
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaveSuccess(null)
    setLoadState({ status: 'loading' })
    setAppliedFilters(periodToQuery(filterFrom, filterTo, filterStatus))
  }

  function applyQuickPeriod(totalDays: number) {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + totalDays - 1)
    const from = localDateValue(start)
    const to = localDateValue(end)
    setFilterFrom(from)
    setFilterTo(to)
    setLoadState({ status: 'loading' })
    setAppliedFilters(periodToQuery(from, to, filterStatus))
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

      <form className="agenda-filters" onSubmit={applyFilters}>
        <div className="agenda-filters__quick" aria-label="Períodos rápidos">
          <button type="button" onClick={() => applyQuickPeriod(1)}>Hoje</button>
          <button type="button" onClick={() => applyQuickPeriod(7)}>Próximos 7 dias</button>
          <button type="button" onClick={() => applyQuickPeriod(30)}>Próximos 30 dias</button>
        </div>
        <div className="agenda-filters__fields">
          <label>
            Data inicial
            <input
              type="date"
              value={filterFrom}
              onChange={(event) => setFilterFrom(event.target.value)}
            />
          </label>
          <label>
            Data final
            <input
              type="date"
              value={filterTo}
              min={filterFrom || undefined}
              onChange={(event) => setFilterTo(event.target.value)}
            />
          </label>
          <label>
            Status
            <select
              value={filterStatus}
              onChange={(event) => setFilterStatus(event.target.value)}
            >
              <option value="">Todos</option>
              <option value="scheduled">Agendado</option>
              <option value="confirmed">Confirmado</option>
              <option value="completed">Concluído</option>
              <option value="cancelled">Cancelado</option>
              <option value="no_show">Não compareceu</option>
            </select>
          </label>
          <button className="primary-button" type="submit">Aplicar filtros</button>
        </div>
      </form>

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
          <h3>Nenhum agendamento encontrado.</h3>
          <p>Altere o período ou o status para consultar outros horários.</p>
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
                    {(booking.status === 'scheduled' ||
                      booking.status === 'confirmed') && (
                      <button
                        className="booking-row__action"
                        type="button"
                        aria-label={`Editar agendamento de ${booking.client?.name ?? 'cliente indisponível'} em ${schedule.date}, ${schedule.time}`}
                        onClick={() => openEditDialog(booking)}
                      >
                        Editar
                      </button>
                    )}
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
                    {(booking.status === 'scheduled' ||
                      booking.status === 'confirmed') && (
                      <button
                        className="booking-row__action booking-row__action--complete"
                        type="button"
                        aria-label={`Concluir atendimento de ${booking.client?.name ?? 'cliente indisponível'} em ${schedule.date}, ${schedule.time}`}
                        onClick={() => openCompleteDialog(booking)}
                      >
                        Concluir atendimento
                      </button>
                    )}
                    {(booking.status === 'scheduled' ||
                      booking.status === 'confirmed') && (
                      <button
                        className="booking-row__action booking-row__action--cancel"
                        type="button"
                        aria-label={`Cancelar agendamento de ${booking.client?.name ?? 'cliente indisponível'} em ${schedule.date}, ${schedule.time}`}
                        onClick={() => openCancelDialog(booking)}
                      >
                        Cancelar
                      </button>
                    )}
                    {canMarkBookingNoShow(booking, currentTime) && (
                      <button
                        className="booking-row__action"
                        type="button"
                        aria-label={`Registrar não comparecimento de ${booking.client?.name ?? 'cliente indisponível'} em ${schedule.date}, ${schedule.time}`}
                        onClick={() => openNoShowDialog(booking)}
                      >
                        Não compareceu
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

      {bookingToEdit && (
        <BookingDialog
          key={bookingToEdit.id}
          booking={bookingToEdit}
          onClose={() => setBookingToEdit(null)}
          onUpdated={handleBookingUpdated}
          onInvalidated={refreshInvalidatedBooking}
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

      {bookingToCancel && (
        <BookingCancelDialog
          key={bookingToCancel.id}
          booking={bookingToCancel}
          onClose={() => setBookingToCancel(null)}
          onCancelled={handleBookingCancelled}
          onInvalidated={refreshInvalidatedBooking}
        />
      )}

      {bookingToMarkNoShow && (
        <BookingNoShowDialog
          key={bookingToMarkNoShow.id}
          booking={bookingToMarkNoShow}
          onClose={() => setBookingToMarkNoShow(null)}
          onMarkedNoShow={handleBookingMarkedNoShow}
          onInvalidated={refreshInvalidatedBooking}
        />
      )}

      {bookingToComplete && (
        <BookingCompleteDialog
          key={bookingToComplete.id}
          booking={bookingToComplete}
          onClose={() => setBookingToComplete(null)}
          onCompleted={handleBookingCompleted}
          onInvalidated={refreshInvalidatedBooking}
        />
      )}
    </section>
  )
}
