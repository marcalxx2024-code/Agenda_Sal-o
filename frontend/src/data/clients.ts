import type { PostgrestError } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { supabase } from '../lib/supabase'

type ClientRow = Database['public']['Tables']['clients']['Row']

export type ClientListItem = Pick<
  ClientRow,
  'id' | 'name' | 'phone' | 'notes' | 'active'
>

export interface ClientFormInput {
  name: string
  phone: string
  notes?: string | null
}

export interface ClientsDataError {
  code: string
  message: string
  details: string | null
  hint: string | null
}

export type ListClientsResult =
  | { data: ClientListItem[]; error: null }
  | { data: null; error: ClientsDataError }

export type ClientMutationResult =
  | { data: ClientListItem; error: null }
  | { data: null; error: ClientsDataError }

function toClientsDataError(error: PostgrestError): ClientsDataError {
  return {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  }
}

export async function listClients(): Promise<ListClientsResult> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, phone, notes, active')
    .order('name', { ascending: true })
    .order('id', { ascending: true })

  if (error) {
    return { data: null, error: toClientsDataError(error) }
  }

  return { data, error: null }
}

export async function createClient(
  input: ClientFormInput,
): Promise<ClientMutationResult> {
  const notes = input.notes?.trim()
  const { data, error } = await supabase
    .from('clients')
    .insert({
      name: input.name.trim(),
      phone: input.phone.trim(),
      notes: notes || null,
    })
    .select('id, name, phone, notes, active')
    .single()

  if (error) {
    return { data: null, error: toClientsDataError(error) }
  }

  return { data, error: null }
}

export async function updateClient(
  id: ClientListItem['id'],
  input: ClientFormInput,
): Promise<ClientMutationResult> {
  const notes = input.notes?.trim()
  const { data, error } = await supabase
    .from('clients')
    .update({
      name: input.name.trim(),
      phone: input.phone.trim(),
      notes: notes || null,
    })
    .eq('id', id)
    .select('id, name, phone, notes, active')
    .single()

  if (error) {
    return { data: null, error: toClientsDataError(error) }
  }

  return { data, error: null }
}
