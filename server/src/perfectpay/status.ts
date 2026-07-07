/** Mapas dos enums da PerfectPay (webhook de vendas) para labels em português. */

export const SALE_STATUS_LABELS: Record<number, string> = {
  1: 'Pendente',
  2: 'Aprovada',
  3: 'Em processo',
  4: 'Em mediação',
  5: 'Rejeitada',
  6: 'Cancelada',
  7: 'Reembolsada',
  8: 'Autorizada',
  9: 'Chargeback',
  10: 'Concluída',
  11: 'Erro no checkout',
  12: 'Pré-checkout',
  13: 'Boleto expirado',
};

export const PAYMENT_TYPE_LABELS: Record<number, string> = {
  0: '—',
  1: 'Cartão de crédito',
  2: 'Boleto',
  3: 'PayPal',
  4: 'Cartão recorrente',
  5: 'Grátis',
  6: 'Cartão (upsell)',
};

/** Status que contam como faturamento efetivo (venda aprovada/concluída). */
export const APPROVED_STATUSES = [2, 10];
/** Status de estorno (reembolso/chargeback). */
export const REFUNDED_STATUSES = [7, 9];

/**
 * A API de Vendas retorna sale_status como STRING (ex.: "approved"), diferente
 * do webhook que manda sale_status_enum (int). Mapeamos a string para o mesmo
 * enum numérico usado internamente, para o resumo funcionar igual nas duas vias.
 */
export const API_STATUS_TO_ENUM: Record<string, number> = {
  pending: 1,
  approved: 2,
  in_process: 3,
  in_mediation: 4,
  rejected: 5,
  cancelled: 6,
  canceled: 6,
  refunded: 7,
  authorized: 8,
  charged_back: 9,
  chargeback: 9,
  completed: 10,
  checkout_error: 11,
  precheckout: 12,
  expired: 13,
  billet_printed: 1,
};

export function apiStatusToEnum(status: string | null | undefined): number {
  if (!status) return 0;
  return API_STATUS_TO_ENUM[status.trim().toLowerCase()] ?? 0;
}

/** Mapa do currency_enum da PerfectPay para o código ISO da moeda. */
export const CURRENCY_ENUM: Record<number, string> = {
  1: 'BRL',
  2: 'USD',
  3: 'EUR',
};

export function currencyFromEnum(
  enumValue: number | null | undefined,
  fallbackKey?: string | null,
): string {
  if (fallbackKey && fallbackKey.trim()) return fallbackKey.trim().toUpperCase();
  if (enumValue != null && CURRENCY_ENUM[enumValue]) return CURRENCY_ENUM[enumValue];
  return 'BRL';
}

export function saleStatusLabel(status: number | null | undefined): string {
  if (status == null) return 'Desconhecido';
  return SALE_STATUS_LABELS[status] ?? `Desconhecido (${status})`;
}

export function paymentTypeLabel(type: number | null | undefined): string {
  if (type == null) return '—';
  return PAYMENT_TYPE_LABELS[type] ?? `Tipo ${type}`;
}

/**
 * Rótulos do campo `payment_type` da API de Vendas (enum próprio, diferente do
 * webhook). Certos: 1 = cartão. Os códigos 10/11 não estão na doc pública —
 * ajuste aqui quando confirmar (é o único lugar a mudar).
 */
export const API_PAYMENT_LABELS: Record<number, string> = {
  1: 'Cartão de crédito',
  2: 'Boleto',
  3: 'PayPal',
  4: 'Cartão recorrente',
  5: 'Grátis',
  6: 'Cartão (upsell)',
  10: 'PayPal', // confirmado pelo usuário
  11: 'Outro', // a confirmar (usuário usa cartão + PayPal)
};

export function apiPaymentLabel(type: number | null | undefined): string {
  if (type == null) return 'Outro';
  return API_PAYMENT_LABELS[type] ?? `Outro (${type})`;
}
