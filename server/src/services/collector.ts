import { config } from '../config/index.js';
import { listAdAccounts, getDailySpend } from '../meta/client.js';
import { saveAccountSnapshot, saveDailySpend, setState, getState } from '../db/index.js';
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

function daysAgo(n: number): string {
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
  for (const acc of list) saveAccountSnapshot(acc, capturedAt);
  setState('last_limits_collect', capturedAt);
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
      saveDailySpend(rows);
      totalRows += rows.length;
      ok += 1;
    } catch (err) {
      fail += 1;
      console.error(`[Coleta] Gastos falhou em ${acc.id} (${acc.name}): ${(err as Error).message}`);
    }
    await sleep(config.rateLimit.requestDelayMs);
  }
  setState('last_daily_collect', new Date().toISOString());
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

    const isFirstRun = !getState('last_daily_collect');
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
