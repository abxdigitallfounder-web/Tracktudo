import { Router } from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import {
  getAccountsWithLatestSnapshot,
  getDailySpendRange,
  getSpendByAccountForDate,
  getSummary,
  getSalesSummary,
  getRevenueRange,
  getRecentSales,
  getDashboardData,
  getCampaignsTable,
  getUntrackedSalesCount,
  getSalesByAd,
} from '../db/queries.js';
import { saleStatusLabel, paymentTypeLabel } from '../perfectpay/status.js';
import {
  getState,
  setAccountTags,
  listFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  setAccountFolder,
  setAccountsFolder,
  getCampaignById,
  updateCampaignStatusAndLog,
  getCampaignStatusLog,
} from '../db/index.js';
import { accountStatusLabel } from '../meta/accountStatus.js';
import {
  collectLimitsJob,
  runDailySpendBatch,
  isCollecting,
  today,
} from '../services/collector.js';
import {
  backfillSales,
  isSyncingSales,
  salesApiEnabled,
} from '../services/salesCollector.js';
import { runCampaignSyncBatch, isCollectingCampaigns } from '../services/campaignCollector.js';
import { setCampaignStatus, getAdPerformance } from '../meta/client.js';
import { getTokensInfo } from '../meta/tokenInfo.js';
import { config } from '../config/index.js';

export const api = Router();

/**
 * Envolve handlers async para que erros virem 500 em vez de derrubar o processo
 * (o Express 4 não captura rejections de handlers async automaticamente).
 */
function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((err) => {
      console.error(`[API] Erro em ${req.method} ${req.originalUrl}:`, (err as Error).message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro interno' });
      else next(err);
    });
  };
}

/** Lista de contas com o snapshot de limite mais recente. */
api.get('/accounts', asyncHandler(async (_req, res) => {
  const [accounts, todaySpend] = await Promise.all([
    getAccountsWithLatestSnapshot(),
    getSpendByAccountForDate(today()),
  ]);
  const rows = accounts.map((r) => ({
    id: r.id,
    name: r.name,
    currency: r.currency,
    status: r.status,
    statusLabel: accountStatusLabel(r.status),
    disableReason: r.disable_reason,
    businessId: r.business_id,
    businessName: r.business_name,
    tags: parseTags(r.tags),
    folderId: r.folder_id,
    spendCap: r.spend_cap,
    amountSpent: r.amount_spent ?? 0,
    todaySpend: todaySpend[r.id] ?? 0,
    balance: r.balance,
    available: r.available,
    pctUsed: r.pct_used,
    capturedAt: r.captured_at,
  }));
  res.json(rows);
}));

/** Gastos diários de uma conta. */
api.get('/accounts/:id/daily-spend', asyncHandler(async (req, res) => {
  const { since, until } = parseRange(req.query);
  const rows = await getDailySpendRange(since, until, req.params.id);
  res.json(rows);
}));

/** Gastos diários de todas as contas (visão geral). */
api.get('/daily-spend', asyncHandler(async (req, res) => {
  const { since, until } = parseRange(req.query);
  const rows = await getDailySpendRange(since, until);
  res.json(rows);
}));

/** Cartões de resumo. */
api.get('/summary', asyncHandler(async (_req, res) => {
  res.json(await getSummary(today()));
}));

/** Estado das coletas (para "Atualizado há X min" e monitor de token). */
api.get('/status', asyncHandler(async (_req, res) => {
  const [lastLimitsCollect, lastDailyCollect, lastSalesSync, lastCampaignSync] = await Promise.all([
    getState('last_limits_collect'),
    getState('last_daily_collect'),
    getState('last_sales_sync'),
    getState('last_campaign_sync'),
  ]);
  res.json({
    collecting: isCollecting(),
    lastLimitsCollect,
    lastDailyCollect,
    tokenCount: config.meta.tokens.length,
    salesApiEnabled: salesApiEnabled(),
    salesSyncing: isSyncingSales(),
    lastSalesSync,
    campaignsSyncing: isCollectingCampaigns(),
    lastCampaignSync,
  });
}));

/** Define as tags de uma conta. Body: { tags: string[] }. */
api.put('/accounts/:id/tags', asyncHandler(async (req, res) => {
  const body = req.body as { tags?: unknown };
  if (!Array.isArray(body.tags) || !body.tags.every((t) => typeof t === 'string')) {
    res.status(400).json({ error: 'tags deve ser um array de strings' });
    return;
  }
  const tags = [
    ...new Set((body.tags as string[]).map((t) => t.trim()).filter(Boolean)),
  ].slice(0, 20);
  await setAccountTags(req.params.id, tags);
  res.json({ ok: true, tags });
}));

// ---------- Pastas ----------
api.get('/folders', asyncHandler(async (_req, res) => {
  res.json(await listFolders());
}));

api.post('/folders', asyncHandler(async (req, res) => {
  const body = req.body as { name?: unknown; accountIds?: unknown };
  const name = String(body?.name ?? '').trim();
  if (!name) {
    res.status(400).json({ error: 'nome obrigatório' });
    return;
  }
  const folder = await createFolder(name.slice(0, 60));
  // Opcional: já move as contas selecionadas para a nova pasta.
  if (Array.isArray(body.accountIds)) {
    const ids = body.accountIds.filter((x): x is string => typeof x === 'string');
    if (ids.length > 0) await setAccountsFolder(folder.id, ids);
  }
  res.status(201).json(folder);
}));

api.put('/folders/:id', asyncHandler(async (req, res) => {
  const name = String((req.body as { name?: unknown })?.name ?? '').trim();
  if (!name) {
    res.status(400).json({ error: 'nome obrigatório' });
    return;
  }
  await renameFolder(Number(req.params.id), name.slice(0, 60));
  res.json({ ok: true });
}));

api.delete('/folders/:id', asyncHandler(async (req, res) => {
  await deleteFolder(Number(req.params.id));
  res.json({ ok: true });
}));

/** Adiciona (move) várias contas para uma pasta existente. */
api.put('/folders/:id/accounts', asyncHandler(async (req, res) => {
  const body = req.body as { accountIds?: unknown };
  if (!Array.isArray(body.accountIds)) {
    res.status(400).json({ error: 'accountIds deve ser um array' });
    return;
  }
  const ids = body.accountIds.filter((x): x is string => typeof x === 'string');
  await setAccountsFolder(Number(req.params.id), ids);
  res.json({ ok: true, count: ids.length });
}));

/** Move uma conta para uma pasta (ou remove com folderId null). */
api.put('/accounts/:id/folder', asyncHandler(async (req, res) => {
  const raw = (req.body as { folderId?: unknown })?.folderId;
  const folderId = raw == null ? null : Number(raw);
  if (folderId != null && !Number.isFinite(folderId)) {
    res.status(400).json({ error: 'folderId inválido' });
    return;
  }
  await setAccountFolder(req.params.id, folderId);
  res.json({ ok: true, folderId });
}));

// ---------- Dashboard (faturamento + anúncios) ----------

/** Agregados da tela de Dashboard (faturamento líquido, ROI, lucro, etc.). */
api.get('/dashboard', asyncHandler(async (req, res) => {
  const { since, until } = parseRange(req.query);
  res.json(await getDashboardData(since, until));
}));

/**
 * ROI por anúncio (nível de anúncio/conjunto, não só campanha) — cruza vendas
 * (utm_content = ad_id da Meta) com gasto/cliques reais, buscados ao vivo na
 * Meta. Endpoint separado do /dashboard: só chama a Meta para os anúncios que
 * de fato tiveram venda no período (não o inventário todo), mas ainda assim
 * é mais lento — o frontend carrega esse widget à parte, sem travar o resto.
 */
api.get('/dashboard/roi-by-ad', asyncHandler(async (req, res) => {
  const { since, until } = parseRange(req.query);
  const salesByAd = await getSalesByAd(since, until, 30);
  if (salesByAd.length === 0) {
    res.json({ rows: [] });
    return;
  }
  const accounts = await getAccountsWithLatestSnapshot();
  const currencyByAccount = new Map(accounts.map((a) => [a.id, a.currency]));

  const rows = [];
  const startedAt = Date.now();
  for (const s of salesByAd) {
    if (Date.now() - startedAt > 45_000) break; // orçamento de tempo (Vercel-safe)
    try {
      const perf = await getAdPerformance(s.adId, since, until);
      if (!perf) continue;
      const currency = (perf.accountId && currencyByAccount.get(perf.accountId)) || 'BRL';
      const roi = perf.spend > 0 ? ((s.revenue - perf.spend) / perf.spend) * 100 : null;
      rows.push({
        adId: perf.id,
        adName: perf.name,
        adsetName: perf.adsetName,
        campaignName: perf.campaignName,
        currency,
        spend: perf.spend,
        clicks: perf.clicks,
        sales: s.count,
        revenue: s.revenue,
        roi,
      });
    } catch (err) {
      console.error(`[Dashboard] Falha ao buscar anúncio ${s.adId}:`, (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, config.rateLimit.requestDelayMs));
  }
  rows.sort((a, b) => b.spend - a.spend);
  res.json({ rows });
}));

// ---------- Campanhas (Meta + PerfectPay cruzadas) ----------

/** Tabela de campanhas: orçamento/gasto/cliques (Meta) + vendas (PerfectPay). */
api.get('/campaigns', asyncHandler(async (req, res) => {
  const { since, until } = parseRange(req.query);
  const q = req.query as Record<string, string | undefined>;
  const accountIds = q.accountIds
    ? q.accountIds.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const [rows, untrackedSales] = await Promise.all([
    getCampaignsTable({
      since,
      until,
      search: q.search,
      status: q.status,
      accountIds,
      product: q.product,
    }),
    getUntrackedSalesCount(since, until),
  ]);
  res.json({
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      accountId: r.account_id,
      accountName: r.account_name,
      accountStatus: r.account_status,
      accountStatusLabel: accountStatusLabel(r.account_status),
      currency: r.currency,
      status: r.status,
      effectiveStatus: r.effective_status,
      dailyBudget: r.daily_budget,
      lifetimeBudget: r.lifetime_budget,
      spend: Number(r.spend),
      // COUNT/SUM de coluna inteira retornam bigint no Postgres, que o driver
      // `pg` mantém como string (evita perda de precisão) — convertemos aqui.
      clicks: Number(r.clicks),
      pageViews: Number(r.page_views),
      initiateCheckout: Number(r.initiate_checkout),
      sales: Number(r.vendas),
      pendingSales: Number(r.pendentes),
      revenue: Number(r.receita),
      product: r.produto,
    })),
    untrackedSales,
  });
}));

/**
 * Processa UM lote de sincronização de campanhas (~45s) e só responde quando
 * terminar — em hosts serverless (Vercel), nada sobrevive após a resposta ser
 * enviada, então "disparar e responder na hora" (fire-and-forget) nunca
 * completa lá. Retorna { done, processed, remaining } — o frontend chama de
 * novo automaticamente até done:true.
 */
api.post('/campaigns/sync', asyncHandler(async (_req, res) => {
  if (isCollectingCampaigns()) {
    res.status(409).json({ started: false, message: 'Sincronização já em andamento.' });
    return;
  }
  const result = await runCampaignSyncBatch();
  res.json({ started: true, ...result });
}));

/**
 * Ativa ou pausa uma campanha na Meta (única ação de escrita do TRACKTUDO).
 * Body: { status: 'ACTIVE' | 'PAUSED' }. Aplica na Meta primeiro; só grava
 * local + histórico se a Meta confirmar sucesso.
 */
api.put('/campaigns/:id/status', asyncHandler(async (req, res) => {
  const { status } = req.body as { status?: unknown };
  if (status !== 'ACTIVE' && status !== 'PAUSED') {
    res.status(400).json({ error: 'status deve ser "ACTIVE" ou "PAUSED"' });
    return;
  }
  const campaign = await getCampaignById(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: 'Campanha não encontrada (sincronize antes de tentar de novo).' });
    return;
  }
  if (campaign.status === status) {
    res.json({ ok: true, status, unchanged: true });
    return;
  }
  try {
    await setCampaignStatus(campaign.id, status, campaign.account_id);
  } catch (err) {
    console.error(`[Campanhas] Falha ao alterar status de ${campaign.id}:`, (err as Error).message);
    res.status(502).json({ error: (err as Error).message });
    return;
  }
  await updateCampaignStatusAndLog(campaign.id, campaign.name, campaign.account_id, campaign.status, status);
  res.json({ ok: true, status });
}));

/** Histórico recente de ativações/pausas feitas pelo TRACKTUDO. */
api.get('/campaigns/status-log', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  res.json(await getCampaignStatusLog(limit));
}));

// ---------- Faturamento (PerfectPay) ----------

/** Cartões de resumo do faturamento. */
api.get('/sales/summary', asyncHandler(async (_req, res) => {
  res.json(await getSalesSummary(today()));
}));

/** Faturamento por dia (para o gráfico). */
api.get('/sales/revenue', asyncHandler(async (req, res) => {
  const { since, until } = parseRange(req.query);
  res.json(await getRevenueRange(since, until));
}));

/**
 * Sincroniza (backfill) o histórico de vendas via API, com orçamento de tempo
 * (~45s) — aguarda terminar antes de responder (ver nota em /campaigns/sync
 * sobre por que não pode ser fire-and-forget em serverless). Se não completar
 * (histórico grande), volta `complete:false`; o frontend chama de novo.
 */
api.post('/sales/sync', asyncHandler(async (_req, res) => {
  if (!salesApiEnabled()) {
    res.status(400).json({ started: false, message: 'PERFECTPAY_API_TOKEN não configurado.' });
    return;
  }
  if (isSyncingSales()) {
    res.status(409).json({ started: false, message: 'Sincronização já em andamento.' });
    return;
  }
  const result = await backfillSales(45_000);
  res.json({ started: true, ...result });
}));

/** Vendas mais recentes (lista). */
api.get('/sales', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const rows = (await getRecentSales(limit)).map((s) => ({
    code: s.code,
    saleAmount: s.sale_amount,
    currency: s.currency,
    status: s.status,
    statusLabel: saleStatusLabel(s.status),
    statusDetail: s.status_detail,
    paymentType: s.payment_type,
    paymentLabel: paymentTypeLabel(s.payment_type),
    productName: s.product_name,
    customerName: s.customer_name,
    customerEmail: s.customer_email,
    dateApproved: s.date_approved,
    dateCreated: s.date_created,
    receivedAt: s.received_at,
  }));
  res.json(rows);
}));

/** Validade dos tokens (para o monitor de expiração no dashboard). */
api.get('/token-health', async (_req, res) => {
  try {
    res.json(await getTokensInfo());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * Coleta manual: limites (rápido, sempre completa) + UM lote de gastos
 * diários (~45s). Aguarda terminar antes de responder — em serverless
 * (Vercel), nada roda depois que a resposta é enviada, então não dá pra
 * disparar e responder na hora (fire-and-forget nunca completava lá).
 * Retorna { dailySpend: { done, processed, remaining } } — o frontend chama
 * de novo automaticamente até done:true (contas grandes levam vários cliques
 * automáticos até cobrir tudo).
 */
api.post('/refresh', asyncHandler(async (_req, res) => {
  if (isCollecting()) {
    res.status(409).json({ started: false, message: 'Coleta já em andamento.' });
    return;
  }
  await collectLimitsJob();
  const dailySpend = await runDailySpendBatch();
  res.json({ started: true, dailySpend });
}));

function parseRange(query: qs): { since: string; until: string } {
  const until = typeof query.until === 'string' ? query.until : today();
  let since: string;
  if (typeof query.since === 'string') {
    since = query.since;
  } else {
    const d = new Date();
    d.setDate(d.getDate() - 6); // padrão: últimos 7 dias
    since = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  }
  return { since, until };
}

type qs = Record<string, unknown>;

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}
