import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { SessionLoader } from '../components/SessionLoader'

export function ResetPasswordPage() {
  const {
    isPasswordRecovery,
    isRestoringSession,
    session,
    signOut,
    updatePassword,
  } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isComplete, setIsComplete] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return
    setError(null)
    if (password.length < 8) {
      setError('A nova senha deve ter pelo menos 8 caracteres.')
      return
    }
    if (password !== confirmation) {
      setError('A confirmação não corresponde à nova senha.')
      return
    }
    setIsSubmitting(true)
    const result = await updatePassword(password)
    if (result.error) {
      setError(result.error)
      setIsSubmitting(false)
      return
    }
    await signOut()
    setIsComplete(true)
    setIsSubmitting(false)
  }

  if (isRestoringSession) return <SessionLoader />

  return (
    <main className="access-page">
      <section className="access-card reset-password-card" aria-labelledby="reset-title">
        <div className="brand-mark" aria-hidden="true">ML</div>
        <span className="eyebrow">Acesso reservado</span>
        <h1 id="reset-title">{isComplete ? 'Senha atualizada' : 'Definir nova senha'}</h1>
        {isComplete ? (
          <>
            <p role="status">Sua senha foi alterada. Entre novamente com a nova senha.</p>
            <Link className="primary-button reset-password-link" to="/login">Voltar ao login</Link>
          </>
        ) : !session || !isPasswordRecovery ? (
          <>
            <p>O link de recuperação é inválido ou expirou. Solicite um novo link na tela de login.</p>
            <Link className="primary-button reset-password-link" to="/login">Ir para o login</Link>
          </>
        ) : (
          <form className="login-form" onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="new-password">Nova senha</label>
              <input id="new-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} disabled={isSubmitting} required />
            </div>
            <div className="field">
              <label htmlFor="confirm-password">Confirmar nova senha</label>
              <input id="confirm-password" type="password" autoComplete="new-password" minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={isSubmitting} required />
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={isSubmitting || !password || !confirmation}>{isSubmitting ? 'Salvando…' : 'Salvar nova senha'}</button>
          </form>
        )}
      </section>
    </main>
  )
}
