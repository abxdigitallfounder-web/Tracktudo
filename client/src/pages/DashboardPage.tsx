import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { apiGetDashboard, type DashboardData } from '../api';
import { formatMoney } from '../format';

// Paleta por índice (os rótulos de pagamento são dinâmicos, vindos dos dados).
const PAYMENT_PALETTE = ['#3b82f6', '#38bdf8', '#eab308', '#a855f7', '#ef4444'];

// Nomes em pt-BR para os códigos ISO de país mais comuns.
const COUNTRY_NAMES: Record<string, string> = {
  BR: 'Brasil', US: 'Estados Unidos', AR: 'Argentina', MX: 'México', ES: 'Espanha',
  CL: 'Chile', CO: 'Colômbia', PE: 'Peru', EC: 'Equador', UY: 'Uruguai', PY: 'Paraguai',
  BO: 'Bolívia', VE: 'Venezuela', DO: 'Rep. Dominicana', CR: 'Costa Rica', PA: 'Panamá',
  GT: 'Guatemala', PT: 'Portugal', CA: 'Canadá', IE: 'Irlanda', CY: 'Chipre', IT: 'Itália',
  FR: 'França', DE: 'Alemanha', GB: 'Reino Unido',
};

/** Converte "AR" -> "🇦🇷" (bandeira via regional indicators). */
function flag(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return '🏳️';
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function pct(v: number | null): string {
  return v == null ? 'N/A' : `${v.toFixed(1)}%`;
}

function signClass(v: number | null): string {
  if (v == null || v === 0) return '';
  return v > 0 ? 'pos' : 'neg';
}

/** Rótulo com título (tooltip nativo) no canto do painel. */
function Info({ text }: { text: string }) {
  return (
    <span className="dp-info" title={text}>
      ⓘ
    </span>
  );
}

/** Mini medidor circular para a taxa de aprovação. */
function Gauge({ value }: { value: number | null }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  const frac = value == null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  return (
    <svg width="34" height="34" viewBox="0 0 34 34">
      <circle cx="17" cy="17" r={r} fill="none" stroke="var(--border)" strokeWidth="4" />
      {value != null && (
        <circle
          cx="17"
          cy="17"
          r={r}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="4"
          strokeDasharray={`${c * frac} ${c}`}
          strokeLinecap="round"
          transform="rotate(-90 17 17)"
        />
      )}
    </svg>
  );
}

export function DashboardPage({ reloadKey }: { reloadKey: number }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const [since, setSince] = useState(() => ymd(new Date()));
  const [until, setUntil] = useState(() => ymd(new Date()));

  const load = useCallback(
    async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      try {
        setData(await apiGetDashboard(since, until));
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

  useEffect(() => {
    const t = setInterval(() => load(false), 20000);
    return () => clearInterval(t);
  }, [load]);

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

  const cur = data?.currency ?? 'BRL';
  const money = (v: number) => formatMoney(v, cur);

  const hourData = useMemo(
    () =>
      (data?.byHour ?? []).map((h) => ({
        hour: `${String(h.hour).padStart(2, '0')}:00`,
        count: h.count,
      })),
    [data],
  );
  const paymentTotal = useMemo(
    () => (data?.byPayment ?? []).reduce((s, p) => s + p.count, 0),
    [data],
  );
  const profitData = useMemo(
    () =>
      (data?.profitByHour ?? []).map((h) => ({
        hour: `${String(h.hour).padStart(2, '0')}:00`,
        profit: h.profit,
      })),
    [data],
  );

  if (loading && !data) {
    return <div className="empty" style={{ marginTop: 40 }}>Carregando…</div>;
  }
  if (!data) return <div className="empty" style={{ marginTop: 40 }}>Sem dados.</div>;

  return (
    <>
      <div className="toolbar">
        <label className="muted">
          De&nbsp;
          <input type="date" className="input" value={since} max={until}
            onChange={(e) => setSince(e.target.value)} />
        </label>
        <label className="muted">
          Até&nbsp;
          <input type="date" className="input" value={until} min={since} max={ymd(new Date())}
            onChange={(e) => setUntil(e.target.value)} />
        </label>
        <button className="btn" onClick={() => setSingleDay(0)}>Hoje</button>
        <button className="btn" onClick={() => setSingleDay(1)}>Ontem</button>
        <button className="btn" onClick={() => setPreset(7)}>7 dias</button>
        <button className="btn" onClick={() => setPreset(15)}>15 dias</button>
        <button className="btn" onClick={() => setPreset(30)}>30 dias</button>
      </div>

      <div className="dash-grid">
        {/* Linha 1: métricas principais */}
        <div className="dash-panel" style={{ gridArea: 'fat' }}>
          <div className="dp-head">
            <span className="dp-title">Faturamento Líquido</span>
            <Info text="Vendas aprovadas menos reembolsos, no período." />
          </div>
          <div className="dp-value">{money(data.netRevenue)}</div>
        </div>
        <div className="dash-panel" style={{ gridArea: 'gastos' }}>
          <div className="dp-head">
            <span className="dp-title">Gastos com anúncios</span>
            <Info text={`Gasto da Meta no período (contas em ${cur}).`} />
          </div>
          <div className="dp-value">{money(data.adSpend)}</div>
        </div>
        <div className="dash-panel" style={{ gridArea: 'roi' }}>
          <div className="dp-head">
            <span className="dp-title">ROI</span>
            <Info text="Retorno sobre o investimento: lucro ÷ gasto com anúncios." />
          </div>
          <div className={`dp-value ${signClass(data.roi)}`}>{pct(data.roi)}</div>
        </div>
        <div className="dash-panel" style={{ gridArea: 'lucro' }}>
          <div className="dp-head">
            <span className="dp-title">Lucro</span>
            <Info text="Faturamento líquido − gastos com anúncios − taxas." />
          </div>
          <div className={`dp-value ${signClass(data.profit)}`}>{money(data.profit)}</div>
        </div>

        {/* Vendas por Pagamento (rosca) */}
        <div className="dash-panel" style={{ gridArea: 'pgto' }}>
          <div className="dp-head">
            <span className="dp-title">Vendas por Pagamento</span>
            <Info text="Distribuição das vendas aprovadas por forma de pagamento." />
          </div>
          <div className="donut-wrap">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={data.byPayment}
                  dataKey="count"
                  nameKey="method"
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {data.byPayment.map((p, i) => (
                    <Cell key={p.method} fill={PAYMENT_PALETTE[i % PAYMENT_PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    color: 'var(--text)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center">
              <div className="dc-label">Total</div>
              <div className="dc-value">{paymentTotal}</div>
            </div>
          </div>
          <div className="dp-legend">
            {data.byPayment.map((p, i) => (
              <span key={p.method}>
                <i className="dot" style={{ background: PAYMENT_PALETTE[i % PAYMENT_PALETTE.length] }} />
                {p.method} ({p.count})
              </span>
            ))}
          </div>
        </div>

        {/* Cards pequenos */}
        <div className="dash-panel" style={{ gridArea: 'pend' }}>
          <div className="dp-head">
            <span className="dp-title">Vendas Pendentes</span>
            <Info text="Valor de vendas com pagamento pendente (boleto/pix aguardando)." />
          </div>
          <div className="dp-value">{money(data.pendingValue)}</div>
        </div>
        <div className="dash-panel" style={{ gridArea: 'margem' }}>
          <div className="dp-head">
            <span className="dp-title">Margem</span>
            <Info text="Lucro ÷ faturamento líquido." />
          </div>
          <div className={`dp-value ${signClass(data.margin)}`}>{pct(data.margin)}</div>
        </div>
        <div className="dash-panel" style={{ gridArea: 'taxas' }}>
          <div className="dp-head">
            <span className="dp-title">Taxas</span>
            <Info text="Taxas da plataforma/gateway (indisponível na API — exibido como 0)." />
          </div>
          <div className="dp-value">{money(data.taxes)}</div>
        </div>

        {/* Vendas por Fonte */}
        <div className="dash-panel" style={{ gridArea: 'fonte' }}>
          <div className="dp-head">
            <span className="dp-title">Vendas por Fonte</span>
            <Info text="Vendas aprovadas por utm_campaign (ID da campanha da Meta)." />
          </div>
          {data.bySource.length === 0 ? (
            <div className="dash-empty">Nenhuma venda por aqui</div>
          ) : (
            <div className="dp-list">
              {data.bySource.map((s) => (
                <div className="dp-list-row" key={s.source}>
                  <span className="nm">{s.source}</span>
                  <span className="muted">
                    {s.count} · {money(s.value)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Taxa de Aprovação */}
        <div className="dash-panel" style={{ gridArea: 'aprov' }}>
          <div className="dp-head">
            <span className="dp-title">Taxa de Aprovação</span>
            <Info text="Vendas aprovadas ÷ total de tentativas, por forma de pagamento." />
          </div>
          <div className="dp-list" style={{ marginTop: 14 }}>
            {data.approval.map((a) => (
              <div className="approval-row" key={a.method}>
                <span>{a.method}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Gauge value={a.rate} />
                  <strong>{pct(a.rate)}</strong>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Vendas por Produto */}
        <div className="dash-panel" style={{ gridArea: 'prod' }}>
          <div className="dp-head">
            <span className="dp-title">Vendas por Produto</span>
            <Info text="Vendas aprovadas por produto." />
          </div>
          {data.byProduct.length === 0 ? (
            <div className="dash-empty">Nenhuma venda por aqui</div>
          ) : (
            <div className="dp-list">
              {data.byProduct.map((p) => (
                <div className="dp-list-row" key={p.product}>
                  <span className="nm">{p.product}</span>
                  <span className="muted">
                    {p.count} · {money(p.value)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Vendas por País */}
        <div className="dash-panel" style={{ gridArea: 'pais' }}>
          <div className="dp-head">
            <span className="dp-title">Vendas por País</span>
            <Info text="Vendas aprovadas por país do cliente (quantidade e valor faturado)." />
          </div>
          {data.byCountry.length === 0 ? (
            <div className="dash-empty">Nenhuma venda por aqui</div>
          ) : (
            <div className="dp-list">
              {data.byCountry.map((c) => (
                <div className="dp-list-row" key={c.country}>
                  <span className="nm">
                    {flag(c.country)} {countryName(c.country)}
                  </span>
                  <span className="muted">
                    {c.count} · {money(c.value)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ROI por País */}
        <div className="dash-panel" style={{ gridArea: 'roipais' }}>
          <div className="dp-head">
            <span className="dp-title">ROI por País</span>
            <Info text="Receita (vendas aprovadas, por país do cliente) vs. gasto de anúncios (Meta, por país do público), no mesmo período e moeda. ROI = (receita − gasto) ÷ gasto." />
          </div>
          {data.roiByCountry.length === 0 ? (
            <div className="dash-empty">Sem dados de receita/gasto por país no período.</div>
          ) : (
            <div className="dp-list">
              {data.roiByCountry.map((c) => (
                <div className="dp-list-row" key={c.country}>
                  <span className="nm">
                    {flag(c.country)} {countryName(c.country)}
                  </span>
                  <span className="muted" style={{ display: 'flex', gap: 10 }}>
                    <span>receita {money(c.revenue)}</span>
                    <span>gasto {money(c.spend)}</span>
                    <strong className={c.roi != null ? (c.roi >= 0 ? 'pos-text' : 'neg-text') : ''}>
                      {c.roi != null ? `${c.roi.toFixed(0)}%` : 'N/A'}
                    </strong>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Vendas por Horário */}
        <div className="dash-panel" style={{ gridArea: 'hora' }}>
          <div className="dp-head">
            <span className="dp-title">Vendas por Horário</span>
            <Info text="Quantidade de vendas aprovadas por hora do dia (aprovação)." />
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hourData} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="hour" stroke="var(--text-muted)" fontSize={10} interval={1} />
              <YAxis stroke="var(--text-muted)" fontSize={11} width={28} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  color: 'var(--text)',
                }}
                formatter={(v) => [String(v), 'Vendas']}
              />
              <Bar dataKey="count" fill="#4f46e5" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Lucro por Horário */}
        <div className="dash-panel" style={{ gridArea: 'lucrohora' }}>
          <div className="dp-head">
            <span className="dp-title">Lucro por Horário</span>
            <Info text="Faturamento de cada hora − parcela do gasto de anúncios (rateado por 24h)." />
          </div>
          <div className="dp-legend" style={{ marginTop: 4, marginBottom: 4 }}>
            <span><i className="dot" style={{ background: '#3b82f6' }} /> Lucro +</span>
            <span><i className="dot" style={{ background: '#b94a3b' }} /> Prejuízo −</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={profitData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="hour" stroke="var(--text-muted)" fontSize={10} interval={0} />
              <YAxis stroke="var(--text-muted)" fontSize={11} width={60}
                tickFormatter={(v) => money(Number(v))} />
              <ReferenceLine y={0} stroke="var(--text-muted)" />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  color: 'var(--text)',
                }}
                formatter={(v) => [money(Number(v)), Number(v) >= 0 ? 'Lucro' : 'Prejuízo']}
              />
              <Bar dataKey="profit" radius={[2, 2, 0, 0]}>
                {profitData.map((d) => (
                  <Cell key={d.hour} fill={d.profit >= 0 ? '#3b82f6' : '#b94a3b'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="currency-note" style={{ textAlign: 'center' }}>
            Para o gráfico "Lucro por Horário", consideramos no máximo 1 mês de dados (31 dias).
          </p>
        </div>
      </div>
    </>
  );
}
