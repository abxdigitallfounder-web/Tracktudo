import { pool } from './index.js';
import { APPROVED_STATUSES, REFUNDED_STATUSES, apiPaymentLabel } from '../perfectpay/status.js';

/** Conta + snapshot de limite mais recente (para a Tela de Limites). */
export interface AccountRow {
  id: string;
  name: string;
  currency: string;
  status: number;
  disable_reason: number | null;
  business_id: string | null;
  business_name: string | null;
  tags: string | null; // JSON array (string) ou null
  folder_id: number | null;
  updated_at: string;
  spend_cap: number | null;
  amount_spent: number | null;
  balance: number | null;
  available: number | null;
  pct_used: number | null;
  captured_at: string | null;
}

export interface DailySpendRow {
  account_id: string;
  date: string;
  spend: number;
}

export async function getAccountsWithLatestSnapshot(): Promise<AccountRow[]> {
  const { rows } = await pool.query<AccountRow>(`
    SELECT
      a.id, a.name, a.currency, a.status, a.disable_reason,
      a.business_id, a.business_name, a.tags, a.folder_id, a.updated_at,
      s.spend_cap, s.amount_spent, s.balance, s.available, s.pct_used, s.captured_at
    FROM accounts a
    LEFT JOIN limit_snapshots s ON s.id = (
      SELECT id FROM limit_snapshots
      WHERE account_id = a.id
      ORDER BY captured_at DESC, id DESC
      LIMIT 1
    )
    ORDER BY
      CASE a.status WHEN 1 THEN 0 WHEN 3 THEN 1 WHEN 2 THEN 2 ELSE 3 END,
      LOWER(a.name)
  `);
  return rows;
}

/** Gasto de um dia específico por conta (mapa account_id -> gasto). */
export async function getSpendByAccountForDate(
  date: string,
): Promise<Record<string, number>> {
  const { rows } = await pool.query<{ account_id: string; spend: number }>(
    `SELECT account_id, spend FROM daily_spend WHERE date = $1`,
    [date],
  );
  const map: Record<string, number> = {};
  for (const r of rows) map[r.account_id] = Number(r.spend);
  return map;
}

export async function getDailySpendRange(
  since: string,
  until: string,
  accountId?: string,
): Promise<DailySpendRow[]> {
  if (accountId) {
    const id = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
    const { rows } = await pool.query<DailySpendRow>(
      `SELECT account_id, date, spend
       FROM daily_spend
       WHERE date >= $1 AND date <= $2 AND account_id = $3
       ORDER BY date ASC`,
      [since, until, id],
    );
    return rows;
  }
  const { rows } = await pool.query<DailySpendRow>(
    `SELECT account_id, date, spend
     FROM daily_spend
     WHERE date >= $1 AND date <= $2
     ORDER BY date ASC, account_id ASC`,
    [since, until],
  );
  return rows;
}

/** Cartões de resumo para o topo da Tela de Limites. */
export interface Summary {
  totalAccounts: number;
  activeAccounts: number;
  nearLimit: number; // contas com pct_used >= 75
  notActive: number; // status != 1
  spentByCurrency: Record<string, number>; // gasto acumulado por moeda
  todaySpendByCurrency: Record<string, number>; // gasto de hoje por moeda
}

export async function getSummary(today: string): Promise<Summary> {
  const accounts = await getAccountsWithLatestSnapshot();
  const summary: Summary = {
    totalAccounts: accounts.length,
    activeAccounts: 0,
    nearLimit: 0,
    notActive: 0,
    spentByCurrency: {},
    todaySpendByCurrency: {},
  };

  for (const a of accounts) {
    if (a.status === 1) summary.activeAccounts += 1;
    else summary.notActive += 1;
    if (a.pct_used != null && a.pct_used >= 75) summary.nearLimit += 1;
    if (a.amount_spent != null) {
      summary.spentByCurrency[a.currency] =
        (summary.spentByCurrency[a.currency] ?? 0) + a.amount_spent;
    }
  }

  // Gasto de hoje por moeda (junta daily_spend com a moeda da conta).
  const { rows: todayRows } = await pool.query<{ currency: string; total: number }>(
    `SELECT a.currency AS currency, SUM(d.spend) AS total
     FROM daily_spend d JOIN accounts a ON a.id = d.account_id
     WHERE d.date = $1 GROUP BY a.currency`,
    [today],
  );
  for (const r of todayRows) summary.todaySpendByCurrency[r.currency] = Number(r.total);

  return summary;
}

// ---------- Faturamento (PerfectPay) ----------

export interface SalesSummary {
  approvedCount: number; // nº de vendas aprovadas/concluídas
  todayCount: number; // nº de vendas aprovadas hoje
  pendingCount: number; // vendas pendentes (boleto/pix aguardando)
  refundedCount: number; // reembolsos + chargebacks
  // Valores por moeda (não somamos moedas diferentes — igual à tela de gastos).
  revenueApprovedByCurrency: Record<string, number>;
  todayRevenueByCurrency: Record<string, number>;
  refundedAmountByCurrency: Record<string, number>;
}

export async function getSalesSummary(today: string): Promise<SalesSummary> {
  const { rows } = await pool.query<{
    currency: string;
    approved_count: string;
    revenue_approved: number;
    today_revenue: number;
    today_count: string;
    pending_count: string;
    refunded_count: string;
    refunded_amount: number;
  }>(
    `SELECT
       currency,
       COUNT(*) FILTER (WHERE status = ANY($1)) AS approved_count,
       COALESCE(SUM(sale_amount) FILTER (WHERE status = ANY($1)), 0) AS revenue_approved,
       COALESCE(SUM(sale_amount) FILTER (WHERE status = ANY($1) AND LEFT(date_approved, 10) = $3), 0) AS today_revenue,
       COUNT(*) FILTER (WHERE status = ANY($1) AND LEFT(date_approved, 10) = $3) AS today_count,
       COUNT(*) FILTER (WHERE status = 1) AS pending_count,
       COUNT(*) FILTER (WHERE status = ANY($2)) AS refunded_count,
       COALESCE(SUM(sale_amount) FILTER (WHERE status = ANY($2)), 0) AS refunded_amount
     FROM sales
     GROUP BY currency`,
    [APPROVED_STATUSES, REFUNDED_STATUSES, today],
  );

  const summary: SalesSummary = {
    approvedCount: 0,
    todayCount: 0,
    pendingCount: 0,
    refundedCount: 0,
    revenueApprovedByCurrency: {},
    todayRevenueByCurrency: {},
    refundedAmountByCurrency: {},
  };
  for (const r of rows) {
    const cur = r.currency || 'BRL';
    summary.approvedCount += Number(r.approved_count);
    summary.todayCount += Number(r.today_count);
    summary.pendingCount += Number(r.pending_count);
    summary.refundedCount += Number(r.refunded_count);
    if (Number(r.revenue_approved) > 0)
      summary.revenueApprovedByCurrency[cur] = Number(r.revenue_approved);
    if (Number(r.today_revenue) > 0)
      summary.todayRevenueByCurrency[cur] = Number(r.today_revenue);
    if (Number(r.refunded_amount) > 0)
      summary.refundedAmountByCurrency[cur] = Number(r.refunded_amount);
  }
  return summary;
}

export interface RevenueRow {
  date: string;
  currency: string;
  revenue: number;
  count: number;
}

/** Faturamento aprovado por dia e moeda (para o gráfico), no intervalo. */
export async function getRevenueRange(since: string, until: string): Promise<RevenueRow[]> {
  const { rows } = await pool.query<{
    date: string;
    currency: string;
    revenue: number;
    count: string;
  }>(
    `SELECT LEFT(date_approved, 10) AS date,
            currency,
            COALESCE(SUM(sale_amount), 0) AS revenue,
            COUNT(*) AS count
     FROM sales
     WHERE status = ANY($1) AND date_approved IS NOT NULL
       AND LEFT(date_approved, 10) BETWEEN $2 AND $3
     GROUP BY LEFT(date_approved, 10), currency
     ORDER BY date ASC`,
    [APPROVED_STATUSES, since, until],
  );
  return rows.map((r) => ({
    date: r.date,
    currency: r.currency || 'BRL',
    revenue: Number(r.revenue),
    count: Number(r.count),
  }));
}

export interface SaleRow {
  code: string;
  sale_amount: number;
  currency: string;
  status: number;
  status_detail: string | null;
  payment_type: number | null;
  product_name: string | null;
  customer_name: string | null;
  customer_email: string | null;
  date_approved: string | null;
  date_created: string | null;
  received_at: string;
}

// ---------- Dashboard (faturamento + anúncios) ----------

export interface DashboardData {
  currency: string;
  grossRevenue: number;
  netRevenue: number;
  refunds: number;
  taxes: number;
  adSpend: number;
  profit: number;
  pendingValue: number;
  roi: number | null;
  margin: number | null;
  approvedCount: number;
  byPayment: Array<{ method: string; count: number }>;
  bySource: Array<{ source: string; count: number; value: number }>;
  byProduct: Array<{ product: string; count: number; value: number }>;
  byCountry: Array<{ country: string; count: number; value: number }>;
  byHour: Array<{ hour: number; count: number }>;
  profitByHour: Array<{ hour: number; profit: number }>;
  approval: Array<{ method: string; rate: number | null }>;
}

interface DashSaleRow {
  sale_amount: number;
  currency: string;
  status: number;
  payment_type: number | null;
  product_name: string | null;
  date_approved: string | null;
  raw: string | null;
}

/** Agrega tudo que a tela de Dashboard precisa, no intervalo [since, until]. */
export async function getDashboardData(since: string, until: string): Promise<DashboardData> {
  // Vendas do período (por data de aprovação; cai na criação p/ pendentes).
  const { rows } = await pool.query<DashSaleRow>(
    `SELECT sale_amount, currency, status, payment_type, product_name, date_approved, raw
     FROM sales
     WHERE LEFT(COALESCE(date_approved, date_created), 10) BETWEEN $1 AND $2`,
    [since, until],
  );

  const APPROVED = new Set(APPROVED_STATUSES);
  const REFUNDED = new Set(REFUNDED_STATUSES);

  let grossRevenue = 0;
  let refunds = 0;
  let pendingValue = 0;
  let approvedCount = 0;
  const curCount = new Map<string, number>();
  const payCount = new Map<string, number>();
  const source = new Map<string, { count: number; value: number }>();
  const product = new Map<string, { count: number; value: number }>();
  const country = new Map<string, { count: number; value: number }>();
  const hour = new Array<number>(24).fill(0);
  const revenueHour = new Array<number>(24).fill(0);
  // Aprovação por método: aprovadas / total do método.
  const methodTotal = new Map<string, number>();
  const methodApproved = new Map<string, number>();

  for (const r of rows) {
    const val = Number(r.sale_amount) || 0;
    const method = apiPaymentLabel(r.payment_type);
    methodTotal.set(method, (methodTotal.get(method) ?? 0) + 1);
    curCount.set(r.currency, (curCount.get(r.currency) ?? 0) + 1);

    if (APPROVED.has(r.status)) {
      grossRevenue += val;
      approvedCount += 1;
      methodApproved.set(method, (methodApproved.get(method) ?? 0) + 1);
      payCount.set(method, (payCount.get(method) ?? 0) + 1);

      const prod = r.product_name ?? '—';
      const p = product.get(prod) ?? { count: 0, value: 0 };
      p.count += 1;
      p.value += val;
      product.set(prod, p);

      let src = 'Sem campanha';
      let ctry = '—';
      if (r.raw) {
        try {
          const parsed = JSON.parse(r.raw) as {
            metadata?: { utm_campaign?: string; utm_source?: string };
            customer?: Array<{ country?: string }> | { country?: string };
          };
          // Fonte = utm_campaign (ID da campanha da Meta); cai no utm_source.
          const campaign = parsed.metadata?.utm_campaign?.trim();
          const utmSource = parsed.metadata?.utm_source?.trim();
          if (campaign) src = campaign;
          else if (utmSource) src = utmSource;
          const cust = Array.isArray(parsed.customer) ? parsed.customer[0] : parsed.customer;
          if (cust?.country && cust.country.trim()) ctry = cust.country.trim().toUpperCase();
        } catch {
          /* ignora raw inválido */
        }
      }
      const s = source.get(src) ?? { count: 0, value: 0 };
      s.count += 1;
      s.value += val;
      source.set(src, s);

      const co = country.get(ctry) ?? { count: 0, value: 0 };
      co.count += 1;
      co.value += val;
      country.set(ctry, co);

      if (r.date_approved && r.date_approved.length >= 13) {
        const h = Number(r.date_approved.slice(11, 13));
        if (Number.isFinite(h) && h >= 0 && h < 24) {
          hour[h] += 1;
          revenueHour[h] += val;
        }
      }
    } else if (REFUNDED.has(r.status)) {
      refunds += val;
    } else if (r.status === 1) {
      pendingValue += val;
    }
  }

  const currency =
    [...curCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'BRL';

  // Gasto de anúncios (Meta) no período, SÓ das contas na mesma moeda do
  // faturamento — senão o ROI misturaria moedas (ex.: gasto BRL vs receita USD).
  const { rows: spendRows } = await pool.query<{ total: number }>(
    `SELECT COALESCE(SUM(d.spend), 0) AS total
     FROM daily_spend d JOIN accounts a ON a.id = d.account_id
     WHERE d.date BETWEEN $1 AND $2 AND a.currency = $3`,
    [since, until, currency],
  );
  const adSpend = Number(spendRows[0]?.total ?? 0);

  const taxes = 0;
  const netRevenue = grossRevenue - refunds;
  const profit = netRevenue - adSpend - taxes;
  const roi = adSpend > 0 ? (profit / adSpend) * 100 : null;
  const margin = netRevenue > 0 ? (profit / netRevenue) * 100 : null;

  // Top 5 formas de pagamento realmente usadas (por nº de vendas aprovadas).
  const topPayment = [...payCount.entries()]
    .map(([method, count]) => ({ method, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Taxa de aprovação das formas mais usadas (por total de tentativas).
  const topApproval = [...methodTotal.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([method, total]) => ({
      method,
      rate: total > 0 ? ((methodApproved.get(method) ?? 0) / total) * 100 : null,
    }));

  return {
    currency,
    grossRevenue,
    netRevenue,
    refunds,
    taxes,
    adSpend,
    profit,
    pendingValue,
    roi,
    margin,
    approvedCount,
    byPayment: topPayment,
    bySource: [...source.entries()]
      .map(([s, v]) => ({ source: s, count: v.count, value: v.value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12),
    byProduct: [...product.entries()]
      .map(([p, v]) => ({ product: p, count: v.count, value: v.value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12),
    byCountry: [...country.entries()]
      .map(([c, v]) => ({ country: c, count: v.count, value: v.value }))
      .sort((a, b) => b.value - a.value),
    byHour: hour.map((count, h) => ({ hour: h, count })),
    // Lucro por hora = faturamento da hora − parcela do gasto de anúncios
    // (distribuído igualmente pelas 24h, já que o gasto da Meta é diário).
    profitByHour: revenueHour.map((rev, h) => ({ hour: h, profit: rev - adSpend / 24 })),
    approval: topApproval,
  };
}

/** Vendas mais recentes (para a lista da tela de Faturamento). */
export async function getRecentSales(limit: number): Promise<SaleRow[]> {
  const { rows } = await pool.query<SaleRow>(
    `SELECT code, sale_amount, currency, status, status_detail, payment_type,
            product_name, customer_name, customer_email, date_approved, date_created, received_at
     FROM sales
     ORDER BY COALESCE(date_approved, date_created, received_at) DESC
     LIMIT $1`,
    [limit],
  );
  return rows;
}

// ---------- Campanhas (Meta + PerfectPay cruzadas) ----------

export interface CampaignRow {
  id: string;
  name: string;
  account_id: string;
  account_name: string;
  account_status: number;
  currency: string;
  status: string;
  effective_status: string;
  daily_budget: number | null;
  lifetime_budget: number | null;
  spend: number;
  clicks: number;
  page_views: number;
  vendas: number;
  receita: number;
  pendentes: number;
  produto: string | null;
}

export interface CampaignsFilter {
  since: string;
  until: string;
  search?: string;
  status?: string;
  /** IDs de conta ("act_...") a incluir. Vazio/ausente = nenhuma conta (retorna []). */
  accountIds?: string[];
  product?: string;
}

export async function getCampaignsTable(filter: CampaignsFilter): Promise<CampaignRow[]> {
  // Sem contas selecionadas, não há o que buscar — evita varrer milhares de
  // campanhas de todas as contas sem necessidade (a tela exige seleção).
  if (!filter.accountIds || filter.accountIds.length === 0) return [];

  const { rows } = await pool.query<CampaignRow>(
    `WITH insights AS (
       SELECT campaign_id,
              SUM(spend) AS spend,
              SUM(clicks) AS clicks,
              SUM(page_views) AS page_views
       FROM campaign_daily_insights
       WHERE date BETWEEN $1 AND $2
       GROUP BY campaign_id
     ),
     sales_agg AS (
       SELECT utm_campaign AS campaign_id,
              COUNT(*) FILTER (WHERE status = ANY($3)) AS vendas,
              COALESCE(SUM(sale_amount) FILTER (WHERE status = ANY($3)), 0) AS receita,
              COUNT(*) FILTER (WHERE status = 1) AS pendentes,
              MODE() WITHIN GROUP (ORDER BY product_name) AS produto
       FROM sales
       WHERE utm_campaign IS NOT NULL
         AND LEFT(COALESCE(date_approved, date_created), 10) BETWEEN $1 AND $2
       GROUP BY utm_campaign
     )
     SELECT c.id, c.name, c.account_id, a.name AS account_name, a.status AS account_status,
            a.currency, c.status, c.effective_status, c.daily_budget, c.lifetime_budget,
            COALESCE(i.spend, 0) AS spend,
            COALESCE(i.clicks, 0) AS clicks,
            COALESCE(i.page_views, 0) AS page_views,
            COALESCE(s.vendas, 0) AS vendas,
            COALESCE(s.receita, 0) AS receita,
            COALESCE(s.pendentes, 0) AS pendentes,
            s.produto
     FROM campaigns c
     JOIN accounts a ON a.id = c.account_id
     LEFT JOIN insights i ON i.campaign_id = c.id
     LEFT JOIN sales_agg s ON s.campaign_id = c.id
     WHERE c.account_id = ANY($6::text[])
       AND ($4 = '' OR c.name ILIKE '%' || $4 || '%')
       AND ($5 = '' OR c.effective_status = $5)
       AND ($7 = '' OR s.produto = $7)
     ORDER BY spend DESC, c.name ASC`,
    [
      filter.since,
      filter.until,
      APPROVED_STATUSES,
      filter.search?.trim() ?? '',
      filter.status?.trim() ?? '',
      filter.accountIds.map((id) => (id.startsWith('act_') ? id : `act_${id}`)),
      filter.product?.trim() ?? '',
    ],
  );
  return rows;
}

/** Vendas do período cujo utm_campaign não bate com nenhuma campanha conhecida. */
export async function getUntrackedSalesCount(since: string, until: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*) AS n
     FROM sales s
     WHERE LEFT(COALESCE(s.date_approved, s.date_created), 10) BETWEEN $1 AND $2
       AND (s.utm_campaign IS NULL OR NOT EXISTS (
         SELECT 1 FROM campaigns c WHERE c.id = s.utm_campaign
       ))`,
    [since, until],
  );
  return Number(rows[0]?.n ?? 0);
}
