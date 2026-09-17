import type { PostgrestError } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { supabase } from '../lib/supabase'

type PendingReturnRow = Database['public']['Views']['pending_returns']['Row']
type MarkReturnContactedArgs =
  Database['public']['Functions']['mark_return_contacted']['Args']
type MarkReturnContactedRow =
  Database['public']['Functions']['mark_return_contacted']['Returns'][number]

export type PendingReturn = PendingReturnRow
export type ReturnStatus = 'pending' | 'completed' | 'cancelled'

export interface ReturnsDataError {
  code: string
  message: string
  details: string | null
  hint: string | null
}

export type ListPendingReturnsResult =
  | { data: PendingReturn[]; error: null }
  | { data: null; error: ReturnsDataError }

export type MarkReturnContactedResult =
  | { data: MarkReturnContactedRow; error: null }
  | { data: null; error: ReturnsDataError }

export type UpdateReturnStatusResult =
  | { data: { id: number; status: string }; error: null }
  | { data: null; error: ReturnsDataError }

function toReturnsDataError(error: PostgrestError): ReturnsDataError {
  return {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  }
}

export async function listPendingReturns(): Promise<ListPendingReturnsResult> {
  const { data, error } = await supabase
    .from('pending_returns')
    .select(
      'id, due_on, contacted_at, contact_note, performed_on, client_id, client_name, client_phone, service_name, return_interval_months',
    )
    .order('due_on', { ascending: true })
    .order('id', { ascending: true })
    .limit(200)

  if (error) {
    return { data: null, error: toReturnsDataError(error) }
  }

  return { data, error: null }
}

export async function markReturnContacted(
  input: MarkReturnContactedArgs,
): Promise<MarkReturnContactedResult> {
  const { data, error } = await supabase
    .rpc('mark_return_contacted', input)
    .single()

  if (error) {
    return { data: null, error: toReturnsDataError(error) }
  }

  return { data, error: null }
}

export async function updateReturnStatus(
  returnId: number,
  status: Exclude<ReturnStatus, 'pending'>,
): Promise<UpdateReturnStatusResult> {
  const { data, error } = await supabase
    .from('returns')
    .update({ status })
    .eq('id', returnId)
    .eq('status', 'pending')
    .select('id, status')
    .single()

  if (error) {
    return { data: null, error: toReturnsDataError(error) }
  }

  return { data, error: null }
}
