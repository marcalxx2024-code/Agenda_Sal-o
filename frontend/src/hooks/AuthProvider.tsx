import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import {
  AuthContext,
  type AuthActionResult,
  type AuthContextValue,
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

  useEffect(() => {
    let isMounted = true

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) return

      if (error) {
        setSession(null)
      } else {
        setSession(data.session)
      }
      setIsRestoringSession(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) return
      setSession(nextSession)
      setIsRestoringSession(false)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isRestoringSession,
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
    [isRestoringSession, session],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
