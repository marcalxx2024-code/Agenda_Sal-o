import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  listAppointments,
  type AppointmentListItem,
  type AppointmentsDataError,
} from '../data/appointments'

type HistoryState =
  | { status: 'loading' }
  | { status: 'error'; error: AppointmentsDataError | null }
  | { status: 'loaded'; appointments: AppointmentListItem[] }

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isNaN(date.getTime())
    ? 'Data indisponível'
    : dateFormatter.format(date)
}

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
}

export function HistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const clientIdValue = searchParams.get('cliente')
  const parsedClientId = clientIdValue ? Number(clientIdValue) : undefined
  const clientId =
    parsedClientId !== undefined && Number.isSafeInteger(parsedClientId)
      ? parsedClientId
      : undefined
  const [search, setSearch] = useState(searchParams.get('nome') ?? '')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [state, setState] = useState<HistoryState>({ status: 'loading' })

  useEffect(() => {
    let isCurrent = true

    void listAppointments(clientId)
      .then((result) => {
        if (!isCurrent) return
        setState(
          result.error
            ? { status: 'error', error: result.error }
            : { status: 'loaded', appointments: result.data },
        )
      })
      .catch(() => {
        if (isCurrent) setState({ status: 'error', error: null })
      })

    return () => {
      isCurrent = false
    }
  }, [clientId, loadAttempt])

  const visibleAppointments = useMemo(() => {
    const appointments = state.status === 'loaded' ? state.appointments : []
    const query = normalizeText(search.trim())
    if (!query) return appointments
    return appointments.filter((appointment) =>
      normalizeText(appointment.client?.name ?? '').includes(query),
    )
  }, [search, state])

  function clearClientFilter() {
    setSearch('')
    setSearchParams({})
    setState({ status: 'loading' })
  }

  return (
    <section className="history-page records-page" aria-labelledby="history-title">
      <header className="records-page__heading">
        <div>
          <span className="eyebrow">Atendimentos realizados</span>
          <h2 id="history-title">Histórico</h2>
          <p>Consulte clientes, serviços realizados e observações registradas.</p>
        </div>
        {state.status === 'loaded' && (
          <span className="agenda-result-count">
            {visibleAppointments.length}{' '}
            {visibleAppointments.length === 1
              ? 'atendimento'
              : 'atendimentos'}
          </span>
        )}
      </header>

      <div className="records-toolbar">
        <label htmlFor="history-search">Buscar por cliente</label>
        <div>
          <input
            id="history-search"
            type="search"
            value={search}
            placeholder="Digite o nome da cliente"
            onChange={(event) => setSearch(event.target.value)}
            disabled={clientId !== undefined}
          />
          {clientId !== undefined && (
            <button type="button" onClick={clearClientFilter}>
              Ver todas as clientes
            </button>
          )}
        </div>
      </div>

      {state.status === 'loading' && (
        <div className="agenda-state" role="status">
          <span className="agenda-state__pulse" aria-hidden="true" />
          <h3>Carregando histórico…</h3>
          <p>Aguarde enquanto buscamos os atendimentos realizados.</p>
        </div>
      )}

      {state.status === 'error' && (
        <div className="agenda-state" role="alert">
          <span className="eyebrow">Falha na consulta</span>
          <h3>Não foi possível carregar o histórico.</h3>
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
      )}

      {state.status === 'loaded' && visibleAppointments.length === 0 && (
        <div className="agenda-state" role="status">
          <span className="eyebrow">Histórico</span>
          <h3>Nenhum atendimento encontrado.</h3>
          <p>
            {search.trim()
              ? 'Revise a busca ou consulte todas as clientes.'
              : 'Os atendimentos concluídos aparecerão aqui.'}
          </p>
        </div>
      )}

      {state.status === 'loaded' && visibleAppointments.length > 0 && (
        <ul className="record-list" aria-label="Histórico de atendimentos">
          {visibleAppointments.map((appointment) => {
            const services = [...(appointment.appointment_services ?? [])].sort(
              (first, second) => first.id - second.id,
            )
            return (
              <li className="record-card" key={appointment.id}>
                <div className="record-card__main">
                  <span className="record-card__date">
                    {formatDate(appointment.performed_on)}
                  </span>
                  <h3>{appointment.client?.name ?? 'Cliente indisponível'}</h3>
                  <ul className="record-card__services">
                    {services.map((service) => (
                      <li key={service.id}>{service.service_name}</li>
                    ))}
                  </ul>
                </div>
                <span className="booking-status booking-status--completed">
                  Realizado
                </span>
                {appointment.notes?.trim() && (
                  <p className="record-card__notes">
                    <strong>Observações:</strong> {appointment.notes}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
