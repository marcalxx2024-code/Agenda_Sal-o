import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'

export type BusinessHour = Database['public']['Tables']['business_hours']['Row']
export type ScheduleBlock = Database['public']['Tables']['schedule_blocks']['Row']
export type ScheduleBlockInsert = Pick<
  Database['public']['Tables']['schedule_blocks']['Insert'],
  'starts_at' | 'ends_at' | 'reason'
>
export type BusinessHoursWeekInput = Array<
  Pick<
    BusinessHour,
    | 'weekday'
    | 'is_open'
    | 'opens_at'
    | 'closes_at'
    | 'break_starts_at'
    | 'break_ends_at'
  >
>

export interface AffectedBooking {
  id: number
  client_id: number
  client_name: string
  starts_at: string
  ends_at: string
  status: string
}

export interface BusinessHoursWeekResult {
  updated: boolean
  requiresConfirmation: boolean
  conflictsChanged: boolean
  affectedBookingCount: number
  affectedBookingIds: number[]
  affectedBookings: AffectedBooking[]
}

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

function parseAffectedBookings(value: unknown): AffectedBooking[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const booking = item as Record<string, unknown>
    if (
      typeof booking.id !== 'number' ||
      typeof booking.client_id !== 'number' ||
      typeof booking.client_name !== 'string' ||
      typeof booking.starts_at !== 'string' ||
      typeof booking.ends_at !== 'string' ||
      typeof booking.status !== 'string'
    ) {
      return []
    }

    return [
      {
        id: booking.id,
        client_id: booking.client_id,
        client_name: booking.client_name,
        starts_at: booking.starts_at,
        ends_at: booking.ends_at,
        status: booking.status,
      },
    ]
  })
}

export async function updateBusinessHoursWeek(
  hours: BusinessHoursWeekInput,
  confirmConflicts = false,
  expectedAffectedBookingIds: number[] | null = null,
): Promise<Result<BusinessHoursWeekResult>> {
  const { data, error } = await supabase
    .rpc('update_business_hours_week', {
      p_hours: hours,
      p_confirm_conflicts: confirmConflicts,
      p_expected_affected_booking_ids: expectedAffectedBookingIds,
    })
    .single()

  if (error) return { data: null, error: toError(error) }

  return {
    data: {
      updated: data.updated,
      requiresConfirmation: data.requires_confirmation,
      conflictsChanged: data.conflicts_changed,
      affectedBookingCount: data.affected_booking_count,
      affectedBookingIds: data.affected_booking_ids,
      affectedBookings: parseAffectedBookings(data.affected_bookings),
    },
    error: null,
  }
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
