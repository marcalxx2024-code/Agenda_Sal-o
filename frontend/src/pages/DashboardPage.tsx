import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookingDialog } from '../components/BookingDialog'
import { MonthlyCalendar } from '../components/MonthlyCalendar'
import type { CreatedBooking } from '../data/bookings'
import {
  loadDashboard,
  loadDashboardBookings,
  type DashboardBooking,
  type DashboardData,
} from '../data/dashboard'
import {
  addMonthsToDateValue,
  formatDateOnly,
  isoToSalonInputValues,
  monthDateValues,
  salonDateTimeFormatter,
  salonDateValue,
  startOfMonthDateValue,
} from '../lib/salon-time'

type DashboardState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; data: DashboardData }

type MonthBookingsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; bookings: DashboardBooking[] }

const dayFormatter = salonDateTimeFormatter({
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

const timeFormatter = salonDateTimeFormatter({
  hour: '2-digit',
  minute: '2-digit',
})

export function DashboardPage() {
  const [today] = useState(() => salonDateValue())
  const [state, setState] = useState<DashboardState>({ status: 'loading' })
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonthDateValue(today),
  )
  const [selectedDate, setSelectedDate] = useState(today)
  const [monthState, setMonthState] = useState<MonthBookingsState>({
    status: 'loading',
  })
  const [monthLoadAttempt, setMonthLoadAttempt] = useState(0)
  const [isBookingFormOpen, setIsBookingFormOpen] = useState(false)

  useEffect(() => {
    let isCurrent = true
    void loadDashboard()
      .then((result) => {
        if (!isCurrent) return
        setState(
          result.error
            ? { status: 'error' }
            : { status: 'loaded', data: result.data },
        )
      })
      .catch(() => {
        if (isCurrent) setState({ status: 'error' })
      })
    return () => {
      isCurrent = false
    }
  }, [loadAttempt])

  useEffect(() => {
    let isCurrent = true
    const range = monthDateValues(visibleMonth)

    void loadDashboardBookings(range.from, range.to)
      .then((result) => {
        if (!isCurrent) return
        setMonthState(
          result.error
            ? { status: 'error' }
            : { status: 'loaded', bookings: result.data },
        )
      })
      .catch(() => {
        if (isCurrent) setMonthState({ status: 'error' })
      })

    return () => {
      isCurrent = false
    }
  }, [visibleMonth, monthLoadAttempt])

  const bookingsByDate = useMemo(() => {
    const grouped = new Map<string, DashboardBooking[]>()

    if (monthState.status !== 'loaded') return grouped

    for (const booking of monthState.bookings) {
      const date = isoToSalonInputValues(booking.starts_at).date
      if (!date) continue
      const bookings = grouped.get(date) ?? []
      bookings.push(booking)
      grouped.set(date, bookings)
    }

    return grouped
  }, [monthState])

  function navigateMonth(offset: number) {
    const nextMonth = startOfMonthDateValue(
      addMonthsToDateValue(visibleMonth, offset),
    )
    setMonthState({ status: 'loading' })
    setVisibleMonth(nextMonth)
    setSelectedDate(nextMonth)
  }

  function retryMonthLoading() {
    setMonthState({ status: 'loading' })
    setMonthLoadAttempt((attempt) => attempt + 1)
  }

  function handleBookingCreated(
    booking: CreatedBooking,
    client: DashboardBooking['client'],
  ) {
    const createdBooking: DashboardBooking = {
      id: booking.booking_id,
      starts_at: booking.booking_starts_at,
      status: booking.booking_status,
      client,
    }
    const createdDate = isoToSalonInputValues(createdBooking.starts_at).date
    const visibleRange = monthDateValues(visibleMonth)

    setIsBookingFormOpen(false)
    setMonthState((current) => {
      if (
        current.status !== 'loaded' ||
        createdDate < visibleRange.from ||
        createdDate > visibleRange.to ||
        current.bookings.some((item) => item.id === createdBooking.id)
      ) {
        return current
      }

      return {
        status: 'loaded',
        bookings: [...current.bookings, createdBooking].sort(
          (first, second) =>
            first.starts_at.localeCompare(second.starts_at) ||
            first.id - second.id,
        ),
      }
    })
    setMonthLoadAttempt((attempt) => attempt + 1)
    setLoadAttempt((attempt) => attempt + 1)
  }

  if (state.status === 'loading') {
    return (
      <div className="agenda-state" role="status">
        <span className="agenda-state__pulse" aria-hidden="true" />
        <h3>Carregando visão geral…</h3>
        <p>Aguarde enquanto reunimos os dados do salão.</p>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="agenda-state" role="alert">
        <span className="eyebrow">Falha na consulta</span>
        <h3>Não foi possível carregar o dashboard.</h3>
        <p>Verifique sua conexão e tente novamente.</p>
        <button
          className="primary-button agenda-state__button"
          type="button"
          onClick={() => {
            setState({ status: 'loading' })
            setLoadAttempt((attempt) => attempt + 1)
          }}
        >
          Tentar novamente
        </button>
      </div>
    )
  }

  const { data } = state
  const selectedBookings = bookingsByDate.get(selectedDate) ?? []
  const isTodaySelected = selectedDate === today
  const selectedDateLabel = formatDateOnly(selectedDate, {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
  const cards = [
    {
      label: 'Agendamentos de hoje',
      value: data.todayBookings,
      note: 'Horários ativos previstos para hoje',
      tone: 'rose',
      priority: true,
    },
    {
      label: 'Próximos agendamentos',
      value: data.upcomingBookings,
      note: 'Agendados ou confirmados daqui em diante',
      tone: 'olive',
      priority: true,
    },
    {
      label: 'Clientes ativos',
      value: data.activeClients,
      note: 'Cadastros disponíveis para agendamento',
      tone: 'sand',
      priority: false,
    },
    {
      label: 'Serviços ativos',
      value: data.activeServices,
      note: 'Procedimentos disponíveis no catálogo',
      tone: 'rose',
      priority: false,
    },
    {
      label: 'Retornos pendentes',
      value: data.pendingReturns,
      note: 'Contatos aguardando acompanhamento',
      tone: 'sand',
      priority: true,
    },
    {
      label: 'Atendimentos recentes',
      value: data.recentAppointmentsCount,
      note: 'Realizados nos últimos 30 dias',
      tone: 'olive',
      priority: false,
    },
  ] as const

  return (
    <div className="dashboard-page">
      <section className="welcome-block">
        <div>
          <span className="eyebrow">Visão atual do salão</span>
          <h2>Uma visão clara do seu dia.</h2>
          <p>Agenda, clientes, serviços e retornos reunidos com dados reais.</p>
        </div>
        <div className="welcome-block__detail" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>

      <div className="dashboard-calendar-area">
        <MonthlyCalendar
          visibleMonth={visibleMonth}
          selectedDate={selectedDate}
          today={today}
          datesWithBookings={new Set(bookingsByDate.keys())}
          isLoading={monthState.status === 'loading'}
          hasError={monthState.status === 'error'}
          onPreviousMonth={() => navigateMonth(-1)}
          onNextMonth={() => navigateMonth(1)}
          onSelectDate={setSelectedDate}
          onRetry={retryMonthLoading}
        />

        <section
          className="dashboard-list-panel dashboard-day-bookings"
          aria-labelledby="selected-bookings-title"
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">Agenda selecionada</span>
              <h3 id="selected-bookings-title">
                {isTodaySelected ? 'Agendamentos de hoje' : 'Agendamentos do dia'}
              </h3>
              <p className="dashboard-day-bookings__date">{selectedDateLabel}</p>
            </div>
            <div className="dashboard-day-bookings__actions">
              <button
                className="primary-button dashboard-day-bookings__new"
                type="button"
                onClick={() => setIsBookingFormOpen(true)}
              >
                + Novo agendamento
              </button>
              <Link to="/agenda">Ver agenda</Link>
            </div>
          </div>

          {monthState.status === 'loading' && (
            <p className="dashboard-list-empty" role="status">
              Carregando agendamentos…
            </p>
          )}
          {monthState.status === 'error' && (
            <div className="dashboard-day-bookings__error" role="alert">
              <p>Não foi possível consultar os horários desta data.</p>
              <button type="button" onClick={retryMonthLoading}>
                Tentar novamente
              </button>
            </div>
          )}
          {monthState.status === 'loaded' && selectedBookings.length === 0 && (
            <div className="dashboard-day-bookings__empty" role="status">
              <span aria-hidden="true">○</span>
              <p>Nenhum agendamento para este dia.</p>
              <small>Selecione outra data para consultar os horários.</small>
            </div>
          )}
          {monthState.status === 'loaded' && selectedBookings.length > 0 && (
            <ul>
              {selectedBookings.map((booking) => (
                <li key={booking.id}>
                  <div>
                    <strong>{booking.client?.name ?? 'Cliente indisponível'}</strong>
                    <span>{timeFormatter.format(new Date(booking.starts_at))}</span>
                  </div>
                  <span className={`booking-status booking-status--${booking.status}`}>
                    {booking.status === 'confirmed' ? 'Confirmado' : 'Agendado'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="overview-section" aria-labelledby="overview-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Resumo</span>
            <h3 id="overview-title">Operação do salão</h3>
          </div>
          <span className="placeholder-badge">Atualizado agora</span>
        </div>
        <div className="overview-grid dashboard-overview-grid">
          {cards.map(({ label, value, note, tone, priority }) => (
            <article
              className={`overview-card overview-card--${tone} overview-card--${priority ? 'priority' : 'secondary'}`}
              key={label}
            >
              <span className="overview-card__label">{label}</span>
              <strong>{value}</strong>
              <p>{note}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="dashboard-lists">
        <section
          className="dashboard-list-panel"
          aria-labelledby="next-bookings-title"
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">Agenda</span>
              <h3 id="next-bookings-title">Próximos horários</h3>
            </div>
            <Link to="/agenda">Ver agenda</Link>
          </div>
          {data.nextBookings.length === 0 ? (
            <p className="dashboard-list-empty">Nenhum próximo agendamento.</p>
          ) : (
            <ul>
              {data.nextBookings.map((booking) => (
                <li key={booking.id}>
                  <div>
                    <strong>
                      {booking.client?.name ?? 'Cliente indisponível'}
                    </strong>
                    <span>{dayFormatter.format(new Date(booking.starts_at))}</span>
                  </div>
                  <span
                    className={`booking-status booking-status--${booking.status}`}
                  >
                    {booking.status === 'confirmed'
                      ? 'Confirmado'
                      : 'Agendado'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          className="dashboard-list-panel"
          aria-labelledby="recent-title"
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">Histórico</span>
              <h3 id="recent-title">Atendimentos recentes</h3>
            </div>
            <Link to="/historico">Ver histórico</Link>
          </div>
          {data.recentAppointments.length === 0 ? (
            <p className="dashboard-list-empty">Nenhum atendimento realizado.</p>
          ) : (
            <ul>
              {data.recentAppointments.map((appointment) => (
                <li key={appointment.id}>
                  <div>
                    <strong>
                      {appointment.client?.name ?? 'Cliente indisponível'}
                    </strong>
                    <span>
                      {formatDateOnly(appointment.performed_on, {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                  <span className="booking-status booking-status--completed">
                    Realizado
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {isBookingFormOpen && (
        <BookingDialog
          initialDate={selectedDate}
          onClose={() => setIsBookingFormOpen(false)}
          onCreated={handleBookingCreated}
        />
      )}
    </div>
  )
}
