import { config } from '../config/index.js';
import { listAdAccounts, getDailySpend } from '../meta/client.js';
import { saveAccountSnapshots, saveDailySpend, setState, getState } from '../db/index.js';
import type { AdAccount } from '../meta/types.js';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Data local no formato YYYY-MM-DD. */
export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function today(): string {
  return ymd(new Date());
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}

let collecting = false;

export function isCollecting(): boolean {
  return collecting;
}

/** Coleta os limites (contas + snapshots) de todas as contas. */
export async function collectLimits(accounts?: AdAccount[]): Promise<AdAccount[]> {
  const list = accounts ?? (await listAdAccounts());
  const capturedAt = new Date().toISOString();
  await saveAccountSnapshots(list, capturedAt);
  await setState('last_limits_collect', capturedAt);
  console.log(`[Coleta] Limites: ${list.length} contas salvas.`);
  return list;
}

/**
 * Coleta os gastos diários das contas no intervalo [since, until].
 * Sequencial, com intervalo entre contas para respeitar o rate limit.
 * Erro numa conta é logado e não interrompe as demais.
 */
export async function collectDailySpend(
  accounts: AdAccount[],
  since: string,
  until: string,
): Promise<void> {
  let ok = 0;
  let fail = 0;
  let totalRows = 0;
  for (const acc of accounts) {
    try {
      const rows = await getDailySpend(acc.id, since, until);
      await saveDailySpend(rows);
      totalRows += rows.length;
      ok += 1;
    } catch (err) {
      fail += 1;
      console.error(`[Coleta] Gastos falhou em ${acc.id} (${acc.name}): ${(err as Error).message}`);
    }
    await sleep(config.rateLimit.requestDelayMs);
  }
  await setState('last_daily_collect', new Date().toISOString());
  console.log(
    `[Coleta] Gastos [${since}..${until}]: ${ok} contas ok, ${fail} falhas, ${totalRows} dias gravados.`,
  );
}

/**
 * Coleta completa: lista contas UMA vez, grava limites e gastos.
 * Na primeira execução (banco sem coleta de gastos), faz backfill de N dias.
 */
export async function collectAll(): Promise<void> {
  if (collecting) {
    console.warn('[Coleta] Já existe uma coleta em andamento; ignorando nova chamada.');
    return;
  }
  collecting = true;
  const started = Date.now();
  try {
    const accounts = await listAdAccounts();
    await collectLimits(accounts);

    const isFirstRun = !(await getState('last_daily_collect'));
    const since = isFirstRun ? daysAgo(config.cron.backfillDays) : daysAgo(2);
    if (isFirstRun) {
      console.log(`[Coleta] Primeira execução: backfill de ${config.cron.backfillDays} dias.`);
    }
    await collectDailySpend(accounts, since, today());

    console.log(`[Coleta] Concluída em ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  } finally {
    collecting = false;
  }
}

/** Job agendado de limites (respeita o guard de coleta em andamento). */
export async function collectLimitsJob(): Promise<void> {
  if (collecting) {
    console.warn('[Cron] Coleta em andamento; pulando job de limites.');
    return;
  }
  collecting = true;
  try {
    await collectLimits();
  } catch (err) {
    console.error('[Cron] Erro no job de limites:', (err as Error).message);
  } finally {
    collecting = false;
  }
}

/** Job agendado de gastos (últimos 2 dias, para atualizar o dia corrente). */
export async function collectDailyJob(): Promise<void> {
  if (collecting) {
    console.warn('[Cron] Coleta em andamento; pulando job de gastos.');
    return;
  }
  collecting = true;
  try {
    const accounts = await listAdAccounts();
    await collectDailySpend(accounts, daysAgo(2), today());
  } catch (err) {
    console.error('[Cron] Erro no job de gastos:', (err as Error).message);
  } finally {
    collecting = false;
  }
}

// ---------- Coleta de gastos em lotes retomáveis (hosts serverless) ----------
//
// Em hosts tradicionais (Render/VPS) a coleta de gastos roda de uma vez só
// (collectDailyJob acima). Em serverless (Vercel), cada invocação tem um
// tempo máximo (ex.: 60s) — coletar ~80 contas leva ~137s. Por isso, aqui
// processamos um LOTE por chamada, guardando o progresso (cursor) no banco,
// e retomamos de onde paramos na próxima chamada do cron externo.

const DAILY_BATCH_TIME_BUDGET_MS = 45_000; // deixa margem sob o limite de 60s da Vercel

interface DailyCursor {
  accountIds: string[];
  since: string;
  until: string;
}

async function loadDailyCursor(): Promise<DailyCursor | null> {
  const raw = await getState('daily_collect_cursor');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DailyCursor;
  } catch {
    return null;
  }
}

async function saveDailyCursor(cursor: DailyCursor | null): Promise<void> {
  await setState('daily_collect_cursor', cursor ? JSON.stringify(cursor) : '');
}

export interface DailyBatchResult {
  done: boolean;
  processed: number;
  remaining: number;
}

/**
 * Processa um lote de contas dentro do orçamento de tempo (DAILY_BATCH_TIME_BUDGET_MS).
 * Se não existir um ciclo em andamento, inicia um novo (lista as contas e decide
 * o período: backfill completo na 1ª vez, ou só os últimos 2 dias depois).
 * Chame repetidamente (via cron externo) até `done: true`.
 */
export async function runDailySpendBatch(): Promise<DailyBatchResult> {
  if (collecting) {
    console.warn('[Cron] Coleta em andamento; pulando lote de gastos.');
    return { done: false, processed: 0, remaining: -1 };
  }
  collecting = true;
  const startedAt = Date.now();
  try {
    let cursor = await loadDailyCursor();
    if (!cursor) {
      const accounts = await listAdAccounts();
      const isFirstRun = !(await getState('last_daily_collect'));
      const since = isFirstRun ? daysAgo(config.cron.backfillDays) : daysAgo(2);
      cursor = { accountIds: accounts.map((a) => a.id), since, until: today() };
      console.log(
        `[Coleta] Novo ciclo de gastos${isFirstRun ? ` (backfill ${config.cron.backfillDays}d)` : ''}: ` +
          `${cursor.accountIds.length} contas.`,
      );
    }

    let processed = 0;
    while (cursor.accountIds.length > 0 && Date.now() - startedAt < DAILY_BATCH_TIME_BUDGET_MS) {
      const id = cursor.accountIds[0];
      try {
        const rows = await getDailySpend(id, cursor.since, cursor.until);
        await saveDailySpend(rows);
      } catch (err) {
        console.error(`[Coleta] Gastos falhou em ${id}: ${(err as Error).message}`);
      }
      cursor.accountIds = cursor.accountIds.slice(1);
      processed += 1;
      await saveDailyCursor(cursor.accountIds.length > 0 ? cursor : null);
      if (cursor.accountIds.length > 0) await sleep(config.rateLimit.requestDelayMs);
    }

    const done = cursor.accountIds.length === 0;
    if (done) {
      await setState('last_daily_collect', new Date().toISOString());
      console.log(`[Coleta] Ciclo de gastos concluído (${processed} contas neste lote).`);
    } else {
      console.log(
        `[Coleta] Lote de gastos: ${processed} processadas, ${cursor.accountIds.length} restantes.`,
      );
    }
    return { done, processed, remaining: cursor.accountIds.length };
  } finally {
    collecting = false;
  }
}
