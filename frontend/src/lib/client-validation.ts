import type {
  ClientFormInput,
  ClientsDataError,
} from '../data/clients'

export interface ClientFormErrors {
  name?: string
  phone?: string
}

export function validateClientForm(
  name: string,
  phone: string,
  notes: string,
): { input: ClientFormInput | null; errors: ClientFormErrors } {
  const trimmedName = name.trim()
  const trimmedPhone = phone.trim()
  const trimmedNotes = notes.trim()
  const errors: ClientFormErrors = {}

  if (!trimmedName) {
    errors.name = 'Informe o nome do cliente.'
  } else if (trimmedName.length < 2) {
    errors.name = 'O nome deve ter pelo menos 2 caracteres.'
  } else if (trimmedName.length > 150) {
    errors.name = 'O nome deve ter no máximo 150 caracteres.'
  }

  if (!trimmedPhone) {
    errors.phone = 'Informe o telefone do cliente.'
  } else if (trimmedPhone.length < 8) {
    errors.phone = 'O telefone deve ter pelo menos 8 caracteres.'
  } else if (trimmedPhone.length > 30) {
    errors.phone = 'O telefone deve ter no máximo 30 caracteres.'
  }

  return {
    input:
      Object.keys(errors).length === 0
        ? {
            name: trimmedName,
            phone: trimmedPhone,
            notes: trimmedNotes || null,
          }
        : null,
    errors,
  }
}

export function friendlyClientSaveError(
  error: ClientsDataError,
  mode: 'create' | 'edit',
) {
  const databaseMessage = `${error.message} ${error.details ?? ''}`

  if (error.code === '23514') {
    if (databaseMessage.includes('clients_name_check')) {
      return 'Revise o nome: ele deve ter entre 2 e 150 caracteres.'
    }

    if (databaseMessage.includes('clients_phone_check')) {
      return 'Revise o telefone: ele deve ter entre 8 e 30 caracteres.'
    }

    return 'Revise os dados informados e tente novamente.'
  }

  if (error.code === '42501') {
    return mode === 'edit'
      ? 'Sua conta não possui permissão para editar clientes.'
      : 'Sua conta não possui permissão para cadastrar clientes.'
  }

  return mode === 'edit'
    ? 'Não foi possível salvar as alterações. Tente novamente.'
    : 'Não foi possível cadastrar o cliente. Tente novamente.'
}
