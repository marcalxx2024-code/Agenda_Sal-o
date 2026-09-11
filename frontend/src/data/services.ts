import type { PostgrestError } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { supabase } from '../lib/supabase'

type ServiceRow = Database['public']['Tables']['services']['Row']

export type ServiceListItem = Pick<
  ServiceRow,
  | 'id'
  | 'name'
  | 'estimated_duration_minutes'
  | 'suggested_return_months'
  | 'active'
>

export interface ServicesDataError {
  code: string
  message: string
  details: string | null
  hint: string | null
}

export type ListServicesResult =
  | { data: ServiceListItem[]; error: null }
  | { data: null; error: ServicesDataError }

function toServicesDataError(error: PostgrestError): ServicesDataError {
  return {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  }
}

export async function listServices(): Promise<ListServicesResult> {
  const { data, error } = await supabase
    .from('services')
    .select(
      'id, name, estimated_duration_minutes, suggested_return_months, active',
    )
    .order('name', { ascending: true })
    .order('id', { ascending: true })

  if (error) {
    return { data: null, error: toServicesDataError(error) }
  }

  return { data, error: null }
}
