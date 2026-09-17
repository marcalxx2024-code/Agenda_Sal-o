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
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(() =>
    `${window.location.search}${window.location.hash}`.includes('type=recovery'),
  )

  useEffect(() => {
    let isMounted = true

    function applySession(nextSession: Session | null) {
      setSession(nextSession)
      setAuthorizationStatus(nextSession ? 'loading' : 'idle')
      setAuthorizationError(null)
    }

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isMounted) return
        applySession(error ? null : data.session)
      })
      .catch(() => {
        if (isMounted) applySession(null)
      })
      .finally(() => {
        if (isMounted) setIsRestoringSession(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!isMounted) return
      if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true)
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

    void (async () => {
      try {
        const { data, error } = await supabase.rpc('has_salon_access')
        if (!isCurrent) return

        if (!error && typeof data === 'boolean') {
          setAuthorizationStatus(data ? 'authorized' : 'unauthorized')
          return
        }

        setAuthorizationStatus('error')
        setAuthorizationError(
          'Não foi possível verificar seu acesso. Tente novamente.',
        )
      } catch {
        if (!isCurrent) return
        setAuthorizationStatus('error')
        setAuthorizationError(
          'Não foi possível verificar seu acesso. Tente novamente.',
        )
      }
    })()

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
      isPasswordRecovery,
      retryAuthorization() {
        setAuthorizationStatus('loading')
        setAuthorizationError(null)
        setAuthorizationAttempt((attempt) => attempt + 1)
      },
      async signIn(email: string, password: string): Promise<AuthActionResult> {
        try {
          const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
          })

          return { error: error ? friendlyAuthError(error.message) : null }
        } catch {
          return {
            error: 'Não foi possível conectar ao serviço. Tente novamente.',
          }
        }
      },
      async requestPasswordReset(
        email: string,
        redirectTo: string,
      ): Promise<AuthActionResult> {
        try {
          const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo,
          })
          return {
            error: error
              ? 'Não foi possível enviar o link de recuperação. Verifique o e-mail e tente novamente.'
              : null,
          }
        } catch {
          return {
            error: 'Não foi possível conectar ao serviço. Tente novamente.',
          }
        }
      },
      async updatePassword(password: string): Promise<AuthActionResult> {
        try {
          const { error } = await supabase.auth.updateUser({ password })
          if (!error) setIsPasswordRecovery(false)
          return {
            error: error
              ? 'Não foi possível definir a nova senha. Solicite outro link e tente novamente.'
              : null,
          }
        } catch {
          return {
            error: 'Não foi possível conectar ao serviço. Tente novamente.',
          }
        }
      },
      async signOut(): Promise<AuthActionResult> {
        try {
          const { error } = await supabase.auth.signOut()

          return {
            error: error
              ? 'Não foi possível sair agora. Tente novamente.'
              : null,
          }
        } catch {
          return {
            error: 'Não foi possível conectar ao serviço. Tente novamente.',
          }
        }
      },
    }),
    [
      authorizationError,
      authorizationStatus,
      isPasswordRecovery,
      isRestoringSession,
      session,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
