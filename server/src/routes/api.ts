import { Router } from 'express';
import {
  getAccountsWithLatestSnapshot,
  getDailySpendRange,
  getSummary,
} from '../db/queries.js';
import {
  getState,
  setAccountTags,
  listFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  setAccountFolder,
  setAccountsFolder,
} from '../db/index.js';
import { accountStatusLabel } from '../meta/accountStatus.js';
import { collectAll, isCollecting, today } from '../services/collector.js';
import { getTokensInfo } from '../meta/tokenInfo.js';
import { config } from '../config/index.js';

export const api = Router();

/** Lista de contas com o snapshot de limite mais recente. */
api.get('/accounts', (_req, res) => {
  const rows = getAccountsWithLatestSnapshot().map((r) => ({
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
    balance: r.balance,
    available: r.available,
    pctUsed: r.pct_used,
    capturedAt: r.captured_at,
  }));
  res.json(rows);
});

/** Gastos diários de uma conta. */
api.get('/accounts/:id/daily-spend', (req, res) => {
  const { since, until } = parseRange(req.query);
  const rows = getDailySpendRange(since, until, req.params.id);
  res.json(rows);
});

/** Gastos diários de todas as contas (visão geral). */
api.get('/daily-spend', (req, res) => {
  const { since, until } = parseRange(req.query);
  const rows = getDailySpendRange(since, until);
  res.json(rows);
});

/** Cartões de resumo. */
api.get('/summary', (_req, res) => {
  res.json(getSummary(today()));
});

/** Estado das coletas (para "Atualizado há X min" e monitor de token). */
api.get('/status', (_req, res) => {
  res.json({
    collecting: isCollecting(),
    lastLimitsCollect: getState('last_limits_collect'),
    lastDailyCollect: getState('last_daily_collect'),
    tokenCount: config.meta.tokens.length,
  });
});

/** Define as tags de uma conta. Body: { tags: string[] }. */
api.put('/accounts/:id/tags', (req, res) => {
  const body = req.body as { tags?: unknown };
  if (!Array.isArray(body.tags) || !body.tags.every((t) => typeof t === 'string')) {
    res.status(400).json({ error: 'tags deve ser um array de strings' });
    return;
  }
  const tags = [
    ...new Set((body.tags as string[]).map((t) => t.trim()).filter(Boolean)),
  ].slice(0, 20);
  setAccountTags(req.params.id, tags);
  res.json({ ok: true, tags });
});

// ---------- Pastas ----------
api.get('/folders', (_req, res) => {
  res.json(listFolders());
});

api.post('/folders', (req, res) => {
  const body = req.body as { name?: unknown; accountIds?: unknown };
  const name = String(body?.name ?? '').trim();
  if (!name) {
    res.status(400).json({ error: 'nome obrigatório' });
    return;
  }
  const folder = createFolder(name.slice(0, 60));
  // Opcional: já move as contas selecionadas para a nova pasta.
  if (Array.isArray(body.accountIds)) {
    const ids = body.accountIds.filter((x): x is string => typeof x === 'string');
    if (ids.length > 0) setAccountsFolder(folder.id, ids);
  }
  res.status(201).json(folder);
});

api.put('/folders/:id', (req, res) => {
  const name = String((req.body as { name?: unknown })?.name ?? '').trim();
  if (!name) {
    res.status(400).json({ error: 'nome obrigatório' });
    return;
  }
  renameFolder(Number(req.params.id), name.slice(0, 60));
  res.json({ ok: true });
});

api.delete('/folders/:id', (req, res) => {
  deleteFolder(Number(req.params.id));
  res.json({ ok: true });
});

/** Move uma conta para uma pasta (ou remove com folderId null). */
api.put('/accounts/:id/folder', (req, res) => {
  const raw = (req.body as { folderId?: unknown })?.folderId;
  const folderId = raw == null ? null : Number(raw);
  if (folderId != null && !Number.isFinite(folderId)) {
    res.status(400).json({ error: 'folderId inválido' });
    return;
  }
  setAccountFolder(req.params.id, folderId);
  res.json({ ok: true, folderId });
});

/** Validade dos tokens (para o monitor de expiração no dashboard). */
api.get('/token-health', async (_req, res) => {
  try {
    res.json(await getTokensInfo());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Dispara uma coleta manual (assíncrona). */
api.post('/refresh', (_req, res) => {
  if (isCollecting()) {
    res.status(409).json({ started: false, message: 'Coleta já em andamento.' });
    return;
  }
  // Roda em background; o frontend acompanha por /api/status.
  collectAll().catch((err) => console.error('[Coleta] Erro na coleta manual:', err));
  res.status(202).json({ started: true });
});

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
