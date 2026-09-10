import { createContext } from 'react'
import type { Session } from '@supabase/supabase-js'

export interface AuthActionResult {
  error: string | null
}

export interface AuthContextValue {
  session: Session | null
  isRestoringSession: boolean
  signIn: (email: string, password: string) => Promise<AuthActionResult>
  signOut: () => Promise<AuthActionResult>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)
