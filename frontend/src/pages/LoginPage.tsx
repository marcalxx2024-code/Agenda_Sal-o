import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

interface LoginLocationState {
  from?: {
    pathname?: string
  }
}

export function LoginPage() {
  const { requestPasswordReset, signIn } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isRecovering, setIsRecovering] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    const result = isRecovering
      ? await requestPasswordReset(
          email.trim(),
          `${window.location.origin}/reset-password`,
        )
      : await signIn(email.trim(), password)

    if (result.error) {
      setError(result.error)
      setIsSubmitting(false)
      return
    }

    if (isRecovering) {
      setSuccess('Se o e-mail estiver cadastrado, você receberá um link para definir uma nova senha.')
      setIsSubmitting(false)
      return
    }

    const state = location.state as LoginLocationState | null
    navigate(state?.from?.pathname ?? '/', { replace: true })
  }

  return (
    <main className="login-page">
      <section className="login-story" aria-label="Monica Lugo Alisamentos">
        <div className="login-story__content">
          <div className="login-brand">
            <span className="brand-mark brand-mark--light" aria-hidden="true">
              ML
            </span>
            <div>
              <strong>Monica Lugo</strong>
              <span>Alisamentos</span>
            </div>
          </div>
          <div className="login-story__message">
            <span className="eyebrow eyebrow--light">Cuidado em cada detalhe</span>
            <h1>Sua rotina do salão, mais leve e organizada.</h1>
            <p>
              Agendamentos, atendimentos e retornos reunidos em um só lugar.
            </p>
          </div>
          <p className="login-story__footer">Sistema interno do salão</p>
        </div>
        <div className="login-story__ornament" aria-hidden="true" />
      </section>

      <section className="login-panel">
        <div className="login-card">
          <div className="login-card__mobile-brand">
            <span className="brand-mark" aria-hidden="true">
              ML
            </span>
            <span>Monica Lugo Alisamentos</span>
          </div>

          <span className="eyebrow">Acesso reservado</span>
          <h2>{isRecovering ? 'Recuperar senha' : 'Bem-vinda de volta'}</h2>
          <p className="login-card__intro">
            {isRecovering
              ? 'Informe o e-mail da conta para receber o link de recuperação.'
              : 'Entre com a conta autorizada do salão para acessar a agenda.'}
          </p>

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor="email">E-mail</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="contato@monicalugo.com.br"
                required
                aria-describedby={error ? 'login-error' : undefined}
                aria-invalid={Boolean(error)}
                disabled={isSubmitting}
              />
            </div>

            {success && <p className="agenda-success" role="status">{success}</p>}

            {!isRecovering && (
              <div className="field">
              <label htmlFor="password">Senha</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Digite sua senha"
                required
                aria-describedby={error ? 'login-error' : undefined}
                aria-invalid={Boolean(error)}
                disabled={isSubmitting}
              />
              </div>
            )}

            {error && (
              <p className="form-error" id="login-error" role="alert">
                {error}
              </p>
            )}

            <button
              className="primary-button"
              type="submit"
              disabled={isSubmitting || !email.trim() || (!isRecovering && !password)}
            >
              {isSubmitting
                ? isRecovering ? 'Enviando…' : 'Entrando…'
                : isRecovering ? 'Enviar link de recuperação' : 'Entrar'}
            </button>
            <button
              className="login-link-button"
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                setIsRecovering((current) => !current)
                setError(null)
                setSuccess(null)
              }}
            >
              {isRecovering ? 'Voltar ao login' : 'Esqueci minha senha'}
            </button>
          </form>

          <p className="login-card__security">
            Acesso protegido pelo Supabase. Não há cadastro público.
          </p>
        </div>
      </section>
    </main>
  )
}
