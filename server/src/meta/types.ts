/** Tipos das respostas da Meta Marketing API (Graph API). */

/** Conta de anúncio como vem em /{business}/owned_ad_accounts. */
export interface RawAdAccount {
  id: string; // "act_123..."
  name?: string;
  account_status?: number;
  spend_cap?: string; // em centavos (menor unidade da moeda)
  amount_spent?: string; // em centavos
  balance?: string; // em centavos
  currency?: string;
  disable_reason?: number;
  business?: { id: string; name: string };
}

/** Uma linha de insights diários (level=account, time_increment=1). */
export interface RawDailyInsight {
  spend?: string; // já na unidade normal da moeda (ex.: "153.42")
  date_start?: string; // YYYY-MM-DD
  date_stop?: string; // YYYY-MM-DD
}

/** Envelope de paginação padrão da Graph API. */
export interface Paged<T> {
  data: T[];
  paging?: {
    cursors?: { before?: string; after?: string };
    next?: string;
    previous?: string;
  };
  error?: GraphError;
}

export interface GraphError {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

/** Conta já normalizada para uso interno (valores em unidade normal da moeda). */
export interface AdAccount {
  id: string;
  name: string;
  status: number;
  disableReason: number | null;
  currency: string;
  businessId: string | null;
  businessName: string | null;
  spendCap: number | null; // null = sem limite definido
  amountSpent: number;
  balance: number | null;
  available: number | null; // spendCap - amountSpent, ou null se sem limite
  pctUsed: number | null; // 0..100, ou null se sem limite
}

/** Gasto de um dia para uma conta. */
export interface DailySpend {
  accountId: string;
  date: string; // YYYY-MM-DD
  spend: number;
}

/** Campanha crua como vem em /{act_id}/campaigns. */
export interface RawCampaign {
  id: string;
  name: string;
  status?: string; // ACTIVE, PAUSED, etc. (status configurado pelo usuário)
  effective_status?: string; // status real (considera conta/orçamento pausados)
  daily_budget?: string; // em centavos
  lifetime_budget?: string; // em centavos
}

/** Campanha normalizada (valores em unidade normal da moeda). */
export interface Campaign {
  id: string;
  accountId: string;
  name: string;
  status: string;
  effectiveStatus: string;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
}

/** Uma linha de insights diários por campanha (level=campaign, time_increment=1). */
export interface RawCampaignInsight {
  campaign_id?: string;
  spend?: string;
  clicks?: string;
  date_start?: string;
  actions?: Array<{ action_type: string; value: string }>;
}

/** Insight diário de campanha, já normalizado. */
export interface CampaignDailyInsight {
  campaignId: string;
  date: string; // YYYY-MM-DD
  spend: number;
  clicks: number;
  pageViews: number;
  initiateCheckout: number;
}
