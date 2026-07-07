import { config } from '../config/index.js';
import { fetchAllSales, type SalesFilter } from '../perfectpay/api.js';
import { saveSale, setState } from '../db/index.js';
import { ymd } from './collector.js';

let syncing = false;

export function isSyncingSales(): boolean {
  return syncing;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}

/** Habilitado só quando há token da API configurado. */
export function salesApiEnabled(): boolean {
  return config.perfectpay.apiToken.length > 0;
}

export interface SyncSalesResult {
  count: number;
  /** false = o orçamento de tempo acabou antes de paginar tudo (retoma sozinho na próxima chamada). */
  complete: boolean;
}

/**
 * Sincroniza vendas da PerfectPay via API e grava (upsert) na tabela `sales`.
 * `filter` define o recorte (por data da venda ou de atualização).
 * Respeita um orçamento de tempo (essencial em hosts serverless) — se não
 * completar, a próxima chamada cobre o mesmo período (idempotente).
 */
export async function syncSales(
  filter: SalesFilter,
  maxDurationMs?: number,
): Promise<SyncSalesResult> {
  if (!salesApiEnabled()) {
    throw new Error('PERFECTPAY_API_TOKEN não configurado — não é possível sincronizar vendas.');
  }
  if (syncing) {
    console.warn('[Vendas] Sincronização já em andamento; ignorando.');
    return { count: 0, complete: false };
  }
  syncing = true;
  const started = Date.now();
  try {
    const { sales, complete } = await fetchAllSales(
      filter,
      (page, total, items) => {
        console.log(`[Vendas] Página ${page}/${total} (${items} vendas no total).`);
      },
      maxDurationMs,
    );
    for (const s of sales) await saveSale(s);
    if (complete) await setState('last_sales_sync', new Date().toISOString());
    console.log(
      `[Vendas] Sincronizadas ${sales.length} vendas em ${((Date.now() - started) / 1000).toFixed(1)}s` +
        (complete ? '.' : ' (parcial — continua na próxima chamada).'),
    );
    return { count: sales.length, complete };
  } finally {
    syncing = false;
  }
}

/** Backfill do histórico (últimos N dias, por data da venda). */
export async function backfillSales(maxDurationMs?: number): Promise<SyncSalesResult> {
  const since = daysAgo(config.perfectpay.backfillDays);
  console.log(`[Vendas] Backfill desde ${since} (por data da venda).`);
  return syncSales({ startDateSale: since, endDateSale: ymd(new Date()) }, maxDurationMs);
}

/** Sincronização incremental: vendas atualizadas nos últimos dias (reconciliação). */
export async function syncRecentSales(
  days = 3,
  maxDurationMs?: number,
): Promise<SyncSalesResult> {
  return syncSales({ startDateUpdated: daysAgo(days), endDateUpdated: ymd(new Date()) }, maxDurationMs);
}
