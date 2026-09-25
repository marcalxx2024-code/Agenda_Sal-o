import {
  addDaysToDateValue,
  formatDateOnly,
  monthDateValues,
} from '../lib/salon-time'

const weekdays = [
  { short: 'Seg', long: 'Segunda-feira' },
  { short: 'Ter', long: 'Terça-feira' },
  { short: 'Qua', long: 'Quarta-feira' },
  { short: 'Qui', long: 'Quinta-feira' },
  { short: 'Sex', long: 'Sexta-feira' },
  { short: 'Sáb', long: 'Sábado' },
  { short: 'Dom', long: 'Domingo' },
]

interface MonthlyCalendarProps {
  visibleMonth: string
  selectedDate: string
  today: string
  datesWithBookings: ReadonlySet<string>
  isLoading: boolean
  hasError: boolean
  onPreviousMonth: () => void
  onNextMonth: () => void
  onSelectDate: (date: string) => void
  onRetry: () => void
}

function capitalize(value: string) {
  return value.charAt(0).toLocaleUpperCase('pt-BR') + value.slice(1)
}

export function MonthlyCalendar({
  visibleMonth,
  selectedDate,
  today,
  datesWithBookings,
  isLoading,
  hasError,
  onPreviousMonth,
  onNextMonth,
  onSelectDate,
  onRetry,
}: MonthlyCalendarProps) {
  const month = monthDateValues(visibleMonth)
  const [year, monthNumber] = month.from.split('-').map(Number)
  const firstWeekday = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7
  const totalDays = Number(month.to.slice(-2))
  const populatedCells = firstWeekday + totalDays
  const totalCells = Math.ceil(populatedCells / 7) * 7
  const monthLabel = capitalize(
    formatDateOnly(month.from, { month: 'long', year: 'numeric' }),
  )

  return (
    <section
      className="monthly-calendar"
      aria-labelledby="monthly-calendar-title"
      aria-busy={isLoading}
    >
      <header className="monthly-calendar__header">
        <div>
          <span className="eyebrow">Calendário</span>
          <h3 id="monthly-calendar-title">{monthLabel}</h3>
        </div>
        <div className="monthly-calendar__navigation">
          <button
            type="button"
            aria-label="Ver mês anterior"
            onClick={onPreviousMonth}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            type="button"
            aria-label="Ver próximo mês"
            onClick={onNextMonth}
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </header>

      <div className="monthly-calendar__weekdays" aria-hidden="true">
        {weekdays.map((weekday) => (
          <abbr title={weekday.long} key={weekday.short}>
            {weekday.short}
          </abbr>
        ))}
      </div>

      <div className="monthly-calendar__grid">
        {Array.from({ length: totalCells }, (_, index) => {
          const dayIndex = index - firstWeekday

          if (dayIndex < 0 || dayIndex >= totalDays) {
            return <span className="monthly-calendar__empty-cell" key={index} />
          }

          const date = addDaysToDateValue(month.from, dayIndex)
          const day = dayIndex + 1
          const isToday = date === today
          const isSelected = date === selectedDate
          const hasBookings = datesWithBookings.has(date)
          const accessibleDate = formatDateOnly(date, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })

          return (
            <button
              className={`monthly-calendar__day${isToday ? ' monthly-calendar__day--today' : ''}${isSelected ? ' monthly-calendar__day--selected' : ''}`}
              type="button"
              aria-label={`${accessibleDate}${hasBookings ? ', possui agendamentos' : ', sem agendamentos'}`}
              aria-current={isToday ? 'date' : undefined}
              aria-pressed={isSelected}
              key={date}
              onClick={() => onSelectDate(date)}
            >
              <span>{day}</span>
              {hasBookings && (
                <span className="monthly-calendar__booking-dot" aria-hidden="true" />
              )}
            </button>
          )
        })}
      </div>

      {isLoading && (
        <p className="monthly-calendar__feedback" role="status">
          Atualizando agendamentos do mês…
        </p>
      )}
      {hasError && (
        <div className="monthly-calendar__feedback monthly-calendar__feedback--error" role="alert">
          <span>Não foi possível carregar os agendamentos deste mês.</span>
          <button type="button" onClick={onRetry}>Tentar novamente</button>
        </div>
      )}
    </section>
  )
}
