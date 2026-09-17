import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import {
  addDaysToDateValue,
  salonDateRange,
  salonDateValue,
} from '../lib/salon-time'

export interface DashboardBooking {
  id: number
  starts_at: string
  status: string
  client: { id: number; name: string } | null
}

export interface DashboardAppointment {
  id: number
  performed_on: string
  client: { id: number; name: string } | null
}

export interface DashboardData {
  todayBookings: number
  upcomingBookings: number
  activeClients: number
  activeServices: number
  pendingReturns: number
  recentAppointmentsCount: number
  recentAppointments: DashboardAppointment[]
  nextBookings: DashboardBooking[]
}

export interface DashboardDataError {
  code: string
  message: string
  details: string | null
  hint: string | null
}

export type DashboardResult =
  | { data: DashboardData; error: null }
  | { data: null; error: DashboardDataError }

function toDashboardError(error: PostgrestError): DashboardDataError {
  return {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  }
}

export async function loadDashboard(): Promise<DashboardResult> {
  const salonToday = salonDateValue()
  const today = salonDateRange(salonToday, salonToday)
  const now = new Date().toISOString()
  const recentStartDate = addDaysToDateValue(salonToday, -30)

  const [
    todayResult,
    upcomingResult,
    clientsResult,
    servicesResult,
    returnsResult,
    recentCountResult,
    appointmentsResult,
    nextBookingsResult,
  ] = await Promise.all([
    supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .gte('starts_at', today.start ?? now)
      .lt('starts_at', today.end ?? now)
      .in('status', ['scheduled', 'confirmed']),
    supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .gte('starts_at', now)
      .in('status', ['scheduled', 'confirmed']),
    supabase
      .from('clients')
      .select('*', { count: 'exact', head: true })
      .eq('active', true),
    supabase
      .from('services')
      .select('*', { count: 'exact', head: true })
      .eq('active', true),
    supabase
      .from('pending_returns')
      .select('*', { count: 'exact', head: true }),
    supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .gte('performed_on', recentStartDate),
    supabase
      .from('appointments')
      .select('id, performed_on, client:clients!appointments_client_id_fkey(id, name)')
      .order('performed_on', { ascending: false })
      .order('id', { ascending: false })
      .limit(5),
    supabase
      .from('bookings')
      .select('id, starts_at, status, client:clients!bookings_client_id_fkey(id, name)')
      .gte('starts_at', now)
      .in('status', ['scheduled', 'confirmed'])
      .order('starts_at', { ascending: true })
      .limit(5),
  ])

  const error =
    todayResult.error ??
    upcomingResult.error ??
    clientsResult.error ??
    servicesResult.error ??
    returnsResult.error ??
    recentCountResult.error ??
    appointmentsResult.error ??
    nextBookingsResult.error

  if (error) return { data: null, error: toDashboardError(error) }

  return {
    data: {
      todayBookings: todayResult.count ?? 0,
      upcomingBookings: upcomingResult.count ?? 0,
      activeClients: clientsResult.count ?? 0,
      activeServices: servicesResult.count ?? 0,
      pendingReturns: returnsResult.count ?? 0,
      recentAppointmentsCount: recentCountResult.count ?? 0,
      recentAppointments: appointmentsResult.data ?? [],
      nextBookings: nextBookingsResult.data ?? [],
    },
    error: null,
  }
}
