import { config } from '../config/index.js';
import { listAdAccounts, getCampaigns, getCampaignDailyInsights } from '../meta/client.js';
import { saveCampaigns, saveCampaignDailyInsights, getState, setState } from '../db/index.js';
import { daysAgo, today } from './collector.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let collecting = false;

export function isCollectingCampaigns(): boolean {
  return collecting;
}

// Mesmo princípio da coleta de gastos: orçamento de tempo por chamada, cursor
// persistido para retomar — 80 contas x dezenas de campanhas cada não cabe
// numa única invocação serverless (~60s).
const CAMPAIGN_BATCH_TIME_BUDGET_MS = 45_000;

interface CampaignCursor {
  accountIds: string[];
  since: string;
  until: string;
}

async function loadCursor(): Promise<CampaignCursor | null> {
  const raw = await getState('campaign_sync_cursor');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CampaignCursor;
  } catch {
    return null;
  }
}

async function saveCursor(cursor: CampaignCursor | null): Promise<void> {
  await setState('campaign_sync_cursor', cursor ? JSON.stringify(cursor) : '');
}

export interface CampaignBatchResult {
  done: boolean;
  processed: number;
  remaining: number;
}

/**
 * Processa um lote de contas: busca campanhas (orçamento/status) + insights
 * diários (gasto/cliques/vis. de página) do período. Chame repetidamente (via
 * cron externo) até `done: true`. Período: backfill de config.cron.backfillDays
 * na 1ª vez, senão últimos 7 dias (reconciliação incremental).
 */
export async function runCampaignSyncBatch(): Promise<CampaignBatchResult> {
  if (collecting) {
    console.warn('[Cron] Sincronização de campanhas já em andamento; pulando lote.');
    return { done: false, processed: 0, remaining: -1 };
  }
  collecting = true;
  const startedAt = Date.now();
  try {
    let cursor = await loadCursor();
    if (!cursor) {
      const accounts = await listAdAccounts();
      const isFirstRun = !(await getState('last_campaign_sync'));
      const since = isFirstRun ? daysAgo(config.cron.backfillDays) : daysAgo(7);
      cursor = { accountIds: accounts.map((a) => a.id), since, until: today() };
      console.log(
        `[Campanhas] Novo ciclo${isFirstRun ? ` (backfill ${config.cron.backfillDays}d)` : ''}: ` +
          `${cursor.accountIds.length} contas.`,
      );
    }

    let processed = 0;
    while (cursor.accountIds.length > 0 && Date.now() - startedAt < CAMPAIGN_BATCH_TIME_BUDGET_MS) {
      const accountId = cursor.accountIds[0];
      try {
        const campaigns = await getCampaigns(accountId);
        await saveCampaigns(campaigns);
        if (campaigns.length > 0) {
          const insights = await getCampaignDailyInsights(accountId, cursor.since, cursor.until);
          await saveCampaignDailyInsights(insights);
        }
      } catch (err) {
        console.error(`[Campanhas] Falhou em ${accountId}: ${(err as Error).message}`);
      }
      cursor.accountIds = cursor.accountIds.slice(1);
      processed += 1;
      await saveCursor(cursor.accountIds.length > 0 ? cursor : null);
      if (cursor.accountIds.length > 0) await sleep(config.rateLimit.requestDelayMs);
    }

    const done = cursor.accountIds.length === 0;
    if (done) {
      await setState('last_campaign_sync', new Date().toISOString());
      console.log(`[Campanhas] Ciclo concluído (${processed} contas neste lote).`);
    } else {
      console.log(
        `[Campanhas] Lote: ${processed} processadas, ${cursor.accountIds.length} restantes.`,
      );
    }
    return { done, processed, remaining: cursor.accountIds.length };
  } finally {
    collecting = false;
  }
}
