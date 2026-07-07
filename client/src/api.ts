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
  todaySpend: number;
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
  salesApiEnabled?: boolean;
  salesSyncing?: boolean;
  lastSalesSync?: string | null;
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

// ---- Faturamento (PerfectPay) ----
export interface SalesSummary {
  approvedCount: number;
  todayCount: number;
  pendingCount: number;
  refundedCount: number;
  revenueApprovedByCurrency: Record<string, number>;
  todayRevenueByCurrency: Record<string, number>;
  refundedAmountByCurrency: Record<string, number>;
}

export interface RevenueRow {
  date: string;
  currency: string;
  revenue: number;
  count: number;
}

export interface Sale {
  code: string;
  saleAmount: number;
  currency: string;
  status: number;
  statusLabel: string;
  statusDetail: string | null;
  paymentType: number | null;
  paymentLabel: string;
  productName: string | null;
  customerName: string | null;
  customerEmail: string | null;
  dateApproved: string | null;
  dateCreated: string | null;
  receivedAt: string;
}

export interface DashboardData {
  currency: string;
  grossRevenue: number;
  netRevenue: number;
  refunds: number;
  taxes: number;
  adSpend: number;
  profit: number;
  pendingValue: number;
  roi: number | null;
  margin: number | null;
  approvedCount: number;
  byPayment: Array<{ method: string; count: number }>;
  bySource: Array<{ source: string; count: number; value: number }>;
  byProduct: Array<{ product: string; count: number; value: number }>;
  byCountry: Array<{ country: string; count: number; value: number }>;
  byHour: Array<{ hour: number; count: number }>;
  profitByHour: Array<{ hour: number; profit: number }>;
  approval: Array<{ method: string; rate: number | null }>;
}

export const apiGetDashboard = (since: string, until: string) =>
  get<DashboardData>(`/api/dashboard?since=${since}&until=${until}`);

export const apiGetSalesSummary = () => get<SalesSummary>('/api/sales/summary');
export const apiGetRevenue = (since: string, until: string) =>
  get<RevenueRow[]>(`/api/sales/revenue?since=${since}&until=${until}`);
export const apiGetSales = (limit = 50) => get<Sale[]>(`/api/sales?limit=${limit}`);

export async function apiSyncSales(): Promise<{ started: boolean; message?: string }> {
  const res = await fetch('/api/sales/sync', { method: 'POST' });
  return res.json();
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

export async function apiCreateFolder(name: string, accountIds: string[] = []): Promise<Folder> {
  const res = await fetch('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, accountIds }),
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

export async function apiAddAccountsToFolder(
  folderId: number,
  accountIds: string[],
): Promise<void> {
  await fetch(`/api/folders/${folderId}/accounts`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountIds }),
  });
}

export async function apiSetAccountFolder(id: string, folderId: number | null): Promise<void> {
  await fetch(`/api/accounts/${id}/folder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderId }),
  });
}
