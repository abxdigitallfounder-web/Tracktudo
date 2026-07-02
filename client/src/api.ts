// Camada de acesso à API do backend TRACKTUDO.

export interface Account {
  id: string;
  name: string;
  currency: string;
  status: number;
  statusLabel: string;
  disableReason: number | null;
  businessId: string | null;
  businessName: string | null;
  spendCap: number | null;
  amountSpent: number;
  balance: number | null;
  available: number | null;
  pctUsed: number | null;
  tags: string[];
  folderId: number | null;
  capturedAt: string | null;
}

export interface Folder {
  id: number;
  name: string;
  created_at: string;
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

export interface TokenInfo {
  label: string;
  type: string;
  valid: boolean;
  expiresAt: number | null;
  daysLeft: number | null;
  error?: string;
}

export const apiGetAccounts = () => get<Account[]>('/api/accounts');
export const apiGetSummary = () => get<Summary>('/api/summary');
export const apiGetStatus = () => get<Status>('/api/status');
export const apiGetTokenHealth = () => get<TokenInfo[]>('/api/token-health');

export const apiGetDailySpend = (since: string, until: string) =>
  get<DailySpendRow[]>(`/api/daily-spend?since=${since}&until=${until}`);

export const apiGetAccountDailySpend = (id: string, since: string, until: string) =>
  get<DailySpendRow[]>(`/api/accounts/${id}/daily-spend?since=${since}&until=${until}`);

export async function apiRefresh(): Promise<{ started: boolean; message?: string }> {
  const res = await fetch('/api/refresh', { method: 'POST' });
  return res.json();
}

// ---- Autenticação ----
export interface AuthStatus {
  authEnabled: boolean;
  authenticated: boolean;
}

export const apiAuthStatus = () => get<AuthStatus>('/api/auth-status');

export async function apiLogin(password: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return res.json();
}

export async function apiLogout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST' });
}

export async function apiSetAccountTags(id: string, tags: string[]): Promise<string[]> {
  const res = await fetch(`/api/accounts/${id}/tags`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags }),
  });
  const json = (await res.json()) as { tags?: string[] };
  return json.tags ?? tags;
}

// ---- Pastas ----
export const apiListFolders = () => get<Folder[]>('/api/folders');

export async function apiCreateFolder(name: string): Promise<Folder> {
  const res = await fetch('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function apiRenameFolder(id: number, name: string): Promise<void> {
  await fetch(`/api/folders/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function apiDeleteFolder(id: number): Promise<void> {
  await fetch(`/api/folders/${id}`, { method: 'DELETE' });
}

export async function apiSetAccountFolder(id: string, folderId: number | null): Promise<void> {
  await fetch(`/api/accounts/${id}/folder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderId }),
  });
}
