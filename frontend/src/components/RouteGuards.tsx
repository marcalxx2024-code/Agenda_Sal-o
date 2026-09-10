import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { SessionLoader } from './SessionLoader'

export function ProtectedRoute() {
  const { session, isRestoringSession } = useAuth()
  const location = useLocation()

  if (isRestoringSession) {
    return <SessionLoader />
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
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
