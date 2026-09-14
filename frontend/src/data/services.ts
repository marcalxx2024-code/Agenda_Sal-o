import type { PostgrestError } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { supabase } from '../lib/supabase'

type ServiceRow = Database['public']['Tables']['services']['Row']
type ServiceInsert = Database['public']['Tables']['services']['Insert']

export type ServiceListItem = Pick<
  ServiceRow,
  | 'id'
  | 'name'
  | 'estimated_duration_minutes'
  | 'suggested_return_months'
  | 'active'
>

export type ServiceFormInput = Pick<
  ServiceInsert,
  'name' | 'estimated_duration_minutes' | 'suggested_return_months'
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

export type ServiceMutationResult =
  | { data: ServiceListItem; error: null }
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

export async function createService(
  input: ServiceFormInput,
): Promise<ServiceMutationResult> {
  const { data, error } = await supabase
    .from('services')
    .insert({
      name: input.name.trim(),
      estimated_duration_minutes: input.estimated_duration_minutes ?? null,
      suggested_return_months: input.suggested_return_months ?? null,
    })
    .select(
      'id, name, estimated_duration_minutes, suggested_return_months, active',
    )
    .single()

  if (error) {
    return { data: null, error: toServicesDataError(error) }
  }

  return { data, error: null }
}

export async function updateService(
  id: ServiceListItem['id'],
  input: ServiceFormInput,
): Promise<ServiceMutationResult> {
  const { data, error } = await supabase
    .from('services')
    .update({
      name: input.name.trim(),
      estimated_duration_minutes: input.estimated_duration_minutes ?? null,
      suggested_return_months: input.suggested_return_months ?? null,
    })
    .eq('id', id)
    .select(
      'id, name, estimated_duration_minutes, suggested_return_months, active',
    )
    .single()

  if (error) {
    return { data: null, error: toServicesDataError(error) }
  }

  return { data, error: null }
}
