import { useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { SessionLoader } from './SessionLoader'

interface AccessMessageProps {
  kind: 'unauthorized' | 'error'
}

function AccessMessage({ kind }: AccessMessageProps) {
  const { authorizationError, retryAuthorization, session, signOut } = useAuth()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  async function handleSignOut() {
    setIsSigningOut(true)
    setSignOutError(null)
    const result = await signOut()
    setSignOutError(result.error)
    setIsSigningOut(false)
  }

  const isUnauthorized = kind === 'unauthorized'

  return (
    <main className="access-page">
      <section className="access-card" aria-labelledby="access-title">
        <div className="brand-mark" aria-hidden="true">
          ML
        </div>
        <span className="eyebrow">Acesso reservado</span>
        <h1 id="access-title">
          {isUnauthorized
            ? 'Acesso não autorizado'
            : 'Não foi possível verificar o acesso'}
        </h1>
        <p>
          {isUnauthorized
            ? 'Esta conta está autenticada, mas não possui acesso à área interna do salão.'
            : authorizationError}
        </p>
        {session?.user.email && (
          <small className="access-card__account">{session.user.email}</small>
        )}
        <div className="access-card__actions">
          {!isUnauthorized && (
            <button
              className="primary-button"
              type="button"
              onClick={retryAuthorization}
            >
              Tentar novamente
            </button>
          )}
          <button
            className="logout-button"
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
          >
            {isSigningOut ? 'Saindo…' : 'Sair da conta'}
          </button>
        </div>
        {signOutError && (
          <p className="form-error" role="alert">
            {signOutError}
          </p>
        )}
      </section>
    </main>
  )
}

export function ProtectedRoute() {
  const { authorizationStatus, session, isRestoringSession } = useAuth()
  const location = useLocation()

  if (isRestoringSession) {
    return <SessionLoader />
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (
    authorizationStatus === 'idle' ||
    authorizationStatus === 'loading'
  ) {
    return <SessionLoader />
  }

  if (authorizationStatus === 'unauthorized') {
    return <AccessMessage kind="unauthorized" />
  }

  if (authorizationStatus === 'error') {
    return <AccessMessage kind="error" />
  }

  return <Outlet />
}

export function PublicOnlyRoute() {
  const { session, isRestoringSession } = useAuth()

  if (isRestoringSession) {
    return <SessionLoader />
  }

  if (session) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
