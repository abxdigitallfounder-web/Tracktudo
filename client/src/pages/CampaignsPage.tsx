import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  apiGetCampaigns,
  apiSyncCampaigns,
  apiGetStatus,
  apiGetAccounts,
  apiSetCampaignStatus,
  apiGetCampaignStatusLog,
  type CampaignRow,
  type Account,
  type CampaignStatusLogEntry,
} from '../api';
import { formatMoney, formatNumber } from '../format';
import { AccountPickerModal } from '../components/AccountPickerModal';

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativa',
  PAUSED: 'Pausada',
  DELETED: 'Excluída',
  ARCHIVED: 'Arquivada',
  CAMPAIGN_PAUSED: 'Pausada',
  ADSET_PAUSED: 'Conjunto pausado',
  PENDING_REVIEW: 'Em revisão',
  DISAPPROVED: 'Reprovada',
  WITH_ISSUES: 'Com problemas',
  IN_PROCESS: 'Em processo',
  PENDING_BILLING_INFO: 'Pagamento pendente',
};

function statusLabel(s: string): string {
  return STATUS_LABELS[s] ?? s;
}

function ratio(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return numerator / denominator;
}

/** Linha de campanha com as métricas derivadas já calculadas (custo por X, ROI). */
interface RowMetrics extends CampaignRow {
  budgetValue: number;
  cpc: number | null;
  cpv: number | null;
  custoIC: number | null;
  cpa: number | null;
  roi: number | null;
}

function computeMetrics(r: CampaignRow): RowMetrics {
  return {
    ...r,
    budgetValue: r.dailyBudget ?? r.lifetimeBudget ?? 0,
    cpc: ratio(r.spend, r.clicks),
    cpv: ratio(r.spend, r.pageViews),
    custoIC: ratio(r.spend, r.initiateCheckout),
    cpa: ratio(r.spend, r.sales),
    roi: r.spend > 0 ? ((r.revenue - r.spend) / r.spend) * 100 : null,
  };
}

type SortKey =
  | 'name'
  | 'budgetValue'
  | 'spend'
  | 'clicks'
  | 'cpc'
  | 'pageViews'
  | 'cpv'
  | 'initiateCheckout'
  | 'custoIC'
  | 'sales'
  | 'cpa'
  | 'pendingSales'
  | 'roi';

const COLUMNS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: 'budgetValue', label: 'Orçamento', num: true },
  { key: 'spend', label: 'Gastos', num: true },
  { key: 'clicks', label: 'Cliques', num: true },
  { key: 'cpc', label: 'CPC', num: true },
  { key: 'pageViews', label: 'Vis. de Pág.', num: true },
  { key: 'cpv', label: 'CPV', num: true },
  { key: 'initiateCheckout', label: 'IC', num: true },
  { key: 'custoIC', label: 'Custo de IC', num: true },
  { key: 'sales', label: 'Vendas', num: true },
  { key: 'cpa', label: 'Custo/Venda', num: true },
  { key: 'pendingSales', label: 'Vendas Pendentes', num: true },
  { key: 'roi', label: 'ROI', num: true },
];

export function CampaignsPage({ reloadKey }: { reloadKey: number }) {
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [untrackedSales, setUntrackedSales] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<CampaignStatusLogEntry[]>([]);

  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');

  const [since, setSince] = useState(() => ymd(new Date()));
  const [until, setUntil] = useState(() => ymd(new Date()));
  const [sortKey, setSortKey] = useState<SortKey>('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Contas carregam sempre (precisa delas pro seletor), campanhas só sob demanda.
  useEffect(() => {
    apiGetAccounts()
      .then(setAccounts)
      .catch(() => {});
  }, []);

  const load = useCallback(
    async (showLoading: boolean) => {
      if (selectedAccountIds.length === 0) {
        setRows([]);
        setUntrackedSales(0);
        return;
      }
      if (showLoading) setLoading(true);
      try {
        const [resp, st] = await Promise.all([
          apiGetCampaigns({
            since,
            until,
            search: search.trim() || undefined,
            status: statusFilter || undefined,
            accountIds: selectedAccountIds,
            product: productFilter || undefined,
          }),
          apiGetStatus().catch(() => null),
        ]);
        setRows(resp.rows);
        setUntrackedSales(resp.untrackedSales);
        if (st) {
          setSyncing(st.campaignsSyncing ?? false);
          setLastSync(st.lastCampaignSync ?? null);
        }
      } catch {
        /* backend pode estar reiniciando */
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [since, until, search, statusFilter, productFilter, selectedAccountIds],
  );

  useEffect(() => {
    load(true);
  }, [load, reloadKey]);

  async function handleSync() {
    setSyncing(true);
    try {
      await apiSyncCampaigns();
      await new Promise<void>((resolve) => {
        const iv = setInterval(async () => {
          try {
            const st = await apiGetStatus();
            if (!st.campaignsSyncing) {
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

  async function handleToggleStatus(row: CampaignRow) {
    const newStatus = row.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setTogglingId(row.id);
    setToggleError(null);
    // Otimista: já reflete na tela, reverte se a Meta recusar.
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, status: newStatus, effectiveStatus: newStatus } : r)),
    );
    try {
      const result = await apiSetCampaignStatus(row.id, newStatus);
      if (!result.ok) {
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id ? { ...r, status: row.status, effectiveStatus: row.effectiveStatus } : r,
          ),
        );
        setToggleError(`"${row.name}": ${result.error ?? 'falha ao alterar status'}`);
      }
    } catch (err) {
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id ? { ...r, status: row.status, effectiveStatus: row.effectiveStatus } : r,
        ),
      );
      setToggleError(`"${row.name}": ${(err as Error).message}`);
    } finally {
      setTogglingId(null);
    }
  }

  async function openHistory() {
    setHistoryOpen(true);
    try {
      setHistory(await apiGetCampaignStatusLog(50));
    } catch {
      setHistory([]);
    }
  }

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
    setSince(ymd(d));
    setUntil(ymd(d));
  }

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.effectiveStatus);
    return [...set].sort();
  }, [rows]);

  const productOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.product) set.add(r.product);
    return [...set].sort();
  }, [rows]);

  const rowsWithMetrics = useMemo(() => rows.map(computeMetrics), [rows]);

  const sortedRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rowsWithMetrics].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string' && typeof bv === 'string') {
        return av.localeCompare(bv, 'pt-BR') * dir;
      }
      return ((av as number) - (bv as number)) * dir;
    });
  }, [rowsWithMetrics, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  }
  const arrow = (key: SortKey) => (key === sortKey ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  const totals = useMemo(() => {
    const accountSet = new Set(rows.map((r) => r.accountId));
    return rows.reduce(
      (acc, r) => ({
        budget: acc.budget + (r.dailyBudget ?? r.lifetimeBudget ?? 0),
        spend: acc.spend + r.spend,
        clicks: acc.clicks + r.clicks,
        pageViews: acc.pageViews + r.pageViews,
        initiateCheckout: acc.initiateCheckout + r.initiateCheckout,
        sales: acc.sales + r.sales,
        pendingSales: acc.pendingSales + r.pendingSales,
        revenue: acc.revenue + r.revenue,
        accounts: accountSet.size,
      }),
      {
        budget: 0,
        spend: 0,
        clicks: 0,
        pageViews: 0,
        initiateCheckout: 0,
        sales: 0,
        pendingSales: 0,
        revenue: 0,
        accounts: 0,
      },
    );
  }, [rows]);

  const mainCurrency = rows[0]?.currency ?? 'BRL';
  const selectedNames = useMemo(
    () =>
      selectedAccountIds
        .map((id) => accounts.find((a) => a.id === id)?.name ?? id)
        .join(', '),
    [selectedAccountIds, accounts],
  );

  return (
    <>
      <div className="toolbar">
        <button className="btn primary" onClick={() => setPickerOpen(true)}>
          📁 {selectedAccountIds.length > 0 ? `${selectedAccountIds.length} conta(s) selecionada(s)` : 'Selecionar contas de anúncio'}
        </button>
        {selectedAccountIds.length > 0 && (
          <span className="muted" style={{ fontSize: 12, maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selectedNames}
          </span>
        )}
        <span className="spacer" />
        <span className="muted">
          {syncing ? '🔄 Sincronizando campanhas…' : lastSync ? `Atualizado ${new Date(lastSync).toLocaleString('pt-BR')}` : 'Nunca sincronizado'}
        </span>
        <button className="btn" onClick={handleSync} disabled={syncing}>
          {syncing ? 'Sincronizando…' : 'Sincronizar campanhas'}
        </button>
        <button className="btn" onClick={openHistory}>
          🕐 Histórico
        </button>
      </div>

      {toggleError && (
        <div className="banner" style={{ borderColor: 'var(--danger)' }}>
          ⚠️ Não foi possível alterar {toggleError}
        </div>
      )}

      {historyOpen && (
        <div className="modal-overlay" onClick={() => setHistoryOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3 style={{ margin: 0 }}>🕐 Histórico de ativações/pausas</h3>
              <button className="icon-btn" onClick={() => setHistoryOpen(false)} title="Fechar">
                ✕
              </button>
            </div>
            <div className="modal-list">
              {history.length === 0 && (
                <div className="muted center">Nenhuma alteração registrada ainda.</div>
              )}
              {history.map((h) => (
                <div key={h.id} className="check-row" style={{ cursor: 'default' }}>
                  <span style={{ flex: 1 }}>
                    <strong>{h.campaign_name}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {statusLabel(h.old_status)} → {statusLabel(h.new_status)} ·{' '}
                      {new Date(h.changed_at).toLocaleString('pt-BR')}
                    </div>
                  </span>
                </div>
              ))}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setHistoryOpen(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {pickerOpen && (
        <AccountPickerModal
          accounts={accounts}
          initialSelected={selectedAccountIds}
          onClose={() => setPickerOpen(false)}
          onConfirm={(ids) => {
            setSelectedAccountIds(ids);
            setPickerOpen(false);
          }}
        />
      )}

      {selectedAccountIds.length === 0 ? (
        <div className="empty" style={{ marginTop: 40 }}>
          Selecione uma ou mais contas de anúncio acima para ver as campanhas.
        </div>
      ) : (
        <>
          {untrackedSales > 0 && (
            <div className="banner">
              ⚠️ {untrackedSales} venda(s) não trackeada(s) — sem campanha correspondente
              identificada no período.
            </div>
          )}

          <div className="toolbar">
            <input
              className="input"
              placeholder="Filtrar por nome da campanha…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Qualquer status</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
            <select className="select" value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
              <option value="">Qualquer produto</option>
              {productOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="toolbar">
            <label className="muted">
              De&nbsp;
              <input type="date" className="input" value={since} max={until} onChange={(e) => setSince(e.target.value)} />
            </label>
            <label className="muted">
              Até&nbsp;
              <input type="date" className="input" value={until} min={since} max={ymd(new Date())} onChange={(e) => setUntil(e.target.value)} />
            </label>
            <button className="btn" onClick={() => setSingleDay(0)}>Hoje</button>
            <button className="btn" onClick={() => setSingleDay(1)}>Ontem</button>
            <button className="btn" onClick={() => setPreset(7)}>7 dias</button>
            <button className="btn" onClick={() => setPreset(30)}>30 dias</button>
            <span className="spacer" />
            <span className="muted">{rows.length} campanhas</span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="no-sort">Status</th>
                  <th className="no-sort" onClick={() => toggleSort('name')} style={{ cursor: 'pointer' }}>
                    Campanha{arrow('name')}
                  </th>
                  <th className="no-sort">Conta</th>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className={c.num ? 'num' : ''}
                      onClick={() => toggleSort(c.key)}
                      style={{ cursor: 'pointer' }}
                    >
                      {c.label}
                      {arrow(c.key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={15} className="empty">Carregando…</td>
                  </tr>
                )}
                {!loading && sortedRows.length === 0 && (
                  <tr>
                    <td colSpan={15} className="empty">
                      Nenhuma campanha encontrada nessas contas/período. Clique em "Sincronizar
                      campanhas" para buscar da Meta.
                    </td>
                  </tr>
                )}
                {!loading &&
                  sortedRows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <label className="toggle-switch" title={statusLabel(r.effectiveStatus)}>
                          <input
                            type="checkbox"
                            checked={r.status === 'ACTIVE'}
                            disabled={togglingId === r.id}
                            onChange={() => handleToggleStatus(r)}
                          />
                          <span className="slider" />
                        </label>
                        {r.effectiveStatus !== r.status && (
                          <div className="muted" style={{ fontSize: 11 }}>
                            {statusLabel(r.effectiveStatus)}
                          </div>
                        )}
                      </td>
                      <td>{r.name}</td>
                      <td>
                        {r.accountName}
                        <div className="muted" style={{ fontSize: 11 }}>
                          <span className="badge muted">{r.accountStatusLabel}</span>
                        </div>
                      </td>
                      <td className="num">
                        {r.dailyBudget != null
                          ? `${formatMoney(r.dailyBudget, r.currency)}/dia`
                          : r.lifetimeBudget != null
                            ? `${formatMoney(r.lifetimeBudget, r.currency)} (vitalício)`
                            : <span className="muted">N/A</span>}
                      </td>
                      <td className="num">{formatMoney(r.spend, r.currency)}</td>
                      <td className="num">{formatNumber(r.clicks, 0)}</td>
                      <td className="num">{r.cpc != null ? formatMoney(r.cpc, r.currency) : <span className="muted">N/A</span>}</td>
                      <td className="num">{formatNumber(r.pageViews, 0)}</td>
                      <td className="num">{r.cpv != null ? formatMoney(r.cpv, r.currency) : <span className="muted">N/A</span>}</td>
                      <td className="num">{formatNumber(r.initiateCheckout, 0)}</td>
                      <td className="num">{r.custoIC != null ? formatMoney(r.custoIC, r.currency) : <span className="muted">N/A</span>}</td>
                      <td className="num">{r.sales}</td>
                      <td className="num">{r.cpa != null ? formatMoney(r.cpa, r.currency) : <span className="muted">N/A</span>}</td>
                      <td className="num">{r.pendingSales}</td>
                      <td className={`num ${r.roi != null ? (r.roi >= 0 ? 'pos-text' : 'neg-text') : ''}`}>
                        {r.roi != null ? `${r.roi.toFixed(1)}%` : <span className="muted">N/A</span>}
                      </td>
                    </tr>
                  ))}
              </tbody>
              {!loading && sortedRows.length > 0 && (
                <tfoot>
                  <tr className="total-row">
                    <td colSpan={2}>{sortedRows.length} CAMPANHAS</td>
                    <td>{totals.accounts} CONTA(S)</td>
                    <td className="num">{formatMoney(totals.budget, mainCurrency)}</td>
                    <td className="num">{formatMoney(totals.spend, mainCurrency)}</td>
                    <td className="num">{formatNumber(totals.clicks, 0)}</td>
                    <td className="num">—</td>
                    <td className="num">{formatNumber(totals.pageViews, 0)}</td>
                    <td className="num">—</td>
                    <td className="num">{formatNumber(totals.initiateCheckout, 0)}</td>
                    <td className="num">—</td>
                    <td className="num">{totals.sales}</td>
                    <td className="num">—</td>
                    <td className="num">{totals.pendingSales}</td>
                    <td className="num">{formatMoney(totals.revenue, mainCurrency)} receita</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </>
  );
}
