import type { PostgrestError, QueryData } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { supabase } from '../lib/supabase'

type ClientRow = Database['public']['Tables']['clients']['Row']
type ServiceRow = Database['public']['Tables']['services']['Row']
type CreateBookingArgs =
  Database['public']['Functions']['create_booking']['Args']
type CreateBookingRow =
  Database['public']['Functions']['create_booking']['Returns'][number]
type UpdateBookingArgs =
  Database['public']['Functions']['update_booking']['Args']
type UpdateBookingRow =
  Database['public']['Functions']['update_booking']['Returns'][number]
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
type CompleteBookingArgs =
  Database['public']['Functions']['complete_booking']['Args']
type CompleteBookingRow =
  Database['public']['Functions']['complete_booking']['Returns'][number]

export type BookingClientOption = Pick<
  ClientRow,
  'id' | 'name' | 'phone' | 'active'
>
export type BookingServiceOption = Pick<
  ServiceRow,
  'id' | 'name' | 'estimated_duration_minutes' | 'active'
>
export type CreateBookingInput = CreateBookingArgs
export type CreatedBooking = CreateBookingRow
export type UpdateBookingInput = UpdateBookingArgs
export type UpdatedBooking = UpdateBookingRow
export type ConfirmedBooking = ConfirmBookingRow
export type CancelledBooking = CancelBookingRow
export type NoShowBooking = MarkBookingNoShowRow
export type CompleteBookingInput = CompleteBookingArgs
export type CompletedBooking = CompleteBookingRow
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
        service_id,
        service_name,
        estimated_duration_minutes
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

export interface BookingListFilters {
  from?: string
  to?: string
  status?: string
}

export interface BookingFormOptions {
  clients: BookingClientOption[]
  services: BookingServiceOption[]
}

export interface BookingEditOptionScope {
  currentClientId?: ClientRow['id']
  currentServiceIds: ServiceRow['id'][]
}

export type BookingFormOptionsResult =
  | { data: BookingFormOptions; error: null }
  | { data: null; error: BookingsDataError }

export type CreateBookingResult =
  | { data: CreatedBooking; error: null }
  | { data: null; error: BookingsDataError }

export type UpdateBookingResult =
  | { data: UpdatedBooking; error: null }
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

export type CompleteBookingResult =
  | { data: CompletedBooking; error: null }
  | { data: null; error: BookingsDataError }

export type CompletionServiceOption = Pick<
  ServiceRow,
  'id' | 'name' | 'active'
>

export type CompletionServiceOptionsResult =
  | { data: CompletionServiceOption[]; error: null }
  | { data: null; error: BookingsDataError }

function toBookingsDataError(error: PostgrestError): BookingsDataError {
  return {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  }
}

export async function listBookings(
  filters: BookingListFilters = {},
): Promise<ListBookingsResult> {
  let query = agendaBookingsQuery()

  if (filters.from) query = query.gte('starts_at', filters.from)
  if (filters.to) query = query.lt('starts_at', filters.to)
  if (filters.status) query = query.eq('status', filters.status)

  const { data, error } = await query

  if (error) {
    return { data: null, error: toBookingsDataError(error) }
  }

  return { data, error: null }
}

export async function listCompletionServiceOptions(
  plannedServiceIds: ServiceRow['id'][],
): Promise<CompletionServiceOptionsResult> {
  const servicesQuery = supabase
    .from('services')
    .select('id, name, active')

  const scopedQuery =
    plannedServiceIds.length > 0
      ? servicesQuery.or(
          `active.eq.true,id.in.(${plannedServiceIds.join(',')})`,
        )
      : servicesQuery.eq('active', true)

  const { data, error } = await scopedQuery
    .order('name', { ascending: true })
    .order('id', { ascending: true })

  if (error) {
    return { data: null, error: toBookingsDataError(error) }
  }

  return { data, error: null }
}

export async function listBookingFormOptions(
  editScope?: BookingEditOptionScope,
): Promise<BookingFormOptionsResult> {
  const clientsQuery = supabase
    .from('clients')
    .select('id, name, phone, active')

  const servicesQuery = supabase
    .from('services')
    .select('id, name, estimated_duration_minutes, active')

  const scopedClientsQuery =
    editScope?.currentClientId === undefined
      ? clientsQuery.eq('active', true)
      : clientsQuery.or(
          `active.eq.true,id.eq.${editScope.currentClientId}`,
        )

  const scopedServicesQuery =
    editScope && editScope.currentServiceIds.length > 0
      ? servicesQuery.or(
          `active.eq.true,id.in.(${editScope.currentServiceIds.join(',')})`,
        )
      : servicesQuery.eq('active', true)

  const [clientsResult, servicesResult] = await Promise.all([
    scopedClientsQuery
      .order('name', { ascending: true })
      .order('id', { ascending: true }),
    scopedServicesQuery
      .order('name', { ascending: true })
      .order('id', { ascending: true }),
  ])

  const error = clientsResult.error ?? servicesResult.error

  if (error) {
    return { data: null, error: toBookingsDataError(error) }
  }

  return {
    data: {
      clients: clientsResult.data ?? [],
      services: servicesResult.data ?? [],
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

export async function updateBooking(
  input: UpdateBookingInput,
): Promise<UpdateBookingResult> {
  const { data, error } = await supabase.rpc('update_booking', input).single()

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

export async function completeBooking(
  input: CompleteBookingInput,
): Promise<CompleteBookingResult> {
  const { data, error } = await supabase.rpc('complete_booking', input).single()

  if (error) {
    return { data: null, error: toBookingsDataError(error) }
  }

  return { data, error: null }
}
