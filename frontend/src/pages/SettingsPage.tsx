import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  createScheduleBlock,
  deleteScheduleBlock,
  listBusinessHours,
  listScheduleBlocks,
  updateBusinessHoursWeek,
  type AffectedBooking,
  type BusinessHour,
  type BusinessHoursWeekInput,
  type BusinessHoursWeekResult,
  type ScheduleBlock,
  type SettingsDataError,
} from '../data/settings'
import {
  isoToSalonInputValues,
  salonDateTimeFormatter,
  salonDateTimeToIso,
  salonDateValue,
} from '../lib/salon-time'

const weekdays = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
]

const blockFormatter = salonDateTimeFormatter({
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; hours: BusinessHour[]; blocks: ScheduleBlock[] }

function timeInput(value: string | null) {
  return value?.slice(0, 5) ?? ''
}

function friendlySettingsError(error: SettingsDataError) {
  const message = error.message.toLocaleLowerCase('en-US')
  if (error.code === '23P01') {
    if (message.includes('active booking')) {
      return 'O bloqueio coincide com um agendamento ativo. Cancele ou altere o agendamento primeiro.'
    }
    if (message.includes('another schedule block')) {
      return 'Este período coincide com outro bloqueio ou folga já cadastrado.'
    }
  }
  if (error.code === '23514') {
    return 'Revise os horários: abertura, intervalo e fechamento devem estar em ordem.'
  }
  if (error.code === '22023') {
    return 'Revise todos os dias: a semana precisa estar completa e os horários devem ser válidos.'
  }
  if (error.code === '55000') {
    return 'A configuração semanal está incompleta no banco. Recarregue a página e tente novamente.'
  }
  if (error.code === '42501' || error.code.startsWith('PGRST3')) {
    return 'Sua sessão não possui permissão para alterar as configurações.'
  }
  return 'Não foi possível salvar a configuração. Tente novamente.'
}

interface HoursConfirmation {
  hours: BusinessHoursWeekInput
  result: BusinessHoursWeekResult
}

interface BusinessHoursConflictDialogProps {
  bookings: AffectedBooking[]
  conflictsChanged: boolean
  error: string | null
  isSubmitting: boolean
  onCancel: () => void
  onConfirm: () => void
}

function BusinessHoursConflictDialog({
  bookings,
  conflictsChanged,
  error,
  isSubmitting,
  onCancel,
  onConfirm,
}: BusinessHoursConflictDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      className="client-dialog client-active-dialog"
      ref={dialogRef}
      aria-labelledby="business-hours-conflicts-title"
      onClose={onCancel}
      onCancel={(event) => {
        if (isSubmitting) event.preventDefault()
      }}
    >
      <div className="client-form">
        <header className="client-dialog__header">
          <div>
            <span className="eyebrow">Agendamentos preservados</span>
            <h2 id="business-hours-conflicts-title">
              Confirmar novo expediente?
            </h2>
            <p>
              Nenhum agendamento será cancelado ou alterado automaticamente.
            </p>
          </div>
          <button
            className="client-dialog__close"
            type="button"
            aria-label="Fechar confirmação do expediente"
            onClick={() => !isSubmitting && dialogRef.current?.close()}
            disabled={isSubmitting}
          >
            ×
          </button>
        </header>

        <div className="client-active-dialog__body">
          {conflictsChanged && (
            <p className="client-form__submit-error" role="alert">
              A lista mudou enquanto você confirmava. Revise os agendamentos e
              confirme novamente.
            </p>
          )}
          {error && (
            <p className="client-form__submit-error" role="alert">
              {error}
            </p>
          )}
          <p>
            Os horários abaixo ficarão fora do novo expediente, mas continuarão
            ativos:
          </p>
          <ul className="business-hours-conflict-list">
            {bookings.map((booking) => {
              const start = new Date(booking.starts_at)
              const end = new Date(booking.ends_at)
              return (
                <li key={booking.id}>
                  <strong>{booking.client_name}</strong>
                  <span>
                    {blockFormatter.format(start)} até {blockFormatter.format(end)}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>

        <footer className="client-form__actions">
          <button
            className="client-form__cancel"
            type="button"
            onClick={() => !isSubmitting && dialogRef.current?.close()}
            disabled={isSubmitting}
          >
            Voltar e revisar
          </button>
          <button
            className="primary-button client-form__submit"
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Confirmando…' : 'Preservar horários e salvar'}
          </button>
        </footer>
      </div>
    </dialog>
  )
}

function weekInput(hours: BusinessHour[]): BusinessHoursWeekInput {
  return hours.map((item) => ({
    weekday: item.weekday,
    is_open: item.is_open,
    opens_at: item.is_open ? item.opens_at : null,
    closes_at: item.is_open ? item.closes_at : null,
    break_starts_at: item.is_open ? item.break_starts_at : null,
    break_ends_at: item.is_open ? item.break_ends_at : null,
  }))
}

export function SettingsPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [isSavingHours, setIsSavingHours] = useState(false)
  const [isSavingBlock, setIsSavingBlock] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [blockStart, setBlockStart] = useState('')
  const [blockEnd, setBlockEnd] = useState('')
  const [blockReason, setBlockReason] = useState('')
  const [hoursConfirmation, setHoursConfirmation] =
    useState<HoursConfirmation | null>(null)
  const [hoursConfirmationError, setHoursConfirmationError] = useState<
    string | null
  >(null)

  useEffect(() => {
    let isCurrent = true
    void Promise.all([listBusinessHours(), listScheduleBlocks()])
      .then(([hoursResult, blocksResult]) => {
        if (!isCurrent) return
        if (hoursResult.error || blocksResult.error) {
          setState({ status: 'error' })
          return
        }
        setState({
          status: 'loaded',
          hours: hoursResult.data,
          blocks: blocksResult.data,
        })
      })
      .catch(() => isCurrent && setState({ status: 'error' }))
    return () => {
      isCurrent = false
    }
  }, [loadAttempt])

  useEffect(() => {
    if (!feedback) return
    const timeoutId = window.setTimeout(() => setFeedback(null), 5_000)
    return () => window.clearTimeout(timeoutId)
  }, [feedback])

  const sortedHours = useMemo(
    () =>
      state.status === 'loaded'
        ? [...state.hours].sort((first, second) => first.weekday - second.weekday)
        : [],
    [state],
  )

  function changeHour(weekday: number, values: Partial<BusinessHour>) {
    setState((current) =>
      current.status === 'loaded'
        ? {
            ...current,
            hours: current.hours.map((item) =>
              item.weekday === weekday ? { ...item, ...values } : item,
            ),
          }
        : current,
    )
  }

  async function saveHours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state.status !== 'loaded' || isSavingHours) return
    setIsSavingHours(true)
    setFeedback(null)
    setError(null)

    try {
      const hours = weekInput(state.hours)
      const result = await updateBusinessHoursWeek(hours)
      if (result.error) {
        setError(friendlySettingsError(result.error))
        return
      }
      if (!result.data.updated && result.data.requiresConfirmation) {
        setHoursConfirmationError(null)
        setHoursConfirmation({ hours, result: result.data })
        return
      }
      setFeedback('Expediente atualizado com sucesso.')
      setLoadAttempt((attempt) => attempt + 1)
    } catch {
      setError('Não foi possível conectar ao serviço. Tente novamente.')
    } finally {
      setIsSavingHours(false)
    }
  }

  async function confirmHoursWithConflicts() {
    if (!hoursConfirmation || isSavingHours) return
    setIsSavingHours(true)
    setFeedback(null)
    setError(null)
    setHoursConfirmationError(null)

    try {
      const result = await updateBusinessHoursWeek(
        hoursConfirmation.hours,
        true,
        hoursConfirmation.result.affectedBookingIds,
      )
      if (result.error) {
        setHoursConfirmationError(friendlySettingsError(result.error))
        return
      }
      if (!result.data.updated && result.data.requiresConfirmation) {
        setHoursConfirmation({
          hours: hoursConfirmation.hours,
          result: result.data,
        })
        return
      }

      setHoursConfirmation(null)
      setHoursConfirmationError(null)
      setFeedback(
        'Expediente atualizado. Os agendamentos informados foram preservados.',
      )
      setLoadAttempt((attempt) => attempt + 1)
    } catch {
      setHoursConfirmationError(
        'Não foi possível conectar ao serviço. Tente novamente.',
      )
    } finally {
      setIsSavingHours(false)
    }
  }

  async function saveBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSavingBlock) return
    setFeedback(null)
    setError(null)
    const [startDate, startTime] = blockStart.split('T')
    const [endDate, endTime] = blockEnd.split('T')
    const startsAt = salonDateTimeToIso(startDate, startTime)
    const endsAt = salonDateTimeToIso(endDate, endTime)
    if (!startsAt || !endsAt || startsAt >= endsAt) {
      setError('Informe início e fim válidos; o fim deve ser posterior ao início.')
      return
    }
    setIsSavingBlock(true)

    try {
      const result = await createScheduleBlock({
        starts_at: startsAt,
        ends_at: endsAt,
        reason: blockReason.trim() || null,
      })
      if (result.error) {
        setError(friendlySettingsError(result.error))
        return
      }
      setBlockStart('')
      setBlockEnd('')
      setBlockReason('')
      setFeedback('Bloqueio criado com sucesso.')
      setLoadAttempt((attempt) => attempt + 1)
    } catch {
      setError('Não foi possível conectar ao serviço. Tente novamente.')
    } finally {
      setIsSavingBlock(false)
    }
  }

  async function removeBlock(id: number) {
    if (deletingId !== null) return
    const block =
      state.status === 'loaded'
        ? state.blocks.find((item) => item.id === id)
        : undefined
    const blockName = block?.reason?.trim() || 'este período bloqueado'
    if (!window.confirm(`Excluir ${blockName}? Esta ação não pode ser desfeita.`)) {
      return
    }

    setDeletingId(id)
    setFeedback(null)
    setError(null)

    try {
      const result = await deleteScheduleBlock(id)
      if (result.error) {
        setError(friendlySettingsError(result.error))
      } else {
        setFeedback('Bloqueio excluído com sucesso.')
        setState((current) =>
          current.status === 'loaded'
            ? {
                ...current,
                blocks: current.blocks.filter((item) => item.id !== id),
              }
            : current,
        )
      }
    } catch {
      setError('Não foi possível conectar ao serviço. Tente novamente.')
    } finally {
      setDeletingId(null)
    }
  }

  if (state.status === 'loading') {
    return <div className="agenda-state" role="status"><h3>Carregando configurações…</h3></div>
  }
  if (state.status === 'error') {
    return (
      <div className="agenda-state" role="alert">
        <h3>Não foi possível carregar as configurações.</h3>
        <button className="primary-button" type="button" onClick={() => {
          setState({ status: 'loading' })
          setLoadAttempt((attempt) => attempt + 1)
        }}>Tentar novamente</button>
      </div>
    )
  }

  return (
    <section className="settings-page records-page" aria-labelledby="settings-title">
      <header className="records-page__heading">
        <div>
          <span className="eyebrow">Agenda do salão</span>
          <h2 id="settings-title">Configurações</h2>
          <p>Defina o expediente no fuso de São Paulo e os períodos indisponíveis.</p>
        </div>
      </header>
      {feedback && <p className="agenda-success" role="status">{feedback}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      <form className="settings-panel" onSubmit={saveHours}>
        <div className="section-heading">
          <div>
            <span className="eyebrow">Semana</span>
            <h3>Expediente e intervalos</h3>
            <p className="section-heading__description">
              Defina os horários disponíveis em cada dia da semana.
            </p>
          </div>
          <button className="primary-button" type="submit" disabled={isSavingHours || hoursConfirmation !== null}>
            {isSavingHours ? 'Salvando…' : 'Salvar expediente'}
          </button>
        </div>
        <div className="business-hours-list">
          {sortedHours.map((item) => {
            const hasBreak = item.break_starts_at !== null
            return (
              <fieldset className="business-hour-row" key={item.weekday} disabled={isSavingHours || hoursConfirmation !== null}>
                <legend>{weekdays[item.weekday]}</legend>
                <label className="settings-check"><input type="checkbox" checked={item.is_open} onChange={(event) => changeHour(item.weekday, { is_open: event.target.checked })} />Aberto</label>
                <label>Abertura<input type="time" required={item.is_open} disabled={!item.is_open} value={timeInput(item.opens_at)} onChange={(event) => changeHour(item.weekday, { opens_at: event.target.value })} /></label>
                <label>Fechamento<input type="time" required={item.is_open} disabled={!item.is_open} value={timeInput(item.closes_at)} onChange={(event) => changeHour(item.weekday, { closes_at: event.target.value })} /></label>
                <label className="settings-check"><input type="checkbox" checked={hasBreak} disabled={!item.is_open} onChange={(event) => changeHour(item.weekday, event.target.checked ? { break_starts_at: '12:00', break_ends_at: '13:00' } : { break_starts_at: null, break_ends_at: null })} />Intervalo</label>
                <label>Início do intervalo<input type="time" required={hasBreak} disabled={!item.is_open || !hasBreak} value={timeInput(item.break_starts_at)} onChange={(event) => changeHour(item.weekday, { break_starts_at: event.target.value })} /></label>
                <label>Fim do intervalo<input type="time" required={hasBreak} disabled={!item.is_open || !hasBreak} value={timeInput(item.break_ends_at)} onChange={(event) => changeHour(item.weekday, { break_ends_at: event.target.value })} /></label>
              </fieldset>
            )
          })}
        </div>
      </form>

      <section className="settings-panel" aria-labelledby="blocks-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Exceções</span>
            <h3 id="blocks-title">Bloqueios e folgas</h3>
            <p className="section-heading__description">
              Reserve períodos em que o salão não receberá agendamentos.
            </p>
          </div>
        </div>
        <form className="schedule-block-form" onSubmit={saveBlock}>
          <label>Início<input type="datetime-local" min={`${salonDateValue()}T00:00`} value={blockStart} onChange={(event) => setBlockStart(event.target.value)} required disabled={isSavingBlock} /></label>
          <label>Fim<input type="datetime-local" min={blockStart || `${salonDateValue()}T00:00`} value={blockEnd} onChange={(event) => setBlockEnd(event.target.value)} required disabled={isSavingBlock} /></label>
          <label>Motivo <span>Opcional</span><input value={blockReason} onChange={(event) => setBlockReason(event.target.value)} maxLength={500} disabled={isSavingBlock} /></label>
          <button className="primary-button" type="submit" disabled={isSavingBlock}>{isSavingBlock ? 'Criando…' : 'Criar bloqueio'}</button>
        </form>
        {state.blocks.length === 0 ? (
          <p className="settings-empty settings-empty--intentional">
            Nenhum bloqueio ou folga cadastrado. A agenda está livre conforme o
            expediente semanal.
          </p>
        ) : (
          <ul className="schedule-block-list">
            {state.blocks.map((block) => {
              const start = new Date(block.starts_at)
              const end = new Date(block.ends_at)
              const inputValues = isoToSalonInputValues(block.starts_at)
              return (
                <li key={block.id}>
                  <div><strong>{block.reason?.trim() || 'Período bloqueado'}</strong><span>{Number.isNaN(start.getTime()) ? inputValues.date : `${blockFormatter.format(start)} até ${blockFormatter.format(end)}`}</span></div>
                  <button type="button" onClick={() => void removeBlock(block.id)} disabled={deletingId !== null}>{deletingId === block.id ? 'Excluindo…' : 'Excluir'}</button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      {hoursConfirmation && (
        <BusinessHoursConflictDialog
          key={hoursConfirmation.result.affectedBookingIds.join('-')}
          bookings={hoursConfirmation.result.affectedBookings}
          conflictsChanged={hoursConfirmation.result.conflictsChanged}
          error={hoursConfirmationError}
          isSubmitting={isSavingHours}
          onCancel={() => {
            setHoursConfirmation(null)
            setHoursConfirmationError(null)
          }}
          onConfirm={() => void confirmHoursWithConflicts()}
        />
      )}
    </section>
  )
}
