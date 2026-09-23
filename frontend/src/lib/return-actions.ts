export interface ReturnWhatsappDetails {
  clientName: string | null
  normalizedPhone: string | null
  serviceName: string | null
}

export interface OpenedWindow {
  opener: unknown
}

export type OpenWindow = (
  url: string,
  target: string,
) => OpenedWindow | null

export interface ActionSubmissionGuard {
  tryStart: () => boolean
  succeed: () => void
  reset: () => void
}

export function validWhatsappPhone(phone: string | null) {
  return phone !== null && /^\d{10,15}$/.test(phone)
}

export function whatsappMessage(item: ReturnWhatsappDetails) {
  const firstName = item.clientName?.trim().split(/\s+/)[0]
  const service = item.serviceName?.trim() || 'seu serviço'
  const greeting = firstName ? `Olá, ${firstName}! Tudo bem?` : 'Olá! Tudo bem?'

  return `${greeting}\n\nAqui é do salão Monica Lugo.\n\nJá está chegando o período recomendado para o seu retorno de ${service}.\n\nSe quiser, podemos combinar um novo horário.`
}

export function whatsappLink(item: ReturnWhatsappDetails) {
  if (!validWhatsappPhone(item.normalizedPhone)) return null

  return `https://wa.me/${item.normalizedPhone}?text=${encodeURIComponent(
    whatsappMessage(item),
  )}`
}

export function openWhatsappForReturn(
  item: ReturnWhatsappDetails,
  openWindow: OpenWindow,
) {
  const link = whatsappLink(item)
  if (!link) return 'invalid-phone' as const

  const openedWindow = openWindow(link, '_blank')
  if (!openedWindow) return 'blocked' as const

  try {
    openedWindow.opener = null
  } catch {
    // Safari/WebViews may protect WindowProxy after handing the URL to the app.
  }

  return 'opened' as const
}

export function createActionSubmissionGuard(): ActionSubmissionGuard {
  let state: 'idle' | 'submitting' | 'succeeded' = 'idle'

  return {
    tryStart() {
      if (state !== 'idle') return false
      state = 'submitting'
      return true
    },
    succeed() {
      state = 'succeeded'
    },
    reset() {
      state = 'idle'
    },
  }
}
