// Camada de acesso à API do backend TRACKTUDO.

export interface Account {
  id: string;
  name: string;
  currency: string;
  status: number;
  statusLabel: string;
  disableReason: number | null;
  spendCap: number | null;
  amountSpent: number;
  balance: number | null;
  available: number | null;
  pctUsed: number | null;
  capturedAt: string | null;
}

export interface DailySpendRow {
  account_id: string;
  date: string;
  spend: number;
}

export interface Summary {
  totalAccounts: number;
  activeAccounts: number;
  nearLimit: number;
  notActive: number;
  spentByCurrency: Record<string, number>;
  todaySpendByCurrency: Record<string, number>;
}

export interface Status {
  collecting: boolean;
  lastLimitsCollect: string | null;
  lastDailyCollect: string | null;
  tokenCount: number;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Erro ${res.status} em ${url}`);
  return res.json() as Promise<T>;
}

export const apiGetAccounts = () => get<Account[]>('/api/accounts');
export const apiGetSummary = () => get<Summary>('/api/summary');
export const apiGetStatus = () => get<Status>('/api/status');

export const apiGetDailySpend = (since: string, until: string) =>
  get<DailySpendRow[]>(`/api/daily-spend?since=${since}&until=${until}`);

export const apiGetAccountDailySpend = (id: string, since: string, until: string) =>
  get<DailySpendRow[]>(`/api/accounts/${id}/daily-spend?since=${since}&until=${until}`);

export async function apiRefresh(): Promise<{ started: boolean; message?: string }> {
  const res = await fetch('/api/refresh', { method: 'POST' });
  return res.json();
}
