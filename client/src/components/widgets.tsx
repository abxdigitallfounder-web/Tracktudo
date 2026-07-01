import type { Account } from '../api';
import { formatMoney, formatPct } from '../format';

/** Classe de risco a partir do % usado do limite. */
export function riskLevel(pctUsed: number | null): 'ok' | 'warn' | 'danger' {
  if (pctUsed == null) return 'ok';
  if (pctUsed >= 90) return 'danger';
  if (pctUsed >= 75) return 'warn';
  return 'ok';
}

/** Badge de status da conta (verde=ativa, cinza/vermelho caso contrário). */
export function StatusBadge({ account }: { account: Account }) {
  const cls = account.status === 1 ? 'ok' : account.status === 101 ? 'danger' : 'warn';
  return <span className={`badge ${cls}`}>{account.statusLabel}</span>;
}

/** Barra de progresso do % usado do limite. */
export function UsageBar({ pctUsed }: { pctUsed: number | null }) {
  if (pctUsed == null) {
    return <span className="muted">Sem limite</span>;
  }
  const level = riskLevel(pctUsed);
  const width = Math.min(100, Math.max(0, pctUsed));
  return (
    <span>
      <span className={`progress ${level}`}>
        <span style={{ width: `${width}%` }} />
      </span>
      <span className="pct-label">{formatPct(pctUsed)}</span>
    </span>
  );
}

/** Formata um mapa moeda->valor em várias linhas (não soma moedas diferentes). */
export function MoneyByCurrency({ map }: { map: Record<string, number> }) {
  const entries = Object.entries(map);
  if (entries.length === 0) return <span>—</span>;
  return (
    <>
      {entries.map(([cur, val], i) => (
        <div key={cur} className={i > 0 ? 'value small' : undefined}>
          {formatMoney(val, cur)}
        </div>
      ))}
    </>
  );
}
