import { useEffect, useMemo, useState } from 'react'
import {
  listServices,
  type ServiceListItem,
  type ServicesDataError,
} from '../data/services'

type ServicesLoadState =
  | { status: 'loading' }
  | { status: 'error'; error: ServicesDataError | null }
  | { status: 'loaded'; services: ServiceListItem[] }

const emptyServices: ServiceListItem[] = []

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
}

function matchesSearch(service: ServiceListItem, query: string) {
  const normalizedQuery = normalizeText(query.trim())
  return !normalizedQuery || normalizeText(service.name).includes(normalizedQuery)
}

function servicesCountLabel(count: number) {
  return `${count} ${count === 1 ? 'serviço' : 'serviços'}`
}

function durationLabel(durationMinutes: number) {
  if (durationMinutes < 60) return `${durationMinutes} min`

  const hours = Math.floor(durationMinutes / 60)
  const minutes = durationMinutes % 60

  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`
}

function returnIntervalLabel(months: number) {
  return months === 1 ? 'Após 1 mês' : `Após ${months} meses`
}

export function ServicesPage() {
  const [loadState, setLoadState] = useState<ServicesLoadState>({
    status: 'loading',
  })
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let isCurrent = true

    void listServices()
      .then((result) => {
        if (!isCurrent) return

        if (result.error) {
          setLoadState({ status: 'error', error: result.error })
          return
        }

        setLoadState({ status: 'loaded', services: result.data })
      })
      .catch(() => {
        if (!isCurrent) return
        setLoadState({ status: 'error', error: null })
      })

    return () => {
      isCurrent = false
    }
  }, [loadAttempt])

  const services =
    loadState.status === 'loaded' ? loadState.services : emptyServices
  const visibleServices = useMemo(
    () => services.filter((service) => matchesSearch(service, search)),
    [search, services],
  )
  const hasSearch = search.trim().length > 0

  function retryLoading() {
    setLoadState({ status: 'loading' })
    setLoadAttempt((attempt) => attempt + 1)
  }

  return (
    <section className="services-page" aria-labelledby="services-title">
      <header className="services-page__heading">
        <div>
          <span className="eyebrow">Catálogo</span>
          <h2 id="services-title">Serviços</h2>
          <p>Consulte durações, retornos e disponibilidade dos procedimentos.</p>
        </div>
      </header>

      <div className="services-toolbar">
        <label htmlFor="services-search">Buscar serviços</label>
        <div className="services-search-row">
          <input
            id="services-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nome do serviço"
            autoComplete="off"
            disabled={loadState.status !== 'loaded' || services.length === 0}
          />
          <span className="services-result-count" aria-live="polite">
            {loadState.status === 'loaded' &&
              (hasSearch
                ? `${visibleServices.length} de ${servicesCountLabel(services.length)}`
                : servicesCountLabel(services.length))}
          </span>
        </div>
      </div>

      {loadState.status === 'loading' && (
        <div className="services-state" role="status" aria-live="polite">
          <span className="services-state__pulse" aria-hidden="true" />
          <h3>Carregando serviços…</h3>
          <p>Aguarde enquanto buscamos o catálogo do salão.</p>
        </div>
      )}

      {loadState.status === 'error' && (
        <div className="services-state" role="alert">
          <span className="eyebrow">Falha na consulta</span>
          <h3>Não foi possível carregar os serviços.</h3>
          <p>Verifique sua conexão e tente novamente.</p>
          <button
            className="primary-button services-state__button"
            type="button"
            onClick={retryLoading}
          >
            Tentar novamente
          </button>
        </div>
      )}

      {loadState.status === 'loaded' && services.length === 0 && (
        <div className="services-state" role="status">
          <span className="eyebrow">Catálogo de serviços</span>
          <h3>Nenhum serviço cadastrado.</h3>
          <p>Os serviços aparecerão aqui quando forem cadastrados.</p>
        </div>
      )}

      {loadState.status === 'loaded' &&
        services.length > 0 &&
        visibleServices.length === 0 && (
          <div className="services-state" role="status">
            <span className="eyebrow">Busca</span>
            <h3>Nenhum serviço encontrado.</h3>
            <p>Tente buscar por outro nome.</p>
            <button
              className="services-clear-search"
              type="button"
              onClick={() => setSearch('')}
            >
              Limpar busca
            </button>
          </div>
        )}

      {loadState.status === 'loaded' && visibleServices.length > 0 && (
        <div className="services-list" aria-label="Lista de serviços">
          <div className="services-list__header" aria-hidden="true">
            <span>Serviço</span>
            <span>Duração estimada</span>
            <span>Retorno sugerido</span>
            <span>Status</span>
          </div>
          <ul>
            {visibleServices.map((service) => (
              <li className="service-row" key={service.id}>
                <strong className="service-row__name">{service.name}</strong>
                <span
                  className={`service-detail${
                    service.estimated_duration_minutes === null
                      ? ' service-detail--missing'
                      : ''
                  }`}
                >
                  <span className="service-detail__label">Duração estimada</span>
                  {service.estimated_duration_minutes === null
                    ? 'Sem duração estimada'
                    : durationLabel(service.estimated_duration_minutes)}
                </span>
                <span
                  className={`service-detail${
                    service.suggested_return_months === null
                      ? ' service-detail--missing'
                      : ''
                  }`}
                >
                  <span className="service-detail__label">Retorno sugerido</span>
                  {service.suggested_return_months === null
                    ? 'Sem retorno configurado'
                    : returnIntervalLabel(service.suggested_return_months)}
                </span>
                <span
                  className={`service-status service-status--${
                    service.active ? 'active' : 'inactive'
                  }`}
                >
                  {service.active ? 'Ativo' : 'Inativo'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
