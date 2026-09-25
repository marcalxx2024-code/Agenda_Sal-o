export const SALON_TIME_ZONE = 'America/Sao_Paulo'

const dateTimePartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SALON_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function partsFor(date: Date) {
  const values = Object.fromEntries(
    dateTimePartsFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  }
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function salonDateValue(date = new Date()) {
  const parts = partsFor(date)
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

export function isoToSalonInputValues(value?: string) {
  if (!value) return { date: '', time: '' }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return { date: '', time: '' }
  const parts = partsFor(parsed)
  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
  }
}

export function salonDateTimeToIso(dateValue: string, timeValue: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue)
  if (!match || !timeMatch) return null

  const desired = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    second: 0,
  }
  if (desired.hour > 23 || desired.minute > 59) return null

  const localAsUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
  )
  const calendarCheck = new Date(localAsUtc)
  if (
    calendarCheck.getUTCFullYear() !== desired.year ||
    calendarCheck.getUTCMonth() + 1 !== desired.month ||
    calendarCheck.getUTCDate() !== desired.day
  ) {
    return null
  }

  let instant = new Date(localAsUtc)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = partsFor(instant)
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    )
    const difference = localAsUtc - actualAsUtc
    if (difference === 0) break
    instant = new Date(instant.getTime() + difference)
  }

  const resolved = partsFor(instant)
  if (
    resolved.year !== desired.year ||
    resolved.month !== desired.month ||
    resolved.day !== desired.day ||
    resolved.hour !== desired.hour ||
    resolved.minute !== desired.minute
  ) {
    return null
  }
  return instant.toISOString()
}

export function addDaysToDateValue(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function startOfMonthDateValue(value: string) {
  const [year, month] = value.split('-').map(Number)
  return `${year}-${pad(month)}-01`
}

export function addMonthsToDateValue(value: string, months: number) {
  const [year, month, day] = value.split('-').map(Number)
  const targetMonth = new Date(Date.UTC(year, month - 1 + months, 1))
  const lastDay = new Date(
    Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0),
  ).getUTCDate()
  const date = new Date(
    Date.UTC(
      targetMonth.getUTCFullYear(),
      targetMonth.getUTCMonth(),
      Math.min(day, lastDay),
    ),
  )

  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function monthDateValues(value: string) {
  const from = startOfMonthDateValue(value)
  const nextMonth = addMonthsToDateValue(from, 1)
  return { from, to: addDaysToDateValue(nextMonth, -1) }
}

export function salonDateRange(from: string, toInclusive: string) {
  const start = from ? salonDateTimeToIso(from, '00:00') : null
  const end = toInclusive
    ? salonDateTimeToIso(addDaysToDateValue(toInclusive, 1), '00:00')
    : null
  return { start, end }
}

export function salonDateTimeFormatter(
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat('pt-BR', {
    ...options,
    timeZone: SALON_TIME_ZONE,
  })
}

export function formatDateOnly(
  value: string,
  options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  },
) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return 'Data indisponível'
  return new Intl.DateTimeFormat('pt-BR', {
    ...options,
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)))
}
