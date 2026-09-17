import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  listPendingReturns,
  markReturnContacted,
  updateReturnStatus,
  type PendingReturn,
  type ReturnsDataError,
} from '../data/returns'

type ReturnsState =
  | { status: 'loading' }
  | { status: 'error'; error: ReturnsDataError | null }
  | { status: 'loaded'; returns: PendingReturn[] }

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function formatDate(value: string | null) {
  if (!value) return 'Data indisponível'
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isNaN(date.getTime())
    ? 'Data indisponível'
    : dateFormatter.format(date)
}

function dueTone(dueOn: string | null) {
  if (!dueOn) return { label: 'Sem data', tone: 'future' }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(`${dueOn}T00:00:00`)
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return { label: 'Atrasado', tone: 'overdue' }
  if (days <= 30) return { label: 'Próximo', tone: 'soon' }
  return { label: 'Futuro', tone: 'future' }
}

function friendlyActionError(error: ReturnsDataError) {
  if (error.code === 'P0002' || error.code === 'PGRST116') {
    return 'Este retorno não está mais pendente. A lista será atualizada.'
  }
  if (error.code === '42501' || error.code.startsWith('PGRST3')) {
    return 'Sua sessão não possui permissão para alterar retornos.'
  }
  return 'Não foi possível atualizar o retorno. Tente novamente.'
}

interface ReturnActionDialogProps {
  item: PendingReturn
  action: 'contact' | 'completed' | 'cancelled'
  onClose: () => void
  onSuccess: (message: string) => void
  onInvalidated: () => void
}

function ReturnActionDialog({
  item,
  action,
  onClose,
  onSuccess,
  onInvalidated,
}: ReturnActionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [note, setNote] = useState(item.contact_note ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isContact = action === 'contact'
  const title = isContact
    ? 'Registrar contato'
    : action === 'completed'
      ? 'Concluir retorno'
      : 'Cancelar retorno'

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting || item.id === null) return
    setIsSubmitting(true)
    setError(null)

    try {
      const result = isContact
        ? await markReturnContacted({
            p_return_id: item.id,
            ...(note.trim() ? { p_note: note.trim() } : {}),
          })
        : await updateReturnStatus(item.id, action)

      if (result.error) {
        const invalidated = ['P0002', 'PGRST116'].includes(result.error.code)
        if (invalidated) onInvalidated()
        setError(friendlyActionError(result.error))
        setIsSubmitting(false)
        return
      }

      onSuccess(
        isContact
          ? 'Contato registrado com sucesso.'
          : action === 'completed'
            ? 'Retorno concluído com sucesso.'
            : 'Retorno cancelado com sucesso.',
      )
    } catch {
      setError('Não foi possível conectar ao serviço. Tente novamente.')
      setIsSubmitting(false)
    }
  }

  return (
    <dialog
      className="client-dialog client-active-dialog"
      ref={dialogRef}
      aria-labelledby="return-action-title"
      onClose={onClose}
      onCancel={(event) => {
        if (isSubmitting) event.preventDefault()
      }}
    >
      <form className="client-form" onSubmit={handleSubmit}>
        <header className="client-dialog__header">
          <div>
            <span className="eyebrow">Acompanhamento</span>
            <h2 id="return-action-title">{title}</h2>
            <p>{item.client_name ?? 'Cliente indisponível'}</p>
          </div>
          <button
            className="client-dialog__close"
            type="button"
            aria-label={`Fechar ${title.toLocaleLowerCase('pt-BR')}`}
            onClick={() => !isSubmitting && dialogRef.current?.close()}
            disabled={isSubmitting}
          >
            ×
          </button>
        </header>

        <div className="client-active-dialog__body">
          <p>
            {isContact
              ? `Confirme que o contato sobre ${item.service_name ?? 'o serviço'} foi realmente realizado.`
              : `O retorno de ${item.service_name ?? 'serviço indisponível'} será marcado como ${action === 'completed' ? 'concluído' : 'cancelado'} e sairá da lista de pendências.`}
          </p>
          {isContact && (
            <div className="client-form__field">
              <label htmlFor="return-contact-note">
                Observação do contato <span>Opcional</span>
              </label>
              <textarea
                id="return-contact-note"
                rows={4}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={isSubmitting}
              />
            </div>
          )}
        </div>

        {error && (
          <p className="client-form__submit-error" role="alert">
            {error}
          </p>
        )}
        <footer className="client-form__actions">
          <button
            className="client-form__cancel"
            type="button"
            onClick={() => !isSubmitting && dialogRef.current?.close()}
            disabled={isSubmitting}
          >
            Voltar
          </button>
          <button
            className="primary-button client-form__submit"
            type="submit"
            disabled={isSubmitting || item.id === null}
          >
            {isSubmitting ? 'Salvando…' : title}
          </button>
        </footer>
      </form>
    </dialog>
  )
}

export function ReturnsPage() {
  const [state, setState] = useState<ReturnsState>({ status: 'loading' })
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [selected, setSelected] = useState<{
    item: PendingReturn
    action: ReturnActionDialogProps['action']
  } | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    let isCurrent = true
    void listPendingReturns()
      .then((result) => {
        if (!isCurrent) return
        setState(
          result.error
            ? { status: 'error', error: result.error }
            : { status: 'loaded', returns: result.data },
        )
      })
      .catch(() => {
        if (isCurrent) setState({ status: 'error', error: null })
      })
    return () => {
      isCurrent = false
    }
  }, [loadAttempt])

  const items = state.status === 'loaded' ? state.returns : []

  function reload() {
    setState({ status: 'loading' })
    setLoadAttempt((attempt) => attempt + 1)
  }

  return (
    <section className="returns-page records-page" aria-labelledby="returns-title">
      <header className="records-page__heading">
        <div>
          <span className="eyebrow">Acompanhamento</span>
          <h2 id="returns-title">Retornos pendentes</h2>
          <p>Organize os contatos previstos após cada atendimento.</p>
        </div>
        {state.status === 'loaded' && (
          <span className="agenda-result-count">
            {items.length} {items.length === 1 ? 'retorno' : 'retornos'}
          </span>
        )}
      </header>

      {success && (
        <p className="agenda-success" role="status">
          {success}
        </p>
      )}

      {state.status === 'loading' && (
        <div className="agenda-state" role="status">
          <span className="agenda-state__pulse" aria-hidden="true" />
          <h3>Carregando retornos…</h3>
          <p>Aguarde enquanto buscamos as pendências.</p>
        </div>
      )}
      {state.status === 'error' && (
        <div className="agenda-state" role="alert">
          <span className="eyebrow">Falha na consulta</span>
          <h3>Não foi possível carregar os retornos.</h3>
          <p>Verifique sua conexão e tente novamente.</p>
          <button
            className="primary-button agenda-state__button"
            type="button"
            onClick={reload}
          >
            Tentar novamente
          </button>
        </div>
      )}
      {state.status === 'loaded' && items.length === 0 && (
        <div className="agenda-state" role="status">
          <span className="eyebrow">Tudo em dia</span>
          <h3>Nenhum retorno pendente.</h3>
          <p>Novas previsões aparecerão após a conclusão dos atendimentos.</p>
        </div>
      )}
      {state.status === 'loaded' && items.length > 0 && (
        <ul className="return-list" aria-label="Retornos pendentes">
          {items.map((item) => {
            const timing = dueTone(item.due_on)
            return (
              <li
                className={`return-card return-card--${timing.tone}`}
                key={item.id}
              >
                <div className="return-card__heading">
                  <div>
                    <span className={`return-timing return-timing--${timing.tone}`}>
                      {timing.label}
                    </span>
                    <h3>{item.client_name ?? 'Cliente indisponível'}</h3>
                    {item.client_phone ? (
                      <a href={`tel:${item.client_phone}`}>{item.client_phone}</a>
                    ) : (
                      <span>Telefone indisponível</span>
                    )}
                  </div>
                  <span className="booking-status booking-status--scheduled">
                    Pendente
                  </span>
                </div>
                <dl className="return-card__details">
                  <div>
                    <dt>Serviço</dt>
                    <dd>{item.service_name ?? 'Indisponível'}</dd>
                  </div>
                  <div>
                    <dt>Retorno previsto</dt>
                    <dd>{formatDate(item.due_on)}</dd>
                  </div>
                  <div>
                    <dt>Último atendimento</dt>
                    <dd>{formatDate(item.performed_on)}</dd>
                  </div>
                  <div>
                    <dt>Contato</dt>
                    <dd>
                      {item.contacted_at
                        ? `Realizado em ${dateTimeFormatter.format(new Date(item.contacted_at))}`
                        : 'Ainda não registrado'}
                    </dd>
                  </div>
                </dl>
                {item.contact_note?.trim() && (
                  <p className="return-card__note">
                    <strong>Observação:</strong> {item.contact_note}
                  </p>
                )}
                <div className="return-card__actions">
                  <button
                    type="button"
                    onClick={() => setSelected({ item, action: 'contact' })}
                    disabled={item.contacted_at !== null}
                  >
                    {item.contacted_at
                      ? 'Contato registrado'
                      : 'Marcar como contatado'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected({ item, action: 'completed' })}
                  >
                    Concluir retorno
                  </button>
                  <button
                    className="return-card__cancel"
                    type="button"
                    onClick={() => setSelected({ item, action: 'cancelled' })}
                  >
                    Cancelar retorno
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {selected && (
        <ReturnActionDialog
          key={`${selected.item.id}-${selected.action}`}
          item={selected.item}
          action={selected.action}
          onClose={() => setSelected(null)}
          onInvalidated={reload}
          onSuccess={(message) => {
            setSelected(null)
            setSuccess(message)
            reload()
          }}
        />
      )}
    </section>
  )
}
