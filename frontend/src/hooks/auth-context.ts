import { createContext } from 'react'
import type { Session } from '@supabase/supabase-js'

export interface AuthActionResult {
  error: string | null
}

export type AuthorizationStatus =
  | 'idle'
  | 'loading'
  | 'authorized'
  | 'unauthorized'
  | 'error'

export interface AuthContextValue {
  session: Session | null
  isRestoringSession: boolean
  authorizationStatus: AuthorizationStatus
  authorizationError: string | null
  isPasswordRecovery: boolean
  retryAuthorization: () => void
  signIn: (email: string, password: string) => Promise<AuthActionResult>
  requestPasswordReset: (email: string, redirectTo: string) => Promise<AuthActionResult>
  updatePassword: (password: string) => Promise<AuthActionResult>
  signOut: () => Promise<AuthActionResult>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)
