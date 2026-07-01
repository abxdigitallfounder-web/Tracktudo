import { Router } from 'express';
import {
  getAccountsWithLatestSnapshot,
  getDailySpendRange,
  getSummary,
} from '../db/queries.js';
import { getState } from '../db/index.js';
import { accountStatusLabel } from '../meta/accountStatus.js';
import { collectAll, isCollecting, today } from '../services/collector.js';
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
