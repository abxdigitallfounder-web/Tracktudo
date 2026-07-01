import { config } from '../config/index.js';
import {
  centsToUnit,
  spendToUnit,
} from './accountStatus.js';
import type {
  AdAccount,
  DailySpend,
  Paged,
  RawAdAccount,
  RawDailyInsight,
} from './types.js';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Códigos de erro da Meta que indicam throttle (rate limit). */
const THROTTLE_CODES = new Set([17, 613, 80000, 80004]);
const MAX_RETRIES = 5;

interface UsageInfo {
  /** Maior call_count (%) encontrado no header, 0..100+. */
  callCount: number;
  /** Segundos estimados até recuperar acesso (0 = sem bloqueio). */
  estimatedTimeToRegainAccess: number;
}

/**
 * Lê o header X-Business-Use-Case-Usage e extrai o maior consumo de cota.
 * O header é um objeto keyed por id de negócio/conta, cada valor é um array
 * de casos de uso com { call_count, estimated_time_to_regain_access, ... }.
 */
function parseUsage(headerValue: string | null): UsageInfo | null {
  if (!headerValue) return null;
  try {
    const parsed = JSON.parse(headerValue) as Record<
      string,
      Array<{ call_count?: number; estimated_time_to_regain_access?: number }>
    >;
    let callCount = 0;
    let estimated = 0;
    for (const entries of Object.values(parsed)) {
      for (const e of entries) {
        callCount = Math.max(callCount, e.call_count ?? 0);
        estimated = Math.max(estimated, e.estimated_time_to_regain_access ?? 0);
      }
    }
    return { callCount, estimatedTimeToRegainAccess: estimated };
  } catch {
    return null;
  }
}

export interface RequestResult<T> {
  body: T;
  usage: UsageInfo | null;
}

/**
 * Faz uma requisição GET à Graph API, com:
 * - token de System User anexado como access_token;
 * - leitura do header de cota (X-Business-Use-Case-Usage);
 * - desaceleração ao passar do limite de uso;
 * - backoff exponencial nos erros de throttle (respeitando estimated_time_to_regain_access).
 *
 * `contextLabel` aparece nos logs (ex.: nome/id da conta) para saber quem falhou.
 * `token` é o access_token a usar (o app pode ter vários — ver listAdAccounts).
 */
async function graphGet<T>(
  path: string,
  params: Record<string, string>,
  contextLabel: string,
  token: string,
): Promise<RequestResult<T>> {
  const url = new URL(`${config.meta.baseUrl}/${path.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('access_token', token);

  let attempt = 0;
  // Loop de retry para throttle.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(url);
    const usage = parseUsage(res.headers.get('x-business-use-case-usage'));

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    const err = (body as { error?: { code: number; message: string; error_subcode?: number } })
      ?.error;

    if (res.ok && !err) {
      // Sucesso. Se a cota está alta, desacelera as próximas chamadas desta conta.
      if (usage && usage.callCount >= config.rateLimit.usageThreshold) {
        const backoffMs = Math.max(2000, config.rateLimit.requestDelayMs * 8);
        console.warn(
          `[Meta] Cota alta em ${contextLabel}: ${usage.callCount}% usado. ` +
            `Desacelerando ${backoffMs}ms.`,
        );
        await sleep(backoffMs);
      }
      return { body: body as T, usage };
    }

    // Erro de throttle -> backoff exponencial.
    if (err && THROTTLE_CODES.has(err.code) && attempt < MAX_RETRIES) {
      attempt += 1;
      const fromHeader = usage?.estimatedTimeToRegainAccess ?? 0;
      const exponential = Math.min(60, 2 ** attempt); // segundos, teto de 60s
      const waitSec = Math.max(fromHeader, exponential);
      console.warn(
        `[Meta] Throttle (código ${err.code}) em ${contextLabel}. ` +
          `Tentativa ${attempt}/${MAX_RETRIES}, aguardando ${waitSec}s.`,
      );
      await sleep(waitSec * 1000);
      continue;
    }

    // Qualquer outro erro (ou throttle após esgotar retries) -> lança.
    const msg = err
      ? `código ${err.code}${err.error_subcode ? `/${err.error_subcode}` : ''}: ${err.message}`
      : `HTTP ${res.status} ${res.statusText}`;
    throw new Error(`[Meta] Falha em ${contextLabel} -> ${msg}`);
  }
}

/** Normaliza uma conta crua da API para o formato interno. */
function normalizeAccount(raw: RawAdAccount): AdAccount {
  const spendCap = centsToUnit(raw.spend_cap);
  const amountSpent = centsToUnit(raw.amount_spent) ?? 0;
  const balance = centsToUnit(raw.balance);

  // spend_cap 0 ou ausente = "sem limite definido".
  const hasCap = spendCap != null && spendCap > 0;
  const available = hasCap ? spendCap - amountSpent : null;
  const pctUsed = hasCap ? (amountSpent / spendCap) * 100 : null;

  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    status: raw.account_status ?? 0,
    disableReason: raw.disable_reason ?? null,
    currency: raw.currency ?? '',
    spendCap: hasCap ? spendCap : null,
    amountSpent,
    balance,
    available,
    pctUsed,
  };
}

/**
 * Registro de qual token consegue acessar cada conta (chave = "act_...").
 * Preenchido durante listAdAccounts e usado depois em getDailySpend para
 * chamar os insights de cada conta com um token que tem acesso a ela.
 */
const accountToken = new Map<string, string>();

function normalizeActId(accountId: string): string {
  return accountId.startsWith('act_') ? accountId : `act_${accountId}`;
}

/** Token que acessa a conta; cai no primeiro token se não houver registro. */
export function getTokenForAccount(accountId: string): string {
  return accountToken.get(normalizeActId(accountId)) ?? config.meta.accessToken;
}

/** Lista as contas visíveis por UM token, seguindo a paginação por cursor. */
async function listAdAccountsForToken(token: string, label: string): Promise<AdAccount[]> {
  const accounts: AdAccount[] = [];
  let after: string | undefined;
  let page = 0;

  do {
    page += 1;
    const params: Record<string, string> = {
      fields: 'name,account_status,spend_cap,amount_spent,balance,currency,disable_reason',
      limit: '50',
    };
    if (after) params.after = after;

    const { body, usage } = await graphGet<Paged<RawAdAccount>>(
      'me/adaccounts',
      params,
      `me/adaccounts [${label}] (página ${page})`,
      token,
    );

    for (const raw of body.data) accounts.push(normalizeAccount(raw));
    console.log(
      `[Meta] [${label}] página ${page}: ${body.data.length} contas` +
        (usage ? ` (cota ${usage.callCount}%)` : ''),
    );

    after = body.paging?.next ? body.paging.cursors?.after : undefined;
    if (after) await sleep(config.rateLimit.requestDelayMs);
  } while (after);

  return accounts;
}

/**
 * Lista TODAS as contas de anúncio visíveis por TODOS os tokens configurados,
 * unindo os resultados sem duplicar (dedup por id). Registra qual token acessa
 * cada conta. Se um token falhar (ex.: expirado), loga e segue com os demais.
 */
export async function listAdAccounts(): Promise<AdAccount[]> {
  const byId = new Map<string, AdAccount>();
  accountToken.clear();

  for (const { label, value } of config.meta.tokens) {
    try {
      const accounts = await listAdAccountsForToken(value, label);
      let novas = 0;
      for (const acc of accounts) {
        const key = normalizeActId(acc.id);
        if (!byId.has(key)) {
          byId.set(key, acc);
          novas += 1;
        }
        // Primeiro token que enxerga a conta fica responsável por ela.
        if (!accountToken.has(key)) accountToken.set(key, value);
      }
      console.log(
        `[Meta] Token "${label}": ${accounts.length} contas (${novas} novas após dedup).`,
      );
    } catch (err) {
      console.error(
        `[Meta] Token "${label}" falhou ao listar contas: ${(err as Error).message}. ` +
          'Seguindo com os demais tokens.',
      );
    }
  }

  const result = [...byId.values()];
  console.log(
    `[Meta] Total de contas únicas: ${result.length} ` +
      `(de ${config.meta.tokens.length} token(s)).`,
  );
  return result;
}

/**
 * Coleta o gasto diário de UMA conta no intervalo [since, until] (YYYY-MM-DD).
 * time_increment=1 quebra o resultado dia a dia. `spend` já vem na unidade normal.
 */
export async function getDailySpend(
  accountId: string,
  since: string,
  until: string,
  token?: string,
): Promise<DailySpend[]> {
  // accountId pode vir como "act_123" ou "123"; o endpoint espera act_{id}.
  const actId = normalizeActId(accountId);
  // Usa o token informado, ou o que registramos como dono desta conta.
  const useToken = token ?? getTokenForAccount(actId);
  const result: DailySpend[] = [];
  let after: string | undefined;

  do {
    const params: Record<string, string> = {
      fields: 'spend',
      level: 'account',
      time_increment: '1',
      time_range: JSON.stringify({ since, until }),
      limit: '100',
    };
    if (after) params.after = after;

    const { body } = await graphGet<Paged<RawDailyInsight>>(
      `${actId}/insights`,
      params,
      `insights ${actId}`,
      useToken,
    );

    for (const row of body.data) {
      if (!row.date_start) continue;
      result.push({
        accountId: actId,
        date: row.date_start,
        spend: spendToUnit(row.spend),
      });
    }

    after = body.paging?.next ? body.paging.cursors?.after : undefined;
    if (after) await sleep(config.rateLimit.requestDelayMs);
  } while (after);

  return result;
}
