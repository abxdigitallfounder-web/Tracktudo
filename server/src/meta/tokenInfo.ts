import { config } from '../config/index.js';

/** Informação de validade de um token (sem expor o valor do token). */
export interface TokenInfo {
  label: string;
  type: string; // USER, SYSTEM_USER, PAGE, ...
  valid: boolean;
  expiresAt: number | null; // unix (segundos); null = nunca expira
  daysLeft: number | null; // dias até expirar; null = nunca expira
  error?: string;
}

// Cache: debug_token muda raramente, então evitamos chamar a cada request.
let cache: { at: number; data: TokenInfo[] } | null = null;
const TTL_MS = 6 * 60 * 60 * 1000; // 6h

async function inspectToken(label: string, token: string): Promise<TokenInfo> {
  try {
    const url =
      `${config.meta.baseUrl}/debug_token` +
      `?input_token=${encodeURIComponent(token)}` +
      `&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const json = (await res.json()) as {
      data?: { type?: string; is_valid?: boolean; expires_at?: number };
      error?: { message?: string };
    };
    const d = json.data;
    if (!d || json.error) {
      return {
        label,
        type: 'desconhecido',
        valid: false,
        expiresAt: null,
        daysLeft: null,
        error: json.error?.message ?? 'sem dados',
      };
    }
    // expires_at 0 (ou ausente) = nunca expira (típico de System User).
    const exp = typeof d.expires_at === 'number' && d.expires_at > 0 ? d.expires_at : null;
    const daysLeft =
      exp == null ? null : Math.floor((exp * 1000 - Date.now()) / (24 * 60 * 60 * 1000));
    return {
      label,
      type: d.type ?? 'desconhecido',
      valid: Boolean(d.is_valid),
      expiresAt: exp,
      daysLeft,
    };
  } catch (err) {
    return {
      label,
      type: 'desconhecido',
      valid: false,
      expiresAt: null,
      daysLeft: null,
      error: (err as Error).message,
    };
  }
}

/** Retorna a validade de todos os tokens configurados (com cache de 6h). */
export async function getTokensInfo(force = false): Promise<TokenInfo[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const data: TokenInfo[] = [];
  for (const { label, value } of config.meta.tokens) {
    data.push(await inspectToken(label, value));
  }
  cache = { at: Date.now(), data };
  return data;
}
