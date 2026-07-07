import { config, hasMetaConfig } from './config/index.js';
import { app, ensureSchema } from './app.js';
import { getState } from './db/index.js';
import { collectAll } from './services/collector.js';
import { backfillSales, salesApiEnabled } from './services/salesCollector.js';
import { startScheduler } from './scheduler/index.js';

/**
 * Bootstrap para hosts tradicionais (Render, VPS, local via `npm run dev`) —
 * mantém um processo vivo com `app.listen` + agendador em memória (node-cron).
 * NÃO é usado na Vercel: lá a entrada é `api/index.ts` (função serverless),
 * que reaproveita o mesmo `app` mas sem listen/cron (ver README).
 */
async function bootstrap(): Promise<void> {
  await ensureSchema();

  app.listen(config.server.port, () => {
    console.log(
      `[TRACKTUDO] Backend rodando em http://localhost:${config.server.port} ` +
        `(${config.server.nodeEnv})`,
    );
  });

  if (!hasMetaConfig()) {
    console.warn('[TRACKTUDO] Aviso: nenhum token da Meta configurado. Veja server/.env.');
    return;
  }
  startScheduler();
  // Recoleta no boot se o banco ainda não tem coleta de limites (útil na
  // primeira subida ou após limpar o banco).
  if (!(await getState('last_limits_collect'))) {
    console.log('[TRACKTUDO] Banco vazio: iniciando coleta inicial...');
    collectAll().catch((err) => console.error('[TRACKTUDO] Falha na coleta inicial:', err));
  }
  // Backfill inicial de vendas (PerfectPay) se a API está ligada e nunca rodou.
  if (salesApiEnabled() && !(await getState('last_sales_sync'))) {
    console.log('[TRACKTUDO] Iniciando backfill inicial de vendas (PerfectPay)...');
    backfillSales().catch((err) =>
      console.error('[TRACKTUDO] Falha no backfill de vendas:', (err as Error).message),
    );
  }
}

bootstrap().catch((err) => {
  console.error('[TRACKTUDO] Falha ao iniciar:', err);
  process.exit(1);
});
