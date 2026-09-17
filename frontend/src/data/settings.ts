import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'

export type BusinessHour = Database['public']['Tables']['business_hours']['Row']
export type ScheduleBlock = Database['public']['Tables']['schedule_blocks']['Row']
export type BusinessHourUpdate = Pick<
  Database['public']['Tables']['business_hours']['Update'],
  'is_open' | 'opens_at' | 'closes_at' | 'break_starts_at' | 'break_ends_at'
>
export type ScheduleBlockInsert = Pick<
  Database['public']['Tables']['schedule_blocks']['Insert'],
  'starts_at' | 'ends_at' | 'reason'
>

export interface SettingsDataError {
  code: string
  message: string
  details: string | null
  hint: string | null
}

type Result<T> = { data: T; error: null } | { data: null; error: SettingsDataError }

function toError(error: PostgrestError): SettingsDataError {
  return {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  }
}

export async function listBusinessHours(): Promise<Result<BusinessHour[]>> {
  const { data, error } = await supabase
    .from('business_hours')
    .select('*')
    .order('weekday')
  return error ? { data: null, error: toError(error) } : { data, error: null }
}

export async function updateBusinessHour(
  weekday: number,
  values: BusinessHourUpdate,
): Promise<Result<BusinessHour>> {
  const { data, error } = await supabase
    .from('business_hours')
    .update(values)
    .eq('weekday', weekday)
    .select('*')
    .single()
  return error ? { data: null, error: toError(error) } : { data, error: null }
}

export async function listScheduleBlocks(): Promise<Result<ScheduleBlock[]>> {
  const { data, error } = await supabase
    .from('schedule_blocks')
    .select('*')
    .order('starts_at', { ascending: true })
    .limit(100)
  return error ? { data: null, error: toError(error) } : { data, error: null }
}

export async function createScheduleBlock(
  values: ScheduleBlockInsert,
): Promise<Result<ScheduleBlock>> {
  const { data, error } = await supabase
    .from('schedule_blocks')
    .insert(values)
    .select('*')
    .single()
  return error ? { data: null, error: toError(error) } : { data, error: null }
}

export async function deleteScheduleBlock(id: number): Promise<Result<number>> {
  const { data, error } = await supabase
    .from('schedule_blocks')
    .delete()
    .eq('id', id)
    .select('id')
    .single()
  return error ? { data: null, error: toError(error) } : { data: data.id, error: null }
}
