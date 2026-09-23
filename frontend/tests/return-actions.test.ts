import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createActionSubmissionGuard,
  openWhatsappForReturn,
  whatsappLink,
} from '../src/lib/return-actions.ts'

const returnDetails = {
  clientName: 'Maria Silva',
  normalizedPhone: '5511999999999',
  serviceName: 'Progressiva',
}

test('abrir o WhatsApp apenas abre a mensagem e não confirma contato', () => {
  let openedUrl = ''
  const contactCalls = 0
  const result = openWhatsappForReturn(returnDetails, (url, target) => {
    openedUrl = url
    assert.equal(target, '_blank')
    return { opener: {} }
  })

  assert.equal(result, 'opened')
  assert.equal(contactCalls, 0)
  assert.match(openedUrl, /^https:\/\/wa\.me\/5511999999999\?text=/)
  assert.match(decodeURIComponent(openedUrl), /Olá, Maria! Tudo bem\?/)
})

test('bloqueio de popup é informado sem efeito colateral', () => {
  const result = openWhatsappForReturn(returnDetails, () => null)
  assert.equal(result, 'blocked')
})

test('telefone inválido não abre popup', () => {
  let openCalls = 0
  const result = openWhatsappForReturn(
    { ...returnDetails, normalizedPhone: '123' },
    () => {
      openCalls += 1
      return { opener: null }
    },
  )

  assert.equal(result, 'invalid-phone')
  assert.equal(openCalls, 0)
  assert.equal(
    whatsappLink({ ...returnDetails, normalizedPhone: '123' }),
    null,
  )
})

test('guarda exige ação explícita e impede confirmações duplicadas', () => {
  const guard = createActionSubmissionGuard()

  assert.equal(guard.tryStart(), true)
  assert.equal(guard.tryStart(), false)
  guard.succeed()
  assert.equal(guard.tryStart(), false)
})

test('guarda permite nova tentativa depois de uma falha', () => {
  const guard = createActionSubmissionGuard()

  assert.equal(guard.tryStart(), true)
  guard.reset()
  assert.equal(guard.tryStart(), true)
})
