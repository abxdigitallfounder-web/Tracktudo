import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  apiGetSalesSummary,
  apiGetRevenue,
  apiGetSales,
  apiSyncSales,
  apiGetStatus,
  type SalesSummary,
  type RevenueRow,
  type Sale,
} from '../api';
import { formatMoney, formatDayMonth } from '../format';
import { MoneyByCurrency } from '../components/widgets';

// Paleta para as barras (uma por moeda).
const CURRENCY_COLORS = ['#16a34a', '#4f46e5', '#f59e0b', '#dc2626', '#0ea5e9'];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function daysBetween(since: string, until: string): string[] {
  const out: string[] = [];
  const cur = new Date(since + 'T00:00:00');
  const end = new Date(until + 'T00:00:00');
  while (cur <= end) {
    out.push(ymd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Data/hora "2026-07-06 14:30:00" ou ISO -> "06/07 14:30". */
function formatDateTime(s: string | null): string {
  if (!s) return '—';
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  const d = new Date(iso);
  if (isNaN(d.getTime())) return s;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(
    2,
    '0',
  )} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Formata um mapa moeda->valor como texto inline: "R$ 10,00 · US$ 5,00". */
function moneyMapText(map: Record<string, number>): string {
  const e = Object.entries(map);
  if (e.length === 0) return 'R$ 0,00';
  return e.map(([c, v]) => formatMoney(v, c)).join(' · ');
}

function statusClass(status: number): string {
  if (status === 2 || status === 10) return 'row-ok';
  if (status === 7 || status === 9 || status === 5 || status === 6) return 'row-danger';
  if (status === 1 || status === 3) return 'row-warn';
  return '';
}

export function RevenuePage({ reloadKey }: { reloadKey: number }) {
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [revenue, setRevenue] = useState<RevenueRow[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [apiEnabled, setApiEnabled] = useState<boolean | null>(null);

  const [since, setSince] = useState(() => ymd(new Date()));
  const [until, setUntil] = useState(() => ymd(new Date()));

  const load = useCallback(
    async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      try {
        const [sum, rev, sal, st] = await Promise.all([
          apiGetSalesSummary(),
          apiGetRevenue(since, until),
          apiGetSales(50),
          apiGetStatus().catch(() => null),
        ]);
        setSummary(sum);
        setRevenue(rev);
        setSales(sal);
        if (st) {
          setApiEnabled(st.salesApiEnabled ?? false);
          setSyncing(st.salesSyncing ?? false);
        }
      } catch {
        /* backend pode estar reiniciando */
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [since, until],
  );

  useEffect(() => {
    load(true);
  }, [load, reloadKey]);

  // Tempo real: atualiza a cada 20s sem piscar a tela.
  useEffect(() => {
    const t = setInterval(() => load(false), 20000);
    return () => clearInterval(t);
  }, [load]);

  async function handleSync() {
    setSyncing(true);
    try {
      await apiSyncSales();
      // Aguarda a sincronização terminar (polling do /api/status).
      await new Promise<void>((resolve) => {
        const iv = setInterval(async () => {
          try {
            const st = await apiGetStatus();
            if (!st.salesSyncing) {
              clearInterval(iv);
              resolve();
            }
          } catch {
            /* ignora */
          }
        }, 2000);
      });
      await load(false);
    } finally {
      setSyncing(false);
    }
  }

  const days = useMemo(() => daysBetween(since, until), [since, until]);

  const currencies = useMemo(() => {
    const set = new Set<string>();
    for (const r of revenue) set.add(r.currency);
    return [...set].sort();
  }, [revenue]);

  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, number>>();
    for (const d of days) byDate.set(d, {});
    for (const r of revenue) {
      const slot = byDate.get(r.date);
      if (slot) slot[r.currency] = (slot[r.currency] ?? 0) + r.revenue;
    }
    return days.map((d) => ({ date: formatDayMonth(d), ...byDate.get(d) }));
  }, [days, revenue]);

  const periodByCurrency = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of revenue) m[r.currency] = (m[r.currency] ?? 0) + r.revenue;
    return m;
  }, [revenue]);
  const periodCount = useMemo(() => revenue.reduce((s, r) => s + r.count, 0), [revenue]);

  function setPreset(daysBack: number) {
    const u = new Date();
    const s = new Date();
    s.setDate(s.getDate() - (daysBack - 1));
    setSince(ymd(s));
    setUntil(ymd(u));
  }

  function setSingleDay(daysAgo: number) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    const day = ymd(d);
    setSince(day);
    setUntil(day);
  }

  const hasAnySale = (summary?.approvedCount ?? 0) > 0 || sales.length > 0;

  return (
    <>
      <div className="cards">
        <div className="card accent">
          <div className="label">Faturamento hoje</div>
          <div className="value small">
            {summary ? <MoneyByCurrency map={summary.todayRevenueByCurrency} /> : '—'}
          </div>
        </div>
        <div className="card">
          <div className="label">Vendas hoje</div>
          <div className="value">{summary?.todayCount ?? '—'}</div>
        </div>
        <div className="card">
          <div className="label">Faturamento total aprovado</div>
          <div className="value small">
            {summary ? <MoneyByCurrency map={summary.revenueApprovedByCurrency} /> : '—'}
          </div>
        </div>
        <div className="card warn">
          <div className="label">Pendentes</div>
          <div className="value">{summary?.pendingCount ?? '—'}</div>
        </div>
        <div className="card danger">
          <div className="label">Reembolsos / chargebacks</div>
          <div className="value small">
            {summary
              ? `${summary.refundedCount} · ${moneyMapText(summary.refundedAmountByCurrency)}`
              : '—'}
          </div>
        </div>
      </div>

      <div className="toolbar">
        <label className="muted">
          De&nbsp;
          <input
            type="date"
            className="input"
            value={since}
            max={until}
            onChange={(e) => setSince(e.target.value)}
          />
        </label>
        <label className="muted">
          Até&nbsp;
          <input
            type="date"
            className="input"
            value={until}
            min={since}
            max={ymd(new Date())}
            onChange={(e) => setUntil(e.target.value)}
          />
        </label>
        <button className="btn" onClick={() => setSingleDay(0)}>
          Hoje
        </button>
        <button className="btn" onClick={() => setSingleDay(1)}>
          Ontem
        </button>
        <button className="btn" onClick={() => setPreset(7)}>
          7 dias
        </button>
        <button className="btn" onClick={() => setPreset(15)}>
          15 dias
        </button>
        <button className="btn" onClick={() => setPreset(30)}>
          30 dias
        </button>
        <span className="spacer" />
        {apiEnabled && (
          <button className="btn primary" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Sincronizando…' : 'Sincronizar vendas'}
          </button>
        )}
        <span className="muted" style={{ fontSize: 12 }}>
          🔴 Atualiza a cada 20s
        </span>
      </div>

      {!loading && !hasAnySale && (
        <div className="banner">
          ⚠️ Nenhuma venda ainda.{' '}
          {apiEnabled
            ? 'Clique em "Sincronizar vendas" para puxar o histórico da PerfectPay via API.'
            : 'Configure o PERFECTPAY_API_TOKEN para sincronizar as vendas.'}
        </div>
      )}

      <div className="panel">
        <h3>
          Faturamento por dia — {periodCount} venda(s) no período ({moneyMapText(periodByCurrency)})
        </h3>
        {loading ? (
          <div className="empty">Carregando…</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={12} />
              <YAxis stroke="var(--text-muted)" fontSize={12} width={70} />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  color: 'var(--text)',
                }}
                formatter={(value, name) => [
                  formatMoney(Number(value), String(name)),
                  String(name),
                ]}
              />
              <Legend />
              {currencies.map((c, i) => (
                <Bar
                  key={c}
                  dataKey={c}
                  name={c}
                  fill={CURRENCY_COLORS[i % CURRENCY_COLORS.length]}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="no-sort">Data</th>
              <th className="no-sort">Produto</th>
              <th className="no-sort">Cliente</th>
              <th className="no-sort">Pagamento</th>
              <th className="no-sort">Status</th>
              <th className="num no-sort">Valor</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="empty">
                  Carregando…
                </td>
              </tr>
            )}
            {!loading && sales.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  Sem vendas registradas.
                </td>
              </tr>
            )}
            {!loading &&
              sales.map((s) => (
                <tr key={s.code} className={statusClass(s.status)}>
                  <td>{formatDateTime(s.dateApproved ?? s.dateCreated ?? s.receivedAt)}</td>
                  <td>
                    <strong>{s.productName ?? '—'}</strong>
                    <div className="muted" style={{ fontSize: 11, opacity: 0.7 }}>
                      {s.code}
                    </div>
                  </td>
                  <td>
                    {s.customerName ?? '—'}
                    {s.customerEmail && (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {s.customerEmail}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="badge muted">{s.paymentLabel}</span>
                  </td>
                  <td>
                    <span className="badge">{s.statusLabel}</span>
                  </td>
                  <td className="num">{formatMoney(s.saleAmount, s.currency)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
