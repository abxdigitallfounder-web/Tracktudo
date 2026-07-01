/** Mapa de account_status da Meta para labels em português. */
export const ACCOUNT_STATUS_LABELS: Record<number, string> = {
  1: 'Ativa',
  2: 'Desativada',
  3: 'Não quitada',
  7: 'Em revisão de risco',
  8: 'Pendente de pagamento',
  9: 'Período de carência',
  100: 'Encerramento pendente',
  101: 'Encerrada',
};

export function accountStatusLabel(status: number | null | undefined): string {
  if (status == null) return 'Desconhecido';
  return ACCOUNT_STATUS_LABELS[status] ?? `Desconhecido (${status})`;
}

export function isAccountActive(status: number | null | undefined): boolean {
  return status === 1;
}

/**
 * Converte um valor em centavos (string, menor unidade da moeda) para número
 * na unidade normal. Ex.: "5304148" -> 53041.48.
 * Retorna null quando o valor está ausente/vazio.
 */
export function centsToUnit(value: string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const cents = Number(value);
  if (!Number.isFinite(cents)) return null;
  return cents / 100;
}

/**
 * Converte um valor de gasto de insights (string, JÁ na unidade normal) para número.
 * Ex.: "153.42" -> 153.42. Diferente dos campos de conta (que vêm em centavos).
 */
export function spendToUnit(value: string | null | undefined): number {
  if (value == null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
