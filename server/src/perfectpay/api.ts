import { config } from '../config/index.js';
import type { SaleInput } from '../db/index.js';
import { apiStatusToEnum, currencyFromEnum } from './status.js';

/**
 * Cliente da API de Vendas da PerfectPay.
 * Endpoint: POST https://app.perfectpay.com.br/api/v1/sales/get
 * Auth: header Authorization: Bearer <token pessoal>.
 * A resposta vem paginada em sales.{data,current_page,total_pages,total_items}.
 */
const API_BASE = 'https://app.perfectpay.com.br/api/v1';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface RawApiSale {
  transaction_token?: string;
  value?: string | number;
  currency_enum?: number;
  currency_enum_key?: string;
  sale_status?: string;
  payment_type?: number;
  product_code?: string;
  product_name?: string;
  date_created?: string;
  date_approved?: string;
  customer?: Array<{ full_name?: string; email?: string }> | { full_name?: string; email?: string };
}

interface SalesPage {
  current_page: number;
  total_pages: number;
  total_items: number;
  data: RawApiSale[];
}

export interface SalesFilter {
  /** Filtro por data da venda (YYYY-MM-DD). */
  startDateSale?: string;
  endDateSale?: string;
  /** Filtro por data de atualização (para reconciliação incremental). */
  startDateUpdated?: string;
  endDateUpdated?: string;
}

function emptyToNull(v: string | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Converte uma venda crua da API para o formato interno (SaleInput). */
export function normalizeApiSale(raw: RawApiSale): SaleInput | null {
  const code = emptyToNull(raw.transaction_token as string | undefined);
  if (!code) return null;
  const customer = Array.isArray(raw.customer) ? raw.customer[0] : raw.customer;
  return {
    code,
    saleAmount: Number(raw.value) || 0,
    currency: currencyFromEnum(raw.currency_enum, raw.currency_enum_key),
    status: apiStatusToEnum(raw.sale_status),
    statusDetail: raw.sale_status ?? null,
    paymentType: typeof raw.payment_type === 'number' ? raw.payment_type : null,
    productCode: raw.product_code ?? null,
    productName: raw.product_name ?? null,
    customerName: customer?.full_name ?? null,
    customerEmail: customer?.email ?? null,
    dateCreated: emptyToNull(raw.date_created),
    dateApproved: emptyToNull(raw.date_approved),
    raw: JSON.stringify(raw),
  };
}

function buildBody(filter: SalesFilter, page: number): Record<string, unknown> {
  const body: Record<string, unknown> = { page };
  if (filter.startDateSale) body.start_date_sale = filter.startDateSale;
  if (filter.endDateSale) body.end_date_sale = filter.endDateSale;
  if (filter.startDateUpdated) body.start_date_updated = filter.startDateUpdated;
  if (filter.endDateUpdated) body.end_date_updated = filter.endDateUpdated;
  return body;
}

async function fetchPage(filter: SalesFilter, page: number): Promise<SalesPage> {
  const token = config.perfectpay.apiToken;
  if (!token) throw new Error('PERFECTPAY_API_TOKEN não configurado.');

  const res = await fetch(`${API_BASE}/sales/get`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(buildBody(filter, page)),
  });

  const json = (await res.json().catch(() => null)) as { sales?: SalesPage; message?: string } | null;
  if (!res.ok || !json?.sales) {
    const msg = json?.message ?? `HTTP ${res.status}`;
    throw new Error(`[PerfectPay API] Falha ao buscar vendas (página ${page}): ${msg}`);
  }
  return json.sales;
}

/**
 * Busca TODAS as vendas do filtro, seguindo a paginação. Retorna a lista já
 * normalizada. `onProgress` é chamado a cada página (para log).
 *
 * `maxDurationMs` interrompe a paginação se o tempo for excedido (essencial em
 * hosts serverless com limite de execução) — o que faltar é buscado na
 * próxima chamada, já que os filtros de data são idempotentes (upsert).
 */
export async function fetchAllSales(
  filter: SalesFilter,
  onProgress?: (page: number, totalPages: number, count: number) => void,
  maxDurationMs = Infinity, // sem limite por padrão (hosts tradicionais); cron routes passam um valor
): Promise<{ sales: SaleInput[]; complete: boolean }> {
  const out: SaleInput[] = [];
  const startedAt = Date.now();
  let page = 1;
  let totalPages = 1;
  let complete = true;

  do {
    if (Date.now() - startedAt > maxDurationMs) {
      complete = false;
      console.warn(
        `[PerfectPay API] Orçamento de tempo excedido na página ${page}/${totalPages} — ` +
          'continuará na próxima sincronização.',
      );
      break;
    }
    const sales = await fetchPage(filter, page);
    totalPages = sales.total_pages || 1;
    for (const raw of sales.data) {
      const norm = normalizeApiSale(raw);
      if (norm) out.push(norm);
    }
    onProgress?.(page, totalPages, sales.total_items);
    page += 1;
    if (page <= totalPages) await sleep(300); // respeita o rate limit da API
  } while (page <= totalPages);

  return { sales: out, complete };
}
