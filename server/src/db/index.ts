import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/index.js';
import type { AdAccount, DailySpend } from '../meta/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// DATABASE_PATH (ex.: disco persistente do host) ou, por padrão,
// server/data/tracktudo.db (a pasta data/ está no .gitignore).
const DB_PATH = config.server.databasePath
  ? isAbsolute(config.server.databasePath)
    ? config.server.databasePath
    : resolve(process.cwd(), config.server.databasePath)
  : resolve(__dirname, '../../data/tracktudo.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/** Cria as tabelas se ainda não existirem. */
export function initSchema(): void {
  createTables();
}

function createTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id            TEXT PRIMARY KEY,        -- "act_123..."
      name          TEXT NOT NULL,
      currency      TEXT NOT NULL DEFAULT '',
      status        INTEGER NOT NULL DEFAULT 0,
      disable_reason INTEGER,
      updated_at    TEXT NOT NULL            -- ISO 8601
    );

    CREATE TABLE IF NOT EXISTS limit_snapshots (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id   TEXT NOT NULL REFERENCES accounts(id),
      spend_cap    REAL,                     -- null = sem limite
      amount_spent REAL NOT NULL DEFAULT 0,
      balance      REAL,
      available    REAL,                     -- null = sem limite
      pct_used     REAL,                     -- null = sem limite
      captured_at  TEXT NOT NULL             -- ISO 8601
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_account
      ON limit_snapshots(account_id, captured_at DESC);

    CREATE TABLE IF NOT EXISTS daily_spend (
      account_id TEXT NOT NULL REFERENCES accounts(id),
      date       TEXT NOT NULL,              -- YYYY-MM-DD
      spend      REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (account_id, date)
    );
    CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_spend(date);

    -- Metadados simples (ex.: horário da última coleta de cada tipo).
    CREATE TABLE IF NOT EXISTS meta_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// Garante que as tabelas existem ANTES de compilar os statements abaixo.
createTables();

// ---------- Statements preparados ----------

const upsertAccountStmt = db.prepare(`
  INSERT INTO accounts (id, name, currency, status, disable_reason, updated_at)
  VALUES (@id, @name, @currency, @status, @disableReason, @updatedAt)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    currency = excluded.currency,
    status = excluded.status,
    disable_reason = excluded.disable_reason,
    updated_at = excluded.updated_at
`);

const insertSnapshotStmt = db.prepare(`
  INSERT INTO limit_snapshots
    (account_id, spend_cap, amount_spent, balance, available, pct_used, captured_at)
  VALUES
    (@accountId, @spendCap, @amountSpent, @balance, @available, @pctUsed, @capturedAt)
`);

const upsertDailySpendStmt = db.prepare(`
  INSERT INTO daily_spend (account_id, date, spend)
  VALUES (@accountId, @date, @spend)
  ON CONFLICT(account_id, date) DO UPDATE SET spend = excluded.spend
`);

const setStateStmt = db.prepare(`
  INSERT INTO meta_state (key, value) VALUES (@key, @value)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);
const getStateStmt = db.prepare(`SELECT value FROM meta_state WHERE key = ?`);

// ---------- Funções de persistência ----------

/** Grava uma conta e um snapshot de limite (numa transação). */
export function saveAccountSnapshot(acc: AdAccount, capturedAt: string): void {
  const tx = db.transaction(() => {
    upsertAccountStmt.run({
      id: normalizeId(acc.id),
      name: acc.name,
      currency: acc.currency,
      status: acc.status,
      disableReason: acc.disableReason,
      updatedAt: capturedAt,
    });
    insertSnapshotStmt.run({
      accountId: normalizeId(acc.id),
      spendCap: acc.spendCap,
      amountSpent: acc.amountSpent,
      balance: acc.balance,
      available: acc.available,
      pctUsed: acc.pctUsed,
      capturedAt,
    });
  });
  tx();
}

/** Grava/atualiza vários dias de gasto (upsert). */
export function saveDailySpend(rows: DailySpend[]): void {
  const tx = db.transaction((items: DailySpend[]) => {
    for (const r of items) {
      upsertDailySpendStmt.run({
        accountId: normalizeId(r.accountId),
        date: r.date,
        spend: r.spend,
      });
    }
  });
  tx(rows);
}

export function setState(key: string, value: string): void {
  setStateStmt.run({ key, value });
}

export function getState(key: string): string | null {
  const row = getStateStmt.get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function normalizeId(id: string): string {
  return id.startsWith('act_') ? id : `act_${id}`;
}
