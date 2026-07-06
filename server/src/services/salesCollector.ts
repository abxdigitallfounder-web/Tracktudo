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

/**
 * Sincroniza vendas da PerfectPay via API e grava (upsert) na tabela `sales`.
 * `filter` define o recorte (por data da venda ou de atualização).
 * Retorna quantas vendas foram processadas.
 */
export async function syncSales(filter: SalesFilter): Promise<number> {
  if (!salesApiEnabled()) {
    throw new Error('PERFECTPAY_API_TOKEN não configurado — não é possível sincronizar vendas.');
  }
  if (syncing) {
    console.warn('[Vendas] Sincronização já em andamento; ignorando.');
    return 0;
  }
  syncing = true;
  const started = Date.now();
  try {
    const sales = await fetchAllSales(filter, (page, total, items) => {
      console.log(`[Vendas] Página ${page}/${total} (${items} vendas no total).`);
    });
    for (const s of sales) await saveSale(s);
    await setState('last_sales_sync', new Date().toISOString());
    console.log(
      `[Vendas] Sincronizadas ${sales.length} vendas em ${((Date.now() - started) / 1000).toFixed(1)}s.`,
    );
    return sales.length;
  } finally {
    syncing = false;
  }
}

/** Backfill do histórico (últimos N dias, por data da venda). */
export async function backfillSales(): Promise<number> {
  const since = daysAgo(config.perfectpay.backfillDays);
  console.log(`[Vendas] Backfill desde ${since} (por data da venda).`);
  return syncSales({ startDateSale: since, endDateSale: ymd(new Date()) });
}

/** Sincronização incremental: vendas atualizadas nos últimos dias (reconciliação). */
export async function syncRecentSales(days = 3): Promise<number> {
  return syncSales({ startDateUpdated: daysAgo(days), endDateUpdated: ymd(new Date()) });
}
