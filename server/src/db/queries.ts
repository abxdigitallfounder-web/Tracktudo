import { db } from './index.js';

/** Conta + snapshot de limite mais recente (para a Tela de Limites). */
export interface AccountRow {
  id: string;
  name: string;
  currency: string;
  status: number;
  disable_reason: number | null;
  updated_at: string;
  spend_cap: number | null;
  amount_spent: number | null;
  balance: number | null;
  available: number | null;
  pct_used: number | null;
  captured_at: string | null;
}

export interface DailySpendRow {
  account_id: string;
  date: string;
  spend: number;
}

const accountsWithLatestStmt = db.prepare(`
  SELECT
    a.id, a.name, a.currency, a.status, a.disable_reason, a.updated_at,
    s.spend_cap, s.amount_spent, s.balance, s.available, s.pct_used, s.captured_at
  FROM accounts a
  LEFT JOIN limit_snapshots s ON s.id = (
    SELECT id FROM limit_snapshots
    WHERE account_id = a.id
    ORDER BY captured_at DESC, id DESC
    LIMIT 1
  )
  ORDER BY a.name COLLATE NOCASE
`);

export function getAccountsWithLatestSnapshot(): AccountRow[] {
  return accountsWithLatestStmt.all() as AccountRow[];
}

const dailyRangeStmt = db.prepare(`
  SELECT account_id, date, spend
  FROM daily_spend
  WHERE date >= @since AND date <= @until
  ORDER BY date ASC, account_id ASC
`);

const dailyRangeByAccountStmt = db.prepare(`
  SELECT account_id, date, spend
  FROM daily_spend
  WHERE date >= @since AND date <= @until AND account_id = @accountId
  ORDER BY date ASC
`);

export function getDailySpendRange(
  since: string,
  until: string,
  accountId?: string,
): DailySpendRow[] {
  if (accountId) {
    const id = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
    return dailyRangeByAccountStmt.all({ since, until, accountId: id }) as DailySpendRow[];
  }
  return dailyRangeStmt.all({ since, until }) as DailySpendRow[];
}

/** Cartões de resumo para o topo da Tela de Limites. */
export interface Summary {
  totalAccounts: number;
  activeAccounts: number;
  nearLimit: number; // contas com pct_used >= 75
  notActive: number; // status != 1
  spentByCurrency: Record<string, number>; // gasto acumulado por moeda
  todaySpendByCurrency: Record<string, number>; // gasto de hoje por moeda
}

export function getSummary(today: string): Summary {
  const accounts = getAccountsWithLatestSnapshot();
  const summary: Summary = {
    totalAccounts: accounts.length,
    activeAccounts: 0,
    nearLimit: 0,
    notActive: 0,
    spentByCurrency: {},
    todaySpendByCurrency: {},
  };

  for (const a of accounts) {
    if (a.status === 1) summary.activeAccounts += 1;
    else summary.notActive += 1;
    if (a.pct_used != null && a.pct_used >= 75) summary.nearLimit += 1;
    if (a.amount_spent != null) {
      summary.spentByCurrency[a.currency] =
        (summary.spentByCurrency[a.currency] ?? 0) + a.amount_spent;
    }
  }

  // Gasto de hoje por moeda (junta daily_spend com a moeda da conta).
  const todayRows = db
    .prepare(
      `SELECT a.currency AS currency, SUM(d.spend) AS total
       FROM daily_spend d JOIN accounts a ON a.id = d.account_id
       WHERE d.date = ? GROUP BY a.currency`,
    )
    .all(today) as Array<{ currency: string; total: number }>;
  for (const r of todayRows) summary.todaySpendByCurrency[r.currency] = r.total;

  return summary;
}
