import { useEffect, useMemo, useState } from 'react'
import {
  listClients,
  type ClientListItem,
  type ClientsDataError,
} from '../data/clients'

type ClientsLoadState =
  | { status: 'loading' }
  | { status: 'error'; error: ClientsDataError | null }
  | { status: 'loaded'; clients: ClientListItem[] }

const emptyClients: ClientListItem[] = []

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
}

function matchesSearch(client: ClientListItem, query: string) {
  const normalizedQuery = normalizeText(query.trim())

  if (!normalizedQuery) return true

  const queryDigits = query.replace(/\D/g, '')
  const phoneDigits = client.phone.replace(/\D/g, '')

  return (
    normalizeText(client.name).includes(normalizedQuery) ||
    normalizeText(client.phone).includes(normalizedQuery) ||
    (queryDigits.length > 0 && phoneDigits.includes(queryDigits))
  )
}

function clientsCountLabel(count: number) {
  return `${count} ${count === 1 ? 'cliente' : 'clientes'}`
}

export function ClientsPage() {
  const [loadState, setLoadState] = useState<ClientsLoadState>({
    status: 'loading',
  })
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let isCurrent = true

    void listClients()
      .then((result) => {
        if (!isCurrent) return

        if (result.error) {
          setLoadState({ status: 'error', error: result.error })
          return
        }

        setLoadState({ status: 'loaded', clients: result.data })
      })
      .catch(() => {
        if (!isCurrent) return
        setLoadState({ status: 'error', error: null })
      })

    return () => {
      isCurrent = false
    }
  }, [loadAttempt])

  const clients =
    loadState.status === 'loaded' ? loadState.clients : emptyClients
  const visibleClients = useMemo(
    () => clients.filter((client) => matchesSearch(client, search)),
    [clients, search],
  )
  const hasSearch = search.trim().length > 0

  function retryLoading() {
    setLoadState({ status: 'loading' })
    setLoadAttempt((attempt) => attempt + 1)
  }

  return (
    <section className="clients-page" aria-labelledby="clients-title">
      <header className="clients-page__heading">
        <div>
          <span className="eyebrow">Relacionamento</span>
          <h2 id="clients-title">Clientes</h2>
          <p>Consulte contatos e informações da base do salão.</p>
        </div>
      </header>

      <div className="clients-toolbar">
        <label htmlFor="clients-search">Buscar clientes</label>
        <div className="clients-search-row">
          <input
            id="clients-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nome ou telefone"
            autoComplete="off"
            disabled={loadState.status !== 'loaded' || clients.length === 0}
          />
          <span className="clients-result-count" aria-live="polite">
            {loadState.status === 'loaded' &&
              (hasSearch
                ? `${visibleClients.length} de ${clientsCountLabel(clients.length)}`
                : clientsCountLabel(clients.length))}
          </span>
        </div>
      </div>

      {loadState.status === 'loading' && (
        <div className="clients-state" role="status" aria-live="polite">
          <span className="clients-state__pulse" aria-hidden="true" />
          <h3>Carregando clientes…</h3>
          <p>Aguarde enquanto buscamos a base do salão.</p>
        </div>
      )}

      {loadState.status === 'error' && (
        <div className="clients-state" role="alert">
          <span className="eyebrow">Falha na consulta</span>
          <h3>Não foi possível carregar os clientes.</h3>
          <p>Verifique sua conexão e tente novamente.</p>
          <button
            className="primary-button clients-state__button"
            type="button"
            onClick={retryLoading}
          >
            Tentar novamente
          </button>
        </div>
      )}

      {loadState.status === 'loaded' && clients.length === 0 && (
        <div className="clients-state" role="status">
          <span className="eyebrow">Base de clientes</span>
          <h3>Nenhum cliente cadastrado.</h3>
          <p>Os clientes aparecerão aqui quando o cadastro estiver disponível.</p>
        </div>
      )}

      {loadState.status === 'loaded' &&
        clients.length > 0 &&
        visibleClients.length === 0 && (
          <div className="clients-state" role="status">
            <span className="eyebrow">Busca</span>
            <h3>Nenhum cliente encontrado.</h3>
            <p>Tente outro nome ou telefone.</p>
            <button
              className="clients-clear-search"
              type="button"
              onClick={() => setSearch('')}
            >
              Limpar busca
            </button>
          </div>
        )}

      {loadState.status === 'loaded' && visibleClients.length > 0 && (
        <div className="clients-list" aria-label="Lista de clientes">
          <div className="clients-list__header" aria-hidden="true">
            <span>Cliente</span>
            <span>Telefone</span>
            <span>Status</span>
          </div>
          <ul>
            {visibleClients.map((client) => {
              const notes = client.notes?.trim()

              return (
                <li className="client-row" key={client.id}>
                  <div className="client-row__identity">
                    <strong>{client.name}</strong>
                    {notes && <p>{notes}</p>}
                  </div>
                  <span className="client-row__phone">{client.phone}</span>
                  <span
                    className={`client-status client-status--${
                      client.active ? 'active' : 'inactive'
                    }`}
                  >
                    {client.active ? 'Ativo' : 'Inativo'}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
