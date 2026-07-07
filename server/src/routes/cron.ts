import { Router } from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { config } from '../config/index.js';
import { collectLimitsJob, runDailySpendBatch } from '../services/collector.js';
import { syncRecentSales, salesApiEnabled } from '../services/salesCollector.js';

/**
 * Endpoints PÚBLICOS (validados por CRON_SECRET) acionados por um cron
 * EXTERNO (ex.: cron-job.org). Necessário em hosts serverless (Vercel), que
 * não mantêm um processo de agendamento (node-cron) rodando entre requisições.
 *
 * Orçamento de tempo por chamada (Vercel free = 60s): a coleta de gastos é
 * feita em LOTES retomáveis (ver runDailySpendBatch) — chame este endpoint
 * repetidamente (ex.: a cada 15min) até a resposta trazer "done": true.
 */
export const cron = Router();

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((err) => {
      console.error(`[Cron] Erro em ${req.method} ${req.originalUrl}:`, (err as Error).message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro interno' });
      else next(err);
    });
  };
}

function checkSecret(req: Request): boolean {
  const expected = config.cron.secret;
  if (!expected) {
    console.warn('[Cron] CRON_SECRET não configurado — endpoint aberto (use só em teste local).');
    return true;
  }
  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const provided = bearer ?? (req.query.key as string | undefined);
  return provided === expected;
}

function requireCronSecret(req: Request, res: Response, next: NextFunction): void {
  if (checkSecret(req)) {
    next();
    return;
  }
  res.status(401).json({ error: 'CRON_SECRET inválido ou ausente' });
}

cron.use(requireCronSecret);

/** Coleta de limites das contas — rápida (1 chamada por token), sem lote. */
cron.all(
  '/collect-limits',
  asyncHandler(async (_req, res) => {
    await collectLimitsJob();
    res.json({ ok: true });
  }),
);

/**
 * Processa UM lote de contas de gastos diários (orçamento ~45s).
 * Chame de novo até `done: true` para completar o ciclo.
 */
cron.all(
  '/collect-daily-spend',
  asyncHandler(async (_req, res) => {
    const result = await runDailySpendBatch();
    res.json(result);
  }),
);

/** Sincroniza vendas atualizadas nos últimos dias (PerfectPay), com orçamento de tempo. */
cron.all(
  '/sync-sales',
  asyncHandler(async (_req, res) => {
    if (!salesApiEnabled()) {
      res.status(400).json({ error: 'PERFECTPAY_API_TOKEN não configurado.' });
      return;
    }
    const result = await syncRecentSales(3, 45_000);
    res.json(result);
  }),
);
