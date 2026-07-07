import 'dotenv/config';

/**
 * Configuração central do TRACKTUDO, lida de variáveis de ambiente.
 * O token NUNCA é hardcoded — sempre vem do .env.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    // Não lançamos aqui para não impedir o scaffold de subir;
    // a validação forte acontece em assertMetaConfig() antes de coletar.
    return '';
  }
  return value.trim();
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface MetaToken {
  /** Rótulo amigável para logs (ex.: "system-user", "arthur"). */
  label: string;
  /** O valor do access_token. */
  value: string;
}

/**
 * Lê os tokens da Meta de duas fontes (deduplicadas):
 *  - META_SYSTEM_USER_TOKEN: um único token (compatibilidade).
 *  - META_TOKENS: lista separada por vírgula; cada item pode ser "rotulo|token"
 *    ou apenas "token". Ex.: "system-user|EAA...,arthur|EAB..."
 * As contas de todos os tokens são unidas (sem duplicar) em me/adaccounts.
 */
function parseTokens(): MetaToken[] {
  const out: MetaToken[] = [];
  const seen = new Set<string>();

  const add = (label: string, value: string): void => {
    const v = value.trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push({ label: label.trim() || `token${out.length + 1}`, value: v });
  };

  const primary = process.env.META_SYSTEM_USER_TOKEN?.trim();
  if (primary) add('system-user', primary);

  const multi = process.env.META_TOKENS?.trim();
  if (multi) {
    for (const raw of multi.split(',')) {
      const item = raw.trim();
      if (!item) continue;
      const sep = item.indexOf('|');
      if (sep > 0) add(item.slice(0, sep), item.slice(sep + 1));
      else add('', item);
    }
  }

  return out;
}

const metaTokens = parseTokens();

export const config = {
  meta: {
    /** Lista de tokens da Meta (um ou vários). As contas de todos são unidas. */
    tokens: metaTokens,
    /** Primeiro token — usado em chamadas globais e health check (compat). */
    get accessToken(): string {
      return metaTokens[0]?.value ?? '';
    },
    businessId: required('META_BUSINESS_ID'),
    apiVersion: process.env.META_API_VERSION?.trim() || 'v25.0',
    get baseUrl(): string {
      return `https://graph.facebook.com/${this.apiVersion}`;
    },
  },
  server: {
    port: num('PORT', 3000),
    nodeEnv: process.env.NODE_ENV?.trim() || 'development',
    get isProduction(): boolean {
      return this.nodeEnv === 'production';
    },
    /**
     * Connection string do Postgres (Neon/Supabase/etc.).
     * Ex.: postgresql://user:pass@host/db?sslmode=require
     */
    databaseUrl: process.env.DATABASE_URL?.trim() || '',
  },
  auth: {
    /** Senha única para acessar o dashboard. Vazio = sem login (apenas dev/local). */
    password: process.env.APP_PASSWORD?.trim() || '',
    /** Segredo para assinar o cookie de sessão. */
    secret: process.env.SESSION_SECRET?.trim() || '',
  },
  perfectpay: {
    /**
     * Token de segurança do webhook da PerfectPay. Se definido, só aceitamos
     * postbacks cujo campo "token" bata com este valor. Deixe vazio só em teste.
     */
    webhookToken: process.env.PERFECTPAY_WEBHOOK_TOKEN?.trim() || '',
    /**
     * Token Pessoal da API (JWT) — Ferramentas → API → Gerar Token Pessoal.
     * Usado para puxar o histórico de vendas (backfill/reconciliação).
     */
    apiToken: process.env.PERFECTPAY_API_TOKEN?.trim() || '',
    /** Dias de histórico no backfill inicial de vendas (padrão 365). */
    backfillDays: num('PERFECTPAY_BACKFILL_DAYS', 365),
  },
  cron: {
    limits: process.env.CRON_LIMITS?.trim() || '0 */12 * * *',
    dailySpend: process.env.CRON_DAILY_SPEND?.trim() || '0 */6 * * *',
    backfillDays: num('BACKFILL_DAYS', 30),
    /** Sincronização incremental de vendas (padrão: a cada hora). */
    salesSync: process.env.CRON_SALES_SYNC?.trim() || '15 * * * *',
  },
  rateLimit: {
    requestDelayMs: num('REQUEST_DELAY_MS', 250),
    usageThreshold: num('USAGE_THRESHOLD', 80),
  },
} as const;

/**
 * Valida que as credenciais da Meta estão presentes.
 * Chamada antes de qualquer coleta real (não no boot do scaffold).
 */
export function assertMetaConfig(): void {
  // Apenas o token é obrigatório. As contas vêm de me/adaccounts (não dependem
  // de um Business ID). META_BUSINESS_ID fica opcional (uso futuro / filtros).
  if (config.meta.tokens.length === 0) {
    throw new Error(
      'Nenhum token da Meta configurado. Preencha META_SYSTEM_USER_TOKEN ou ' +
        'META_TOKENS no arquivo server/.env (veja server/.env.example).',
    );
  }
}

export function hasMetaConfig(): boolean {
  return config.meta.tokens.length > 0;
}
