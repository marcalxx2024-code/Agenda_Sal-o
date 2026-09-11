import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import {
  AuthContext,
  type AuthActionResult,
  type AuthContextValue,
  type AuthorizationStatus,
} from './auth-context'

interface AuthProviderProps {
  children: ReactNode
}

function friendlyAuthError(message: string): string {
  if (message.toLowerCase().includes('invalid login credentials')) {
    return 'E-mail ou senha inválidos.'
  }

  if (message.toLowerCase().includes('email not confirmed')) {
    return 'Este e-mail ainda não foi confirmado.'
  }

  return 'Não foi possível entrar. Verifique os dados e tente novamente.'
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [isRestoringSession, setIsRestoringSession] = useState(true)
  const [authorizationStatus, setAuthorizationStatus] =
    useState<AuthorizationStatus>('idle')
  const [authorizationError, setAuthorizationError] = useState<string | null>(
    null,
  )
  const [authorizationAttempt, setAuthorizationAttempt] = useState(0)

  useEffect(() => {
    let isMounted = true

    function applySession(nextSession: Session | null) {
      setSession(nextSession)
      setAuthorizationStatus(nextSession ? 'loading' : 'idle')
      setAuthorizationError(null)
    }

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) return

      if (error) {
        applySession(null)
      } else {
        applySession(data.session)
      }
      setIsRestoringSession(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) return
      applySession(nextSession)
      setIsRestoringSession(false)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (isRestoringSession || !session) return

    let isCurrent = true

    void supabase
      .rpc('has_salon_access')
      .then(({ data, error }) => {
        if (!isCurrent) return

        if (!error && typeof data === 'boolean') {
          setAuthorizationStatus(data ? 'authorized' : 'unauthorized')
          return
        }

        setAuthorizationStatus('error')
        setAuthorizationError(
          'Não foi possível verificar seu acesso. Tente novamente.',
        )
      })

    return () => {
      isCurrent = false
    }
  }, [authorizationAttempt, isRestoringSession, session])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isRestoringSession,
      authorizationStatus,
      authorizationError,
      retryAuthorization() {
        setAuthorizationStatus('loading')
        setAuthorizationError(null)
        setAuthorizationAttempt((attempt) => attempt + 1)
      },
      async signIn(email: string, password: string): Promise<AuthActionResult> {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        return { error: error ? friendlyAuthError(error.message) : null }
      },
      async signOut(): Promise<AuthActionResult> {
        const { error } = await supabase.auth.signOut()

        return {
          error: error
            ? 'Não foi possível sair agora. Tente novamente.'
            : null,
        }
      },
    }),
    [authorizationError, authorizationStatus, isRestoringSession, session],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
