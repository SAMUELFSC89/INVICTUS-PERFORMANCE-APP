/**
 * Reexporta as mensagens de validacao do front.
 *
 * Antes este arquivo era uma COPIA, e as duas versoes divergiram: o backend
 * dizia "GPS" onde o app dizia "localizacao", para o mesmo motivo de recusa.
 * Manter uma fonte unica e o que impede isso de voltar a acontecer.
 */
export { VALIDATION_MESSAGES, getFriendlyMessage } from '../../src/services/validationMessages.js';
