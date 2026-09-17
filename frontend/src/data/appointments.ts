import type { PostgrestError, QueryData } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

function appointmentsQuery() {
  return supabase
    .from('appointments')
    .select(`
      id,
      booking_id,
      performed_on,
      notes,
      client:clients!appointments_client_id_fkey (
        id,
        name
      ),
      appointment_services (
        id,
        service_id,
        service_name,
        return_due_on
      )
    `)
    .order('performed_on', { ascending: false })
    .order('id', { ascending: false })
}

type Appointments = QueryData<ReturnType<typeof appointmentsQuery>>

export type AppointmentListItem = Appointments[number]

export interface AppointmentsDataError {
  code: string
  message: string
  details: string | null
  hint: string | null
}

export type ListAppointmentsResult =
  | { data: AppointmentListItem[]; hasMore: boolean; error: null }
  | { data: null; error: AppointmentsDataError }

function toAppointmentsDataError(
  error: PostgrestError,
): AppointmentsDataError {
  return {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  }
}

export async function listAppointments(
  clientId?: number,
  offset = 0,
  pageSize = 30,
): Promise<ListAppointmentsResult> {
  let query = appointmentsQuery()

  if (clientId !== undefined) query = query.eq('client_id', clientId)

  const { data, error } = await query.range(offset, offset + pageSize - 1)

  if (error) {
    return { data: null, error: toAppointmentsDataError(error) }
  }

  return { data, hasMore: data.length === pageSize, error: null }
}
