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

export const config = {
  meta: {
    accessToken: required('META_ACCESS_TOKEN'),
    businessId: required('META_BUSINESS_ID'),
    apiVersion: process.env.META_API_VERSION?.trim() || 'v25.0',
    get baseUrl(): string {
      return `https://graph.facebook.com/${this.apiVersion}`;
    },
  },
  server: {
    port: num('PORT', 3000),
  },
  cron: {
    limits: process.env.CRON_LIMITS?.trim() || '0 */12 * * *',
    dailySpend: process.env.CRON_DAILY_SPEND?.trim() || '0 */6 * * *',
    backfillDays: num('BACKFILL_DAYS', 30),
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
  const missing: string[] = [];
  if (!config.meta.accessToken) missing.push('META_ACCESS_TOKEN');
  if (!config.meta.businessId) missing.push('META_BUSINESS_ID');
  if (missing.length > 0) {
    throw new Error(
      `Configuração da Meta ausente: ${missing.join(', ')}. ` +
        'Preencha o arquivo server/.env (veja server/.env.example).',
    );
  }
}

export function hasMetaConfig(): boolean {
  return Boolean(config.meta.accessToken && config.meta.businessId);
}
