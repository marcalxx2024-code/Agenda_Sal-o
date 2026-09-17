import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { Link } from 'react-router-dom'
import {
  createClient,
  listClients,
  setClientActive,
  updateClient,
  type ClientFormInput,
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

interface ClientFormErrors {
  name?: string
  phone?: string
}

type ClientSubmissionState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | {
      status: 'error'
      kind: 'supabase' | 'unexpected'
      message: string
      cause: ClientsDataError | unknown
    }

type ClientFormMode =
  | { kind: 'create' }
  | { kind: 'edit'; client: ClientListItem }

interface ClientDialogProps {
  mode: ClientFormMode
  onClose: () => void
  onSaved: (client: ClientListItem) => void
}

function validateClientForm(
  name: string,
  phone: string,
  notes: string,
): { input: ClientFormInput | null; errors: ClientFormErrors } {
  const trimmedName = name.trim()
  const trimmedPhone = phone.trim()
  const trimmedNotes = notes.trim()
  const errors: ClientFormErrors = {}

  if (!trimmedName) {
    errors.name = 'Informe o nome do cliente.'
  } else if (trimmedName.length < 2) {
    errors.name = 'O nome deve ter pelo menos 2 caracteres.'
  } else if (trimmedName.length > 150) {
    errors.name = 'O nome deve ter no máximo 150 caracteres.'
  }

  if (!trimmedPhone) {
    errors.phone = 'Informe o telefone do cliente.'
  } else if (trimmedPhone.length < 8) {
    errors.phone = 'O telefone deve ter pelo menos 8 caracteres.'
  } else if (trimmedPhone.length > 30) {
    errors.phone = 'O telefone deve ter no máximo 30 caracteres.'
  }

  return {
    input:
      Object.keys(errors).length === 0
        ? {
            name: trimmedName,
            phone: trimmedPhone,
            notes: trimmedNotes || null,
          }
        : null,
    errors,
  }
}

function friendlySaveError(
  error: ClientsDataError,
  mode: ClientFormMode['kind'],
) {
  const databaseMessage = `${error.message} ${error.details ?? ''}`

  if (error.code === '23514') {
    if (databaseMessage.includes('clients_name_check')) {
      return 'Revise o nome: ele deve ter entre 2 e 150 caracteres.'
    }

    if (databaseMessage.includes('clients_phone_check')) {
      return 'Revise o telefone: ele deve ter entre 8 e 30 caracteres.'
    }

    return 'Revise os dados informados e tente novamente.'
  }

  if (error.code === '42501') {
    return mode === 'edit'
      ? 'Sua conta não possui permissão para editar clientes.'
      : 'Sua conta não possui permissão para cadastrar clientes.'
  }

  return mode === 'edit'
    ? 'Não foi possível salvar as alterações. Tente novamente.'
    : 'Não foi possível cadastrar o cliente. Tente novamente.'
}

function ClientDialog({ mode, onClose, onSaved }: ClientDialogProps) {
  const client = mode.kind === 'edit' ? mode.client : null
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(client?.name ?? '')
  const [phone, setPhone] = useState(client?.phone ?? '')
  const [notes, setNotes] = useState(client?.notes ?? '')
  const [formErrors, setFormErrors] = useState<ClientFormErrors>({})
  const [submission, setSubmission] = useState<ClientSubmissionState>({
    status: 'idle',
  })
  const isSubmitting = submission.status === 'submitting'

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

    const validation = validateClientForm(name, phone, notes)
    setFormErrors(validation.errors)
    setSubmission({ status: 'idle' })

    if (!validation.input) return

    setSubmission({ status: 'submitting' })

    try {
      const result = client
        ? await updateClient(client.id, validation.input)
        : await createClient(validation.input)

      if (result.error) {
        setSubmission({
          status: 'error',
          kind: 'supabase',
          message: friendlySaveError(result.error, mode.kind),
          cause: result.error,
        })
        return
      }

      onSaved(result.data)
    } catch (error) {
      setSubmission({
        status: 'error',
        kind: 'unexpected',
        message: 'Ocorreu uma falha inesperada. Tente novamente.',
        cause: error,
      })
    }
  }

  return (
    <dialog
      className="client-dialog"
      ref={dialogRef}
      aria-labelledby="client-form-title"
      onClose={onClose}
      onCancel={(event) => {
        if (isSubmitting) event.preventDefault()
      }}
    >
      <form className="client-form" onSubmit={handleSubmit} noValidate>
        <header className="client-dialog__header">
          <div>
            <span className="eyebrow">
              {client ? 'Editar cadastro' : 'Novo cadastro'}
            </span>
            <h2 id="client-form-title">
              {client ? 'Editar cliente' : 'Novo cliente'}
            </h2>
            <p>
              {client
                ? 'Atualize os dados principais deste cliente.'
                : 'Adicione os dados principais para iniciar o relacionamento.'}
            </p>
          </div>
          <button
            className="client-dialog__close"
            type="button"
            aria-label={client ? 'Fechar edição' : 'Fechar cadastro'}
            onClick={closeDialog}
            disabled={isSubmitting}
          >
            ×
          </button>
        </header>

        <div className="client-form__fields">
          <div className="client-form__field">
            <label htmlFor="client-name">Nome</label>
            <input
              id="client-name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              autoFocus
              required
              maxLength={150}
              disabled={isSubmitting}
              aria-invalid={Boolean(formErrors.name)}
              aria-describedby={formErrors.name ? 'client-name-error' : undefined}
            />
            {formErrors.name && (
              <p className="client-form__error" id="client-name-error" role="alert">
                {formErrors.name}
              </p>
            )}
          </div>

          <div className="client-form__field">
            <label htmlFor="client-phone">Telefone</label>
            <input
              id="client-phone"
              name="phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              autoComplete="tel"
              required
              maxLength={30}
              disabled={isSubmitting}
              aria-invalid={Boolean(formErrors.phone)}
              aria-describedby={formErrors.phone ? 'client-phone-error' : undefined}
            />
            {formErrors.phone && (
              <p
                className="client-form__error"
                id="client-phone-error"
                role="alert"
              >
                {formErrors.phone}
              </p>
            )}
          </div>

          <div className="client-form__field">
            <label htmlFor="client-notes">
              Observações <span>Opcional</span>
            </label>
            <textarea
              id="client-notes"
              name="notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              disabled={isSubmitting}
            />
          </div>
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
            Cancelar
          </button>
          <button
            className="primary-button client-form__submit"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting
              ? 'Salvando…'
              : client
                ? 'Salvar alterações'
                : 'Cadastrar cliente'}
          </button>
        </footer>
      </form>
    </dialog>
  )
}

type ClientActiveSubmissionState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | {
      status: 'error'
      kind: 'supabase' | 'unexpected'
      message: string
      cause: ClientsDataError | unknown
    }

interface ClientActiveDialogProps {
  client: ClientListItem
  onClose: () => void
  onUpdated: (client: ClientListItem) => void
}

function friendlyActiveError(error: ClientsDataError) {
  if (error.code === '42501') {
    return 'Sua conta não possui permissão para alterar o status de clientes.'
  }

  return 'Não foi possível alterar o status do cliente. Tente novamente.'
}

function ClientActiveDialog({
  client,
  onClose,
  onUpdated,
}: ClientActiveDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [submission, setSubmission] = useState<ClientActiveSubmissionState>({
    status: 'idle',
  })
  const isSubmitting = submission.status === 'submitting'
  const isReactivating = !client.active

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
      const result = await setClientActive(client.id, isReactivating)

      if (result.error) {
        setSubmission({
          status: 'error',
          kind: 'supabase',
          message: friendlyActiveError(result.error),
          cause: result.error,
        })
        return
      }

      onUpdated(result.data)
    } catch (error) {
      setSubmission({
        status: 'error',
        kind: 'unexpected',
        message: 'Ocorreu uma falha inesperada. Tente novamente.',
        cause: error,
      })
    }
  }

  return (
    <dialog
      className="client-dialog client-active-dialog"
      ref={dialogRef}
      aria-labelledby="client-active-title"
      aria-describedby="client-active-description"
      onClose={onClose}
      onCancel={(event) => {
        if (isSubmitting) event.preventDefault()
      }}
    >
      <form className="client-form" onSubmit={handleSubmit}>
        <header className="client-dialog__header">
          <div>
            <span className="eyebrow">Status do cliente</span>
            <h2 id="client-active-title">
              {isReactivating ? 'Reativar cliente?' : 'Inativar cliente?'}
            </h2>
            <p>{client.name}</p>
          </div>
          <button
            className="client-dialog__close"
            type="button"
            aria-label={
              isReactivating ? 'Fechar reativação' : 'Fechar inativação'
            }
            onClick={closeDialog}
            disabled={isSubmitting}
          >
            ×
          </button>
        </header>

        <div className="client-active-dialog__body">
          {isReactivating ? (
            <p id="client-active-description">
              O cliente voltará a aparecer com o status ativo.
            </p>
          ) : (
            <p id="client-active-description">
              O cliente ficará inativo, mas todo o histórico será preservado. Ele
              poderá ser reativado depois.
            </p>
          )}
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
            Cancelar
          </button>
          <button
            className="primary-button client-form__submit"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting
              ? 'Processando…'
              : isReactivating
                ? 'Reativar cliente'
                : 'Inativar cliente'}
          </button>
        </footer>
      </form>
    </dialog>
  )
}

export function ClientsPage() {
  const [loadState, setLoadState] = useState<ClientsLoadState>({
    status: 'loading',
  })
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [search, setSearch] = useState('')
  const [clientForm, setClientForm] = useState<ClientFormMode | null>(null)
  const [activeActionClient, setActiveActionClient] =
    useState<ClientListItem | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)

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

  function openCreateDialog() {
    setSaveSuccess(null)
    setClientForm({ kind: 'create' })
  }

  function openEditDialog(client: ClientListItem) {
    setSaveSuccess(null)
    setClientForm({ kind: 'edit', client })
  }

  function handleClientSaved(client: ClientListItem) {
    const action = clientForm?.kind

    setClientForm(null)
    setSearch('')
    setSaveSuccess(
      action === 'edit'
        ? `${client.name} foi atualizado com sucesso.`
        : `${client.name} foi cadastrado com sucesso.`,
    )
    setLoadState({ status: 'loading' })
    setLoadAttempt((attempt) => attempt + 1)
  }

  function openActiveDialog(client: ClientListItem) {
    setSaveSuccess(null)
    setActiveActionClient(client)
  }

  function handleClientActiveUpdated(client: ClientListItem) {
    setActiveActionClient(null)
    setSaveSuccess(
      `${client.name} foi ${client.active ? 'reativado' : 'inativado'} com sucesso.`,
    )
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
        <button
          className="clients-new-button"
          type="button"
          onClick={openCreateDialog}
        >
          Novo cliente
        </button>
      </header>

      {saveSuccess && (
        <p className="clients-success" role="status">
          {saveSuccess}
        </p>
      )}

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
            <span>Ações</span>
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
                  <div
                    className="client-row__actions"
                    role="group"
                    aria-label={`Ações para ${client.name}`}
                  >
                    <Link
                      className="client-row__action"
                      to={`/historico?cliente=${client.id}&nome=${encodeURIComponent(client.name)}`}
                      aria-label={`Ver histórico de ${client.name}`}
                    >
                      Histórico
                    </Link>
                    <button
                      className="client-row__action"
                      type="button"
                      aria-label={`Editar ${client.name}`}
                      onClick={() => openEditDialog(client)}
                    >
                      Editar
                    </button>
                    <button
                      className="client-row__action"
                      type="button"
                      aria-label={`${client.active ? 'Inativar' : 'Reativar'} ${client.name}`}
                      onClick={() => openActiveDialog(client)}
                    >
                      {client.active ? 'Inativar' : 'Reativar'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {clientForm && (
        <ClientDialog
          key={
            clientForm.kind === 'edit'
              ? `edit-${clientForm.client.id}`
              : 'create'
          }
          mode={clientForm}
          onClose={() => setClientForm(null)}
          onSaved={handleClientSaved}
        />
      )}

      {activeActionClient && (
        <ClientActiveDialog
          key={`${activeActionClient.id}-${activeActionClient.active}`}
          client={activeActionClient}
          onClose={() => setActiveActionClient(null)}
          onUpdated={handleClientActiveUpdated}
        />
      )}
    </section>
  )
}
