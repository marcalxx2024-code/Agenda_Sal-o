import type { PostgrestError, QueryData } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { supabase } from '../lib/supabase'

type ClientRow = Database['public']['Tables']['clients']['Row']
type ServiceRow = Database['public']['Tables']['services']['Row']
type CreateBookingArgs =
  Database['public']['Functions']['create_booking']['Args']
type CreateBookingRow =
  Database['public']['Functions']['create_booking']['Returns'][number]
type ConfirmBookingArgs =
  Database['public']['Functions']['confirm_booking']['Args']
type ConfirmBookingRow =
  Database['public']['Functions']['confirm_booking']['Returns'][number]
type CancelBookingArgs = Database['public']['Functions']['cancel_booking']['Args']
type CancelBookingRow =
  Database['public']['Functions']['cancel_booking']['Returns'][number]
type MarkBookingNoShowArgs =
  Database['public']['Functions']['mark_booking_no_show']['Args']
type MarkBookingNoShowRow =
  Database['public']['Functions']['mark_booking_no_show']['Returns'][number]

export type BookingClientOption = Pick<ClientRow, 'id' | 'name'>
export type BookingServiceOption = Pick<
  ServiceRow,
  'id' | 'name' | 'estimated_duration_minutes'
>
export type CreateBookingInput = CreateBookingArgs
export type CreatedBooking = CreateBookingRow
export type ConfirmedBooking = ConfirmBookingRow
export type CancelledBooking = CancelBookingRow
export type NoShowBooking = MarkBookingNoShowRow
export type BookingStatusChange =
  | ConfirmBookingRow
  | CancelBookingRow
  | MarkBookingNoShowRow

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

export interface BookingFormOptions {
  clients: BookingClientOption[]
  services: BookingServiceOption[]
}

export type BookingFormOptionsResult =
  | { data: BookingFormOptions; error: null }
  | { data: null; error: BookingsDataError }

export type CreateBookingResult =
  | { data: CreatedBooking; error: null }
  | { data: null; error: BookingsDataError }

export type ConfirmBookingResult =
  | { data: ConfirmedBooking; error: null }
  | { data: null; error: BookingsDataError }

export type CancelBookingResult =
  | { data: CancelledBooking; error: null }
  | { data: null; error: BookingsDataError }

export type MarkBookingNoShowResult =
  | { data: NoShowBooking; error: null }
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

export async function listBookingFormOptions(): Promise<BookingFormOptionsResult> {
  const [clientsResult, servicesResult] = await Promise.all([
    supabase
      .from('clients')
      .select('id, name')
      .eq('active', true)
      .order('name', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('services')
      .select('id, name, estimated_duration_minutes')
      .eq('active', true)
      .order('name', { ascending: true })
      .order('id', { ascending: true }),
  ])

  const error = clientsResult.error ?? servicesResult.error

  if (error) {
    return { data: null, error: toBookingsDataError(error) }
  }

  return {
    data: {
      clients: clientsResult.data,
      services: servicesResult.data,
    },
    error: null,
  }
}

export async function createBooking(
  input: CreateBookingInput,
): Promise<CreateBookingResult> {
  const { data, error } = await supabase.rpc('create_booking', input).single()

  if (error) {
    return { data: null, error: toBookingsDataError(error) }
  }

  return { data, error: null }
}

export async function confirmBooking(
  bookingId: ConfirmBookingArgs['p_booking_id'],
): Promise<ConfirmBookingResult> {
  const { data, error } = await supabase
    .rpc('confirm_booking', { p_booking_id: bookingId })
    .single()

  if (error) {
    return { data: null, error: toBookingsDataError(error) }
  }

  return { data, error: null }
}

export async function cancelBooking(
  bookingId: CancelBookingArgs['p_booking_id'],
): Promise<CancelBookingResult> {
  const { data, error } = await supabase
    .rpc('cancel_booking', { p_booking_id: bookingId })
    .single()

  if (error) {
    return { data: null, error: toBookingsDataError(error) }
  }

  return { data, error: null }
}

export async function markBookingNoShow(
  bookingId: MarkBookingNoShowArgs['p_booking_id'],
): Promise<MarkBookingNoShowResult> {
  const { data, error } = await supabase
    .rpc('mark_booking_no_show', { p_booking_id: bookingId })
    .single()

  if (error) {
    return { data: null, error: toBookingsDataError(error) }
  }

  return { data, error: null }
}
