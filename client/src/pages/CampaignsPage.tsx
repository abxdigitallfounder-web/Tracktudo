import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  apiGetCampaigns,
  apiSyncCampaigns,
  apiGetStatus,
  apiGetAccounts,
  type CampaignRow,
  type Account,
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

function statusDotClass(s: string): string {
  if (s === 'ACTIVE') return 'ok';
  if (s === 'DISAPPROVED' || s === 'WITH_ISSUES') return 'danger';
  return 'muted';
}

function ratio(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return numerator / denominator;
}

export function CampaignsPage({ reloadKey }: { reloadKey: number }) {
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [untrackedSales, setUntrackedSales] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');

  const [since, setSince] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return ymd(d);
  });
  const [until, setUntil] = useState(() => ymd(new Date()));

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

  const totals = useMemo(() => {
    const accountSet = new Set(rows.map((r) => r.accountId));
    return rows.reduce(
      (acc, r) => ({
        budget: acc.budget + (r.dailyBudget ?? r.lifetimeBudget ?? 0),
        spend: acc.spend + r.spend,
        clicks: acc.clicks + r.clicks,
        pageViews: acc.pageViews + r.pageViews,
        sales: acc.sales + r.sales,
        pendingSales: acc.pendingSales + r.pendingSales,
        revenue: acc.revenue + r.revenue,
        accounts: accountSet.size,
      }),
      { budget: 0, spend: 0, clicks: 0, pageViews: 0, sales: 0, pendingSales: 0, revenue: 0, accounts: 0 },
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
      </div>

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
                  <th className="no-sort">Campanha</th>
                  <th className="no-sort">Conta</th>
                  <th className="num no-sort">Orçamento</th>
                  <th className="num no-sort">Gastos</th>
                  <th className="num no-sort">Vendas</th>
                  <th className="num no-sort">Vendas Pendentes</th>
                  <th className="num no-sort">Cliques</th>
                  <th className="num no-sort">CPC</th>
                  <th className="num no-sort">Vis. de Pág.</th>
                  <th className="num no-sort">CPV</th>
                  <th className="num no-sort">ROI</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={12} className="empty">Carregando…</td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={12} className="empty">
                      Nenhuma campanha encontrada nessas contas/período. Clique em "Sincronizar
                      campanhas" para buscar da Meta.
                    </td>
                  </tr>
                )}
                {!loading &&
                  rows.map((r) => {
                    const cpc = ratio(r.spend, r.clicks);
                    const cpv = ratio(r.spend, r.pageViews);
                    const roi = r.spend > 0 ? ((r.revenue - r.spend) / r.spend) * 100 : null;
                    return (
                      <tr key={r.id}>
                        <td>
                          <span className={`dot ${statusDotClass(r.effectiveStatus)}`} />{' '}
                          <span className="muted" style={{ fontSize: 12 }}>{statusLabel(r.effectiveStatus)}</span>
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
                        <td className="num">{r.sales}</td>
                        <td className="num">{r.pendingSales}</td>
                        <td className="num">{formatNumber(r.clicks, 0)}</td>
                        <td className="num">{cpc != null ? formatMoney(cpc, r.currency) : <span className="muted">N/A</span>}</td>
                        <td className="num">{formatNumber(r.pageViews, 0)}</td>
                        <td className="num">{cpv != null ? formatMoney(cpv, r.currency) : <span className="muted">N/A</span>}</td>
                        <td className={`num ${roi != null ? (roi >= 0 ? 'pos-text' : 'neg-text') : ''}`}>
                          {roi != null ? `${roi.toFixed(1)}%` : <span className="muted">N/A</span>}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
              {!loading && rows.length > 0 && (
                <tfoot>
                  <tr className="total-row">
                    <td colSpan={2}>{rows.length} CAMPANHAS</td>
                    <td>{totals.accounts} CONTA(S)</td>
                    <td className="num">{formatMoney(totals.budget, mainCurrency)}</td>
                    <td className="num">{formatMoney(totals.spend, mainCurrency)}</td>
                    <td className="num">{totals.sales}</td>
                    <td className="num">{totals.pendingSales}</td>
                    <td className="num">{formatNumber(totals.clicks, 0)}</td>
                    <td className="num">—</td>
                    <td className="num">{formatNumber(totals.pageViews, 0)}</td>
                    <td className="num">—</td>
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
