import type { Account } from './api';

// Prioridade de exibição por status (em TODO o projeto):
// 1º Ativa (1) · 2º Não quitada (3) · 3º Desativada (2) · depois o resto.
const STATUS_PRIORITY: Record<number, number> = {
  1: 0, // Ativa
  3: 1, // Não quitada
  2: 2, // Desativada
};

export function statusPriority(status: number): number {
  return STATUS_PRIORITY[status] ?? 3;
}

/**
 * Compara duas contas pela prioridade de status; em empate, usa `tie`
 * (ou o nome, em ordem alfabética, como padrão).
 */
export function compareByStatus(
  a: Account,
  b: Account,
  tie?: (a: Account, b: Account) => number,
): number {
  const d = statusPriority(a.status) - statusPriority(b.status);
  if (d !== 0) return d;
  return tie ? tie(a, b) : a.name.localeCompare(b.name, 'pt-BR');
}
