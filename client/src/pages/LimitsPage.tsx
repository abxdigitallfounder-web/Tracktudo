import { useEffect, useMemo, useState } from 'react';
import { apiGetAccounts, apiGetSummary, type Account, type Summary } from '../api';
import { formatMoney } from '../format';
import { MoneyByCurrency, StatusBadge, UsageBar, riskLevel } from '../components/widgets';

type SortKey = 'name' | 'status' | 'spendCap' | 'amountSpent' | 'available' | 'pctUsed';
type SortDir = 'asc' | 'desc';

const COLUMNS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: 'name', label: 'Conta' },
  { key: 'status', label: 'Status' },
  { key: 'spendCap', label: 'Limite', num: true },
  { key: 'amountSpent', label: 'Gasto acumulado', num: true },
  { key: 'available', label: 'Disponível', num: true },
  { key: 'pctUsed', label: '% usado', num: true },
];

export function LimitsPage({ reloadKey }: { reloadKey: number }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'risk'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('amountSpent');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([apiGetAccounts(), apiGetSummary()])
      .then(([accs, sum]) => {
        if (!alive) return;
        setAccounts(accs);
        setSummary(sum);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const statusOptions = useMemo(() => {
    const set = new Map<number, string>();
    for (const a of accounts) set.set(a.status, a.statusLabel);
    return [...set.entries()].sort((a, b) => a[0] - b[0]);
  }, [accounts]);

  const filtered = useMemo(() => {
    let list = accounts;
    const q = search.trim().toLowerCase();
    if (q)
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.id.includes(q) ||
          (a.businessName?.toLowerCase().includes(q) ?? false),
      );
    if (statusFilter === 'active') list = list.filter((a) => a.status === 1);
    else if (statusFilter === 'inactive') list = list.filter((a) => a.status !== 1);
    else if (statusFilter === 'risk')
      list = list.filter((a) => a.pctUsed != null && a.pctUsed >= 75);

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // Nulos (ex.: "Sem limite") sempre no fim, independente da direção.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string' && typeof bv === 'string') {
        return av.localeCompare(bv, 'pt-BR') * dir;
      }
      return ((av as number) - (bv as number)) * dir;
    });
  }, [accounts, search, statusFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  }

  const arrow = (key: SortKey) => (key === sortKey ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <>
      <div className="cards">
        <div className="card">
          <div className="label">Total de contas</div>
          <div className="value">{summary?.totalAccounts ?? '—'}</div>
        </div>
        <div className="card accent">
          <div className="label">Contas ativas</div>
          <div className="value">{summary?.activeAccounts ?? '—'}</div>
        </div>
        <div className="card warn">
          <div className="label">Perto do limite (≥75%)</div>
          <div className="value">{summary?.nearLimit ?? '—'}</div>
        </div>
        <div className="card danger">
          <div className="label">Não ativas</div>
          <div className="value">{summary?.notActive ?? '—'}</div>
        </div>
        <div className="card">
          <div className="label">Gasto acumulado</div>
          <div className="value small">
            {summary ? <MoneyByCurrency map={summary.spentByCurrency} /> : '—'}
          </div>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="input search"
          placeholder="Buscar por nome ou id da conta…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        >
          <option value="all">Todos os status</option>
          <option value="active">Somente ativas</option>
          <option value="inactive">Somente não ativas</option>
          <option value="risk">Em risco (≥75%)</option>
        </select>
        <span className="muted">{filtered.length} contas</span>
      </div>

      {statusOptions.length > 0 && summary && summary.notActive > 0 && (
        <div className="banner">
          ⚠️ {summary.notActive} conta(s) não estão ativas — verifique status de pagamento/risco.
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={c.num ? 'num' : ''}
                  onClick={() => toggleSort(c.key)}
                >
                  {c.label}
                  {arrow(c.key)}
                </th>
              ))}
              <th className="no-sort">Moeda</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="empty">
                  Carregando…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  Nenhuma conta encontrada.
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((a) => {
                const level = riskLevel(a.pctUsed);
                const rowCls =
                  level === 'danger' ? 'row-danger' : level === 'warn' ? 'row-warn' : '';
                return (
                  <tr key={a.id} className={rowCls}>
                    <td>
                      <strong>{a.name}</strong>
                      {a.businessName && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          🏢 {a.businessName}
                        </div>
                      )}
                      <div className="muted" style={{ fontSize: 11, opacity: 0.7 }}>
                        {a.id}
                      </div>
                    </td>
                    <td>
                      <StatusBadge account={a} />
                    </td>
                    <td className="num">
                      {a.spendCap == null ? (
                        <span className="muted">Sem limite</span>
                      ) : (
                        formatMoney(a.spendCap, a.currency)
                      )}
                    </td>
                    <td className="num">{formatMoney(a.amountSpent, a.currency)}</td>
                    <td className="num">
                      {a.available == null ? (
                        <span className="muted">—</span>
                      ) : (
                        formatMoney(a.available, a.currency)
                      )}
                    </td>
                    <td className="num">
                      <UsageBar pctUsed={a.pctUsed} />
                    </td>
                    <td>
                      <span className="badge muted">{a.currency || '—'}</span>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </>
  );
}
