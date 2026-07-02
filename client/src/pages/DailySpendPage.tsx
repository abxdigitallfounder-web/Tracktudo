import { useEffect, useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  apiGetAccounts,
  apiGetDailySpend,
  type Account,
  type DailySpendRow,
} from '../api';
import { formatMoney, formatDayMonth, formatNumber } from '../format';

// Paleta para as linhas do gráfico (uma por moeda).
const CURRENCY_COLORS = ['#4f46e5', '#16a34a', '#f59e0b', '#dc2626', '#0ea5e9', '#a855f7'];

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

export function DailySpendPage({ reloadKey }: { reloadKey: number }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [rows, setRows] = useState<DailySpendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [accountFilter, setAccountFilter] = useState<string>('all');

  const [since, setSince] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return ymd(d);
  });
  const [until, setUntil] = useState(() => ymd(new Date()));

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([apiGetAccounts(), apiGetDailySpend(since, until)])
      .then(([accs, spend]) => {
        if (!alive) return;
        setAccounts(accs);
        setRows(spend);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [since, until, reloadKey]);

  const accById = useMemo(() => {
    const m = new Map<string, Account>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);

  const days = useMemo(() => daysBetween(since, until), [since, until]);

  // Filtra as linhas conforme a conta selecionada.
  const visibleRows = useMemo(
    () => (accountFilter === 'all' ? rows : rows.filter((r) => r.account_id === accountFilter)),
    [rows, accountFilter],
  );

  // Moedas presentes (para não somar moedas diferentes).
  const currencies = useMemo(() => {
    const set = new Set<string>();
    for (const r of visibleRows) {
      const cur = accById.get(r.account_id)?.currency || '—';
      set.add(cur);
    }
    return [...set].sort();
  }, [visibleRows, accById]);

  // Dados do gráfico: total por dia, uma série por moeda.
  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, number>>();
    for (const d of days) byDate.set(d, {});
    for (const r of visibleRows) {
      const cur = accById.get(r.account_id)?.currency || '—';
      const slot = byDate.get(r.date);
      if (slot) slot[cur] = (slot[cur] ?? 0) + r.spend;
    }
    return days.map((d) => ({ date: formatDayMonth(d), ...byDate.get(d) }));
  }, [days, visibleRows, accById]);

  // Matriz conta -> (dia -> gasto).
  const matrix = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const r of visibleRows) {
      if (!map.has(r.account_id)) map.set(r.account_id, new Map());
      map.get(r.account_id)!.set(r.date, r.spend);
    }
    // Ordena contas por total do período (desc).
    const list = [...map.entries()].map(([id, byDay]) => {
      const total = [...byDay.values()].reduce((s, v) => s + v, 0);
      return { id, byDay, total };
    });
    list.sort((a, b) => b.total - a.total);
    return list;
  }, [visibleRows]);

  // Totais por moeda: por dia e geral.
  const totalsByCurrency = useMemo(() => {
    const map = new Map<string, { perDay: Map<string, number>; total: number }>();
    for (const r of visibleRows) {
      const cur = accById.get(r.account_id)?.currency || '—';
      if (!map.has(cur)) map.set(cur, { perDay: new Map(), total: 0 });
      const entry = map.get(cur)!;
      entry.perDay.set(r.date, (entry.perDay.get(r.date) ?? 0) + r.spend);
      entry.total += r.spend;
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visibleRows, accById]);

  function setPreset(daysBack: number) {
    const u = new Date();
    const s = new Date();
    s.setDate(s.getDate() - (daysBack - 1));
    setSince(ymd(s));
    setUntil(ymd(u));
  }

  return (
    <>
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
        <select
          className="select"
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
        >
          <option value="all">Todas as contas</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.businessName ? ` — ${a.businessName}` : ''} ({a.currency})
            </option>
          ))}
        </select>
      </div>

      {currencies.length > 1 && (
        <div className="banner">
          ⚠️ Há mais de uma moeda no período ({currencies.join(', ')}). Os valores NÃO são somados
          entre moedas — cada uma tem sua própria linha/total.
        </div>
      )}

      <div className="panel">
        <h3>Gasto total por dia {accountFilter !== 'all' ? '(conta selecionada)' : '(todas as contas)'}</h3>
        {loading ? (
          <div className="empty">Carregando…</div>
        ) : chartData.length === 0 ? (
          <div className="empty">Sem dados no período.</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
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
              {currencies.map((cur, i) => (
                <Line
                  key={cur}
                  type="monotone"
                  dataKey={cur}
                  name={cur}
                  stroke={CURRENCY_COLORS[i % CURRENCY_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="no-sort">Conta</th>
              <th className="no-sort">Moeda</th>
              {days.map((d) => (
                <th key={d} className="num no-sort">
                  {formatDayMonth(d)}
                </th>
              ))}
              <th className="num no-sort">Total</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={days.length + 3} className="empty">
                  Carregando…
                </td>
              </tr>
            )}
            {!loading && matrix.length === 0 && (
              <tr>
                <td colSpan={days.length + 3} className="empty">
                  Sem gastos no período.
                </td>
              </tr>
            )}
            {!loading &&
              matrix.map(({ id, byDay, total }) => {
                const acc = accById.get(id);
                const cur = acc?.currency || '—';
                return (
                  <tr key={id}>
                    <td>
                      <strong>{acc?.name ?? id}</strong>
                      {acc?.businessName && (
                        <div className="muted" style={{ fontSize: 11 }}>
                          🏢 {acc.businessName}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="badge muted">{cur}</span>
                    </td>
                    {days.map((d) => {
                      const v = byDay.get(d);
                      return (
                        <td key={d} className="num">
                          {v == null ? (
                            <span className="muted">·</span>
                          ) : (
                            formatNumber(v)
                          )}
                        </td>
                      );
                    })}
                    <td className="num">
                      <strong>{formatMoney(total, cur)}</strong>
                    </td>
                  </tr>
                );
              })}
          </tbody>
          {!loading && totalsByCurrency.length > 0 && (
            <tfoot>
              {totalsByCurrency.map(([cur, { perDay, total }]) => (
                <tr key={cur} className="total-row">
                  <td>Total</td>
                  <td>
                    <span className="badge muted">{cur}</span>
                  </td>
                  {days.map((d) => (
                    <td key={d} className="num">
                      {perDay.get(d) != null ? formatNumber(perDay.get(d)!) : '·'}
                    </td>
                  ))}
                  <td className="num">{formatMoney(total, cur)}</td>
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
      <p className="currency-note">
        Células mostram o valor no idioma da moeda de cada conta. A coluna “Total” e a linha “Total”
        respeitam a moeda (uma linha de total por moeda).
      </p>
    </>
  );
}
