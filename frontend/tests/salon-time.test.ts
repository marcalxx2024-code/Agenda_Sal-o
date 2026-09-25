import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addMonthsToDateValue,
  isoToSalonInputValues,
  monthDateValues,
  salonDateRange,
  salonDateValue,
  startOfMonthDateValue,
} from '../src/lib/salon-time.ts'

test('data atual usa America/Sao_Paulo na virada do dia', () => {
  assert.equal(salonDateValue(new Date('2026-09-25T02:59:59.000Z')), '2026-09-24')
  assert.equal(salonDateValue(new Date('2026-09-25T03:00:00.000Z')), '2026-09-25')
})

test('intervalo mensal cobre somente o mês informado', () => {
  assert.deepEqual(monthDateValues('2026-09-25'), {
    from: '2026-09-01',
    to: '2026-09-30',
  })
  assert.deepEqual(monthDateValues('2028-02-10'), {
    from: '2028-02-01',
    to: '2028-02-29',
  })
})

test('navegação mensal trata virada do ano e limita o dia ao mês', () => {
  assert.equal(startOfMonthDateValue('2026-12-18'), '2026-12-01')
  assert.equal(addMonthsToDateValue('2026-12-01', 1), '2027-01-01')
  assert.equal(addMonthsToDateValue('2026-03-31', -1), '2026-02-28')
})

test('intervalo de consulta converte meia-noite de São Paulo para UTC', () => {
  assert.deepEqual(salonDateRange('2026-09-01', '2026-09-30'), {
    start: '2026-09-01T03:00:00.000Z',
    end: '2026-10-01T03:00:00.000Z',
  })
})

test('agendamento UTC é agrupado pela data local do salão', () => {
  assert.equal(
    isoToSalonInputValues('2026-09-25T02:30:00.000Z').date,
    '2026-09-24',
  )
})
