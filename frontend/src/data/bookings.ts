import type { PostgrestError, QueryData } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

function agendaBookingsQuery() {
  return supabase
    .from('bookings')
    .select(`
      id,
      starts_at,
      ends_at,
      status,
      notes,
      client:clients!bookings_client_id_fkey (
        id,
        name
      ),
      booking_services (
        id,
        service_name
      )
    `)
    .order('starts_at', { ascending: true })
    .order('id', { ascending: true })
}

type AgendaBookings = QueryData<ReturnType<typeof agendaBookingsQuery>>

export type AgendaBookingListItem = AgendaBookings[number]

export interface BookingsDataError {
  code: string
  message: string
  details: string | null
  hint: string | null
}

export type ListBookingsResult =
  | { data: AgendaBookingListItem[]; error: null }
  | { data: null; error: BookingsDataError }

function toBookingsDataError(error: PostgrestError): BookingsDataError {
  return {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  }
}

export async function listBookings(): Promise<ListBookingsResult> {
  const { data, error } = await agendaBookingsQuery()

  if (error) {
    return { data: null, error: toBookingsDataError(error) }
  }

  return { data, error: null }
}
