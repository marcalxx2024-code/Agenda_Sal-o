import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import {
  createService,
  listServices,
  setServiceActive,
  updateService,
  type ServiceFormInput,
  type ServiceListItem,
  type ServicesDataError,
} from '../data/services'

type ServicesLoadState =
  | { status: 'loading' }
  | { status: 'error'; error: ServicesDataError | null }
  | { status: 'loaded'; services: ServiceListItem[] }

const emptyServices: ServiceListItem[] = []

const smallintMaximum = 32_767

interface ServiceFormErrors {
  name?: string
  estimatedDurationMinutes?: string
  suggestedReturnMonths?: string
}

type ServiceSubmissionState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | {
      status: 'error'
      kind: 'supabase' | 'unexpected'
      message: string
      cause: ServicesDataError | unknown
    }

type ServiceFormMode =
  | { kind: 'create' }
  | { kind: 'edit'; service: ServiceListItem }

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

function parseOptionalInteger(
  value: string,
  fieldLabel: string,
  maximum: number,
): { value: number | null; error?: string } {
  const trimmedValue = value.trim()

  if (!trimmedValue) return { value: null }

  const parsedValue = Number(trimmedValue)

  if (!Number.isInteger(parsedValue)) {
    return { value: null, error: `${fieldLabel} deve ser um número inteiro.` }
  }

  if (parsedValue < 1 || parsedValue > maximum) {
    return {
      value: null,
      error: `${fieldLabel} deve estar entre 1 e ${maximum.toLocaleString('pt-BR')}.`,
    }
  }

  return { value: parsedValue }
}

function validateServiceForm(
  name: string,
  estimatedDurationMinutes: string,
  suggestedReturnMonths: string,
): { input: ServiceFormInput | null; errors: ServiceFormErrors } {
  const trimmedName = name.trim()
  const duration = parseOptionalInteger(
    estimatedDurationMinutes,
    'A duração estimada',
    smallintMaximum,
  )
  const returnInterval = parseOptionalInteger(
    suggestedReturnMonths,
    'O retorno sugerido',
    120,
  )
  const errors: ServiceFormErrors = {}

  if (!trimmedName) {
    errors.name = 'Informe o nome do serviço.'
  } else if (trimmedName.length < 2) {
    errors.name = 'O nome deve ter pelo menos 2 caracteres.'
  } else if (trimmedName.length > 120) {
    errors.name = 'O nome deve ter no máximo 120 caracteres.'
  }

  if (duration.error) {
    errors.estimatedDurationMinutes = duration.error
  }

  if (returnInterval.error) {
    errors.suggestedReturnMonths = returnInterval.error
  }

  return {
    input:
      Object.keys(errors).length === 0
        ? {
            name: trimmedName,
            estimated_duration_minutes: duration.value,
            suggested_return_months: returnInterval.value,
          }
        : null,
    errors,
  }
}

function friendlySaveError(
  error: ServicesDataError,
  mode: ServiceFormMode['kind'],
) {
  const databaseMessage = `${error.message} ${error.details ?? ''}`

  if (error.code === '23505') {
    return 'Já existe um serviço cadastrado com esse nome.'
  }

  if (error.code === '23514') {
    if (databaseMessage.includes('services_name_check')) {
      return 'Revise o nome: ele deve ter entre 2 e 120 caracteres.'
    }

    if (
      databaseMessage.includes('services_estimated_duration_minutes_positive')
    ) {
      return 'A duração estimada deve ser maior que zero.'
    }

    if (databaseMessage.includes('services_suggested_return_months_check')) {
      return 'O retorno sugerido deve estar entre 1 e 120 meses.'
    }

    return 'Revise os dados informados e tente novamente.'
  }

  if (error.code === '22003') {
    return 'A duração estimada informada é maior que o limite permitido.'
  }

  if (error.code === '42501') {
    return mode === 'edit'
      ? 'Sua conta não possui permissão para editar serviços.'
      : 'Sua conta não possui permissão para cadastrar serviços.'
  }

  if (error.code === 'PGRST116' && mode === 'edit') {
    return 'Não foi possível localizar o serviço ou sua conta não possui permissão para editá-lo.'
  }

  return mode === 'edit'
    ? 'Não foi possível salvar as alterações. Tente novamente.'
    : 'Não foi possível cadastrar o serviço. Tente novamente.'
}

interface ServiceDialogProps {
  mode: ServiceFormMode
  onClose: () => void
  onSaved: (service: ServiceListItem) => void
}

function ServiceDialog({ mode, onClose, onSaved }: ServiceDialogProps) {
  const service = mode.kind === 'edit' ? mode.service : null
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(service?.name ?? '')
  const [estimatedDurationMinutes, setEstimatedDurationMinutes] = useState(
    service?.estimated_duration_minutes?.toString() ?? '',
  )
  const [suggestedReturnMonths, setSuggestedReturnMonths] = useState(
    service?.suggested_return_months?.toString() ?? '',
  )
  const [formErrors, setFormErrors] = useState<ServiceFormErrors>({})
  const [submission, setSubmission] = useState<ServiceSubmissionState>({
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

    const validation = validateServiceForm(
      name,
      estimatedDurationMinutes,
      suggestedReturnMonths,
    )
    setFormErrors(validation.errors)
    setSubmission({ status: 'idle' })

    if (!validation.input) return

    setSubmission({ status: 'submitting' })

    try {
      const result = service
        ? await updateService(service.id, validation.input)
        : await createService(validation.input)

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
      aria-labelledby="service-form-title"
      onClose={onClose}
      onCancel={(event) => {
        if (isSubmitting) event.preventDefault()
      }}
    >
      <form className="client-form" onSubmit={handleSubmit} noValidate>
        <header className="client-dialog__header">
          <div>
            <span className="eyebrow">
              {service ? 'Editar procedimento' : 'Novo procedimento'}
            </span>
            <h2 id="service-form-title">
              {service ? 'Editar serviço' : 'Novo serviço'}
            </h2>
            <p>
              {service
                ? 'Atualize as informações usadas no catálogo e na agenda.'
                : 'Adicione as informações usadas no catálogo e na agenda.'}
            </p>
          </div>
          <button
            className="client-dialog__close"
            type="button"
            aria-label={service ? 'Fechar edição' : 'Fechar cadastro'}
            onClick={closeDialog}
            disabled={isSubmitting}
          >
            ×
          </button>
        </header>

        <div className="client-form__fields">
          <div className="client-form__field">
            <label htmlFor="service-name">Nome</label>
            <input
              id="service-name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
              autoFocus
              required
              maxLength={120}
              disabled={isSubmitting}
              aria-invalid={Boolean(formErrors.name)}
              aria-describedby={formErrors.name ? 'service-name-error' : undefined}
            />
            {formErrors.name && (
              <p
                className="client-form__error"
                id="service-name-error"
                role="alert"
              >
                {formErrors.name}
              </p>
            )}
          </div>

          <div className="client-form__field">
            <label htmlFor="service-duration">
              Duração estimada em minutos <span>Opcional</span>
            </label>
            <input
              id="service-duration"
              name="estimated_duration_minutes"
              type="number"
              inputMode="numeric"
              min={1}
              max={smallintMaximum}
              step={1}
              value={estimatedDurationMinutes}
              onChange={(event) => setEstimatedDurationMinutes(event.target.value)}
              disabled={isSubmitting}
              aria-invalid={Boolean(formErrors.estimatedDurationMinutes)}
              aria-describedby={
                formErrors.estimatedDurationMinutes
                  ? 'service-duration-help service-duration-error'
                  : 'service-duration-help'
              }
            />
            <small id="service-duration-help" className="client-form__help">
              Necessária para calcular automaticamente o horário na agenda.
            </small>
            {formErrors.estimatedDurationMinutes && (
              <p
                className="client-form__error"
                id="service-duration-error"
                role="alert"
              >
                {formErrors.estimatedDurationMinutes}
              </p>
            )}
          </div>

          <div className="client-form__field">
            <label htmlFor="service-return-months">
              Retorno sugerido em meses <span>Opcional</span>
            </label>
            <input
              id="service-return-months"
              name="suggested_return_months"
              type="number"
              inputMode="numeric"
              min={1}
              max={120}
              step={1}
              value={suggestedReturnMonths}
              onChange={(event) => setSuggestedReturnMonths(event.target.value)}
              disabled={isSubmitting}
              aria-invalid={Boolean(formErrors.suggestedReturnMonths)}
              aria-describedby={
                formErrors.suggestedReturnMonths
                  ? 'service-return-months-error'
                  : undefined
              }
            />
            {formErrors.suggestedReturnMonths && (
              <p
                className="client-form__error"
                id="service-return-months-error"
                role="alert"
              >
                {formErrors.suggestedReturnMonths}
              </p>
            )}
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
              : service
                ? 'Salvar alterações'
                : 'Cadastrar serviço'}
          </button>
        </footer>
      </form>
    </dialog>
  )
}

type ServiceActiveSubmissionState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | {
      status: 'error'
      kind: 'supabase' | 'unexpected'
      message: string
      cause: ServicesDataError | unknown
    }

interface ServiceActiveDialogProps {
  service: ServiceListItem
  onClose: () => void
  onUpdated: (service: ServiceListItem) => void
}

function friendlyActiveError(error: ServicesDataError) {
  if (error.code === '42501') {
    return 'Sua conta não possui permissão para alterar o status de serviços.'
  }

  if (error.code === 'PGRST116') {
    return 'Não foi possível localizar o serviço ou sua conta não possui permissão para alterá-lo.'
  }

  return 'Não foi possível alterar o status do serviço. Tente novamente.'
}

function ServiceActiveDialog({
  service,
  onClose,
  onUpdated,
}: ServiceActiveDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [submission, setSubmission] = useState<ServiceActiveSubmissionState>({
    status: 'idle',
  })
  const isSubmitting = submission.status === 'submitting'
  const isReactivating = !service.active

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
      const result = await setServiceActive(service.id, isReactivating)

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
      aria-labelledby="service-active-title"
      aria-describedby="service-active-description"
      onClose={onClose}
      onCancel={(event) => {
        if (isSubmitting) event.preventDefault()
      }}
    >
      <form className="client-form" onSubmit={handleSubmit}>
        <header className="client-dialog__header">
          <div>
            <span className="eyebrow">Status do serviço</span>
            <h2 id="service-active-title">
              {isReactivating ? 'Reativar serviço?' : 'Inativar serviço?'}
            </h2>
            <p>{service.name}</p>
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
            <p id="service-active-description">
              O serviço voltará a ficar disponível para novos agendamentos e
              atendimentos.
            </p>
          ) : (
            <p id="service-active-description">
              O serviço não poderá ser usado em novos agendamentos ou
              atendimentos avulsos. O histórico e os planos já existentes serão
              preservados.
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
                ? 'Reativar serviço'
                : 'Inativar serviço'}
          </button>
        </footer>
      </form>
    </dialog>
  )
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
  const [serviceForm, setServiceForm] = useState<ServiceFormMode | null>(null)
  const [activeActionService, setActiveActionService] =
    useState<ServiceListItem | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)

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

  useEffect(() => {
    if (!saveSuccess) return
    const timeoutId = window.setTimeout(() => setSaveSuccess(null), 5_000)
    return () => window.clearTimeout(timeoutId)
  }, [saveSuccess])

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

  function openCreateDialog() {
    setSaveSuccess(null)
    setServiceForm({ kind: 'create' })
  }

  function openEditDialog(service: ServiceListItem) {
    setSaveSuccess(null)
    setServiceForm({ kind: 'edit', service })
  }

  function handleServiceSaved(service: ServiceListItem) {
    const action = serviceForm?.kind

    setServiceForm(null)
    setSearch('')
    setSaveSuccess(
      action === 'edit'
        ? `${service.name} foi atualizado com sucesso.`
        : `${service.name} foi cadastrado com sucesso.`,
    )
    setLoadState({ status: 'loading' })
    setLoadAttempt((attempt) => attempt + 1)
  }

  function openActiveDialog(service: ServiceListItem) {
    setSaveSuccess(null)
    setActiveActionService(service)
  }

  function handleServiceActiveUpdated(service: ServiceListItem) {
    setActiveActionService(null)
    setSaveSuccess(
      `${service.name} foi ${service.active ? 'reativado' : 'inativado'} com sucesso.`,
    )
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
        <button
          className="services-new-button"
          type="button"
          onClick={openCreateDialog}
        >
          Novo serviço
        </button>
      </header>

      {saveSuccess && (
        <p className="services-success" role="status">
          {saveSuccess}
        </p>
      )}

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
          <h3>Nenhum serviço cadastrado ainda.</h3>
          <p>Adicione o primeiro serviço para disponibilizá-lo na agenda.</p>
          <button
            className="primary-button services-state__button"
            type="button"
            onClick={openCreateDialog}
          >
            Adicionar serviço
          </button>
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
            <span>Ações</span>
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
                <div
                  className="service-row__actions"
                  role="group"
                  aria-label={`Ações para ${service.name}`}
                >
                  <button
                    className="service-row__action"
                    type="button"
                    aria-label={`Editar ${service.name}`}
                    onClick={() => openEditDialog(service)}
                  >
                    Editar
                  </button>
                  <button
                    className="service-row__action"
                    type="button"
                    aria-label={`${service.active ? 'Inativar' : 'Reativar'} ${service.name}`}
                    onClick={() => openActiveDialog(service)}
                  >
                    {service.active ? 'Inativar' : 'Reativar'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {serviceForm && (
        <ServiceDialog
          key={
            serviceForm.kind === 'edit'
              ? `edit-${serviceForm.service.id}`
              : 'create'
          }
          mode={serviceForm}
          onClose={() => setServiceForm(null)}
          onSaved={handleServiceSaved}
        />
      )}

      {activeActionService && (
        <ServiceActiveDialog
          key={`${activeActionService.id}-${activeActionService.active}`}
          service={activeActionService}
          onClose={() => setActiveActionService(null)}
          onUpdated={handleServiceActiveUpdated}
        />
      )}
    </section>
  )
}
