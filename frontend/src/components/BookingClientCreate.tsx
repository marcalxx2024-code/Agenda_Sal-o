import { useState, type KeyboardEvent } from 'react'
import {
  createClient,
  type ClientListItem,
} from '../data/clients'
import {
  friendlyClientSaveError,
  validateClientForm,
  type ClientFormErrors,
} from '../lib/client-validation'

interface BookingClientCreateProps {
  initialQuery: string
  onCancel: () => void
  onBusyChange: (isBusy: boolean) => void
  onCreated: (client: ClientListItem) => void
}

export function BookingClientCreate({
  initialQuery,
  onCancel,
  onBusyChange,
  onCreated,
}: BookingClientCreateProps) {
  const queryHasLetters = /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(initialQuery)
  const [name, setName] = useState(queryHasLetters ? initialQuery.trim() : '')
  const [phone, setPhone] = useState(queryHasLetters ? '' : initialQuery.trim())
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<ClientFormErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function saveClient() {
    if (isSubmitting) return

    const validation = validateClientForm(name, phone, notes)
    setErrors(validation.errors)
    setSubmitError(null)
    if (!validation.input) return

    setIsSubmitting(true)
    onBusyChange(true)

    try {
      const result = await createClient(validation.input)

      if (result.error) {
        setSubmitError(friendlyClientSaveError(result.error, 'create'))
        setIsSubmitting(false)
        onBusyChange(false)
        return
      }

      onCreated(result.data)
    } catch {
      setSubmitError('Não foi possível conectar ao serviço. Tente novamente.')
      setIsSubmitting(false)
      onBusyChange(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFieldSetElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    void saveClient()
  }

  return (
    <fieldset
      className="booking-client-create"
      disabled={isSubmitting}
      onKeyDown={handleKeyDown}
      aria-labelledby="booking-client-create-title"
    >
      <legend id="booking-client-create-title">Cadastrar nova cliente</legend>
      <p>O cadastro será salvo e selecionado neste agendamento.</p>

      <div className="booking-client-create__grid">
        <div className="client-form__field">
          <label htmlFor="booking-new-client-name">Nome</label>
          <input
            id="booking-new-client-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            autoFocus
            maxLength={150}
            required
            aria-invalid={Boolean(errors.name)}
            aria-describedby={
              errors.name ? 'booking-new-client-name-error' : undefined
            }
          />
          {errors.name && (
            <p
              className="client-form__error"
              id="booking-new-client-name-error"
              role="alert"
            >
              {errors.name}
            </p>
          )}
        </div>

        <div className="client-form__field">
          <label htmlFor="booking-new-client-phone">Telefone</label>
          <input
            id="booking-new-client-phone"
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            autoComplete="tel"
            maxLength={30}
            required
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={
              errors.phone ? 'booking-new-client-phone-error' : undefined
            }
          />
          {errors.phone && (
            <p
              className="client-form__error"
              id="booking-new-client-phone-error"
              role="alert"
            >
              {errors.phone}
            </p>
          )}
        </div>
      </div>

      <div className="client-form__field">
        <label htmlFor="booking-new-client-notes">
          Observações <span>Opcional</span>
        </label>
        <textarea
          id="booking-new-client-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
        />
      </div>

      {submitError && (
        <p className="client-form__submit-error" role="alert">
          {submitError}
        </p>
      )}

      <div className="booking-client-create__actions">
        <button type="button" onClick={onCancel} disabled={isSubmitting}>
          Voltar para a seleção
        </button>
        <button
          className="primary-button"
          type="button"
          onClick={() => void saveClient()}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Cadastrando…' : 'Cadastrar e selecionar'}
        </button>
      </div>
    </fieldset>
  )
}
