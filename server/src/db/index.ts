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
      business_id   TEXT,                    -- id do Business Manager dono
      business_name TEXT,                    -- nome do Business Manager dono
      tags          TEXT,                    -- tags do usuário (JSON array)
      folder_id     INTEGER,                 -- pasta do usuário (opcional)
      updated_at    TEXT NOT NULL            -- ISO 8601
    );

    CREATE TABLE IF NOT EXISTS folders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL
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
  migrateColumns();
}

/** Adiciona colunas novas a bancos já existentes (idempotente). */
function migrateColumns(): void {
  const cols = new Set(
    (db.prepare(`PRAGMA table_info(accounts)`).all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!cols.has('business_id')) db.exec(`ALTER TABLE accounts ADD COLUMN business_id TEXT`);
  if (!cols.has('business_name')) db.exec(`ALTER TABLE accounts ADD COLUMN business_name TEXT`);
  if (!cols.has('tags')) db.exec(`ALTER TABLE accounts ADD COLUMN tags TEXT`);
  if (!cols.has('folder_id')) db.exec(`ALTER TABLE accounts ADD COLUMN folder_id INTEGER`);
}

// Garante que as tabelas existem ANTES de compilar os statements abaixo.
createTables();

// ---------- Statements preparados ----------

const upsertAccountStmt = db.prepare(`
  INSERT INTO accounts
    (id, name, currency, status, disable_reason, business_id, business_name, updated_at)
  VALUES
    (@id, @name, @currency, @status, @disableReason, @businessId, @businessName, @updatedAt)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    currency = excluded.currency,
    status = excluded.status,
    disable_reason = excluded.disable_reason,
    business_id = excluded.business_id,
    business_name = excluded.business_name,
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

// Tags são definidas pelo usuário — o upsert da Meta NÃO as toca (preserva).
const setTagsStmt = db.prepare(`UPDATE accounts SET tags = @tags WHERE id = @id`);

/** Salva as tags (array) de uma conta. */
export function setAccountTags(id: string, tags: string[]): void {
  setTagsStmt.run({ id: normalizeId(id), tags: JSON.stringify(tags) });
}

// ---------- Pastas ----------
export interface FolderRow {
  id: number;
  name: string;
  created_at: string;
}

const listFoldersStmt = db.prepare(`SELECT id, name, created_at FROM folders ORDER BY name COLLATE NOCASE`);
const createFolderStmt = db.prepare(`INSERT INTO folders (name, created_at) VALUES (@name, @createdAt)`);
const renameFolderStmt = db.prepare(`UPDATE folders SET name = @name WHERE id = @id`);
const deleteFolderStmt = db.prepare(`DELETE FROM folders WHERE id = ?`);
const clearFolderRefStmt = db.prepare(`UPDATE accounts SET folder_id = NULL WHERE folder_id = ?`);
const setAccountFolderStmt = db.prepare(`UPDATE accounts SET folder_id = @folderId WHERE id = @id`);

export function listFolders(): FolderRow[] {
  return listFoldersStmt.all() as FolderRow[];
}

export function createFolder(name: string): FolderRow {
  const info = createFolderStmt.run({ name, createdAt: new Date().toISOString() });
  return { id: Number(info.lastInsertRowid), name, created_at: new Date().toISOString() };
}

export function renameFolder(id: number, name: string): void {
  renameFolderStmt.run({ id, name });
}

/** Remove a pasta e desvincula as contas que estavam nela. */
export function deleteFolder(id: number): void {
  const tx = db.transaction(() => {
    clearFolderRefStmt.run(id);
    deleteFolderStmt.run(id);
  });
  tx();
}

/** Define (ou remove, com null) a pasta de uma conta. */
export function setAccountFolder(id: string, folderId: number | null): void {
  setAccountFolderStmt.run({ id: normalizeId(id), folderId });
}

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
      businessId: acc.businessId,
      businessName: acc.businessName,
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
