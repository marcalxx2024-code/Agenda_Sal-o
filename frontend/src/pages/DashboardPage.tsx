import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadDashboard, type DashboardData } from '../data/dashboard'
import { formatDateOnly, salonDateTimeFormatter } from '../lib/salon-time'

type DashboardState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; data: DashboardData }

const dayFormatter = salonDateTimeFormatter({
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export function DashboardPage() {
  const [state, setState] = useState<DashboardState>({ status: 'loading' })
  const [loadAttempt, setLoadAttempt] = useState(0)

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
  const cards = [
    [
      'Agendamentos de hoje',
      data.todayBookings,
      'Horários ativos previstos para hoje',
      'rose',
    ],
    [
      'Próximos agendamentos',
      data.upcomingBookings,
      'Agendados ou confirmados daqui em diante',
      'olive',
    ],
    [
      'Clientes ativos',
      data.activeClients,
      'Cadastros disponíveis para agendamento',
      'sand',
    ],
    [
      'Serviços ativos',
      data.activeServices,
      'Procedimentos disponíveis no catálogo',
      'rose',
    ],
    [
      'Retornos pendentes',
      data.pendingReturns,
      'Contatos aguardando acompanhamento',
      'sand',
    ],
    [
      'Atendimentos recentes',
      data.recentAppointmentsCount,
      'Realizados nos últimos 30 dias',
      'olive',
    ],
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

      <section className="overview-section" aria-labelledby="overview-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Resumo</span>
            <h3 id="overview-title">Operação do salão</h3>
          </div>
          <span className="placeholder-badge">Atualizado agora</span>
        </div>
        <div className="overview-grid dashboard-overview-grid">
          {cards.map(([label, value, note, tone]) => (
            <article
              className={`overview-card overview-card--${tone}`}
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
    </div>
  )
}
