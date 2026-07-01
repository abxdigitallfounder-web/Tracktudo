// Formatação em pt-BR (moeda, número, data, tempo relativo).

export function formatMoney(value: number, currency: string): string {
  const cur = currency && currency.length === 3 ? currency : 'BRL';
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: cur,
    }).format(value);
  } catch {
    // Moeda desconhecida: formata como número e anexa o código.
    return `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(value)} ${currency}`;
  }
}

export function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatPct(value: number | null): string {
  if (value == null) return '—';
  return `${formatNumber(value, 1)}%`;
}

/** "2026-06-30" -> "30/06" (dia/mês, para colunas de tabela e eixos). */
export function formatDayMonth(isoDate: string): string {
  const [, m, d] = isoDate.split('-');
  return `${d}/${m}`;
}

/** "2026-06-30" -> "30/06/2026". */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

/** ISO timestamp -> "há X min" / "há X h" / "há X dias". */
export function timeAgo(iso: string | null): string {
  if (!iso) return 'nunca';
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
}
