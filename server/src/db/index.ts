import pg from 'pg';
import { config } from '../config/index.js';
import type { AdAccount, DailySpend } from '../meta/types.js';

const { Pool } = pg;
type PoolClient = pg.PoolClient;

/**
 * Conexão com o Postgres (Neon, Supabase, etc.). A connection string vem de
 * DATABASE_URL. Bancos gerenciados exigem SSL — detectamos pela URL e ligamos
 * SSL sem exigir validação estrita do certificado (aceita o cert do provedor).
 */
const connectionString = config.server.databaseUrl;
if (!connectionString) {
  console.warn(
    '[DB] DATABASE_URL não definido. Configure a connection string do Postgres ' +
      '(ex.: Neon) em server/.env — veja server/.env.example.',
  );
}

const needsSsl = /neon\.tech|sslmode=require|render\.com|amazonaws|supabase/.test(
  connectionString,
);

export const pool = new Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 5, // pool pequeno: combina com o free tier do Neon (usar o host -pooler).
});

/** Executa uma função dentro de uma transação (BEGIN/COMMIT/ROLLBACK). */
async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Cria as tabelas (e colunas novas) se ainda não existirem. Idempotente. */
export async function initSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id             TEXT PRIMARY KEY,          -- "act_123..."
      name           TEXT NOT NULL,
      currency       TEXT NOT NULL DEFAULT '',
      status         INTEGER NOT NULL DEFAULT 0,
      disable_reason INTEGER,
      business_id    TEXT,                      -- id do Business Manager dono
      business_name  TEXT,                      -- nome do Business Manager dono
      tags           TEXT,                      -- tags do usuário (JSON array)
      folder_id      INTEGER,                   -- pasta do usuário (opcional)
      updated_at     TEXT NOT NULL              -- ISO 8601
    );

    CREATE TABLE IF NOT EXISTS folders (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS limit_snapshots (
      id           SERIAL PRIMARY KEY,
      account_id   TEXT NOT NULL REFERENCES accounts(id),
      spend_cap    DOUBLE PRECISION,            -- null = sem limite
      amount_spent DOUBLE PRECISION NOT NULL DEFAULT 0,
      balance      DOUBLE PRECISION,
      available    DOUBLE PRECISION,            -- null = sem limite
      pct_used     DOUBLE PRECISION,            -- null = sem limite
      captured_at  TEXT NOT NULL                -- ISO 8601
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_account
      ON limit_snapshots(account_id, captured_at DESC);

    CREATE TABLE IF NOT EXISTS daily_spend (
      account_id TEXT NOT NULL REFERENCES accounts(id),
      date       TEXT NOT NULL,                 -- YYYY-MM-DD
      spend      DOUBLE PRECISION NOT NULL DEFAULT 0,
      PRIMARY KEY (account_id, date)
    );
    CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_spend(date);

    -- Metadados simples (ex.: horário da última coleta de cada tipo).
    CREATE TABLE IF NOT EXISTS meta_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Vendas recebidas via webhook da PerfectPay (faturamento).
    CREATE TABLE IF NOT EXISTS sales (
      code           TEXT PRIMARY KEY,            -- código único da venda
      sale_amount    DOUBLE PRECISION NOT NULL DEFAULT 0,  -- em reais
      currency       TEXT NOT NULL DEFAULT 'BRL',
      status         INTEGER NOT NULL DEFAULT 0,  -- sale_status_enum
      status_detail  TEXT,
      payment_type   INTEGER,                     -- payment_type_enum
      product_code   TEXT,
      product_name   TEXT,
      customer_name  TEXT,
      customer_email TEXT,
      date_created   TEXT,                         -- data da criação (PerfectPay)
      date_approved  TEXT,                         -- data da aprovação (PerfectPay)
      received_at    TEXT NOT NULL,                -- quando recebemos o webhook (ISO)
      raw            TEXT                          -- payload cru (JSON) para auditoria
    );
    CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
    CREATE INDEX IF NOT EXISTS idx_sales_approved ON sales(date_approved);

    -- Migrações idempotentes para bancos já existentes.
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS business_id   TEXT;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS business_name TEXT;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS tags          TEXT;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS folder_id     INTEGER;
  `);
}

/** Salva as tags (array) de uma conta. */
export async function setAccountTags(id: string, tags: string[]): Promise<void> {
  await pool.query(`UPDATE accounts SET tags = $1 WHERE id = $2`, [
    JSON.stringify(tags),
    normalizeId(id),
  ]);
}

// ---------- Pastas ----------
export interface FolderRow {
  id: number;
  name: string;
  created_at: string;
}

export async function listFolders(): Promise<FolderRow[]> {
  const { rows } = await pool.query<FolderRow>(
    `SELECT id, name, created_at FROM folders ORDER BY LOWER(name)`,
  );
  return rows;
}

export async function createFolder(name: string): Promise<FolderRow> {
  const createdAt = new Date().toISOString();
  const { rows } = await pool.query<FolderRow>(
    `INSERT INTO folders (name, created_at) VALUES ($1, $2)
     RETURNING id, name, created_at`,
    [name, createdAt],
  );
  return rows[0];
}

export async function renameFolder(id: number, name: string): Promise<void> {
  await pool.query(`UPDATE folders SET name = $1 WHERE id = $2`, [name, id]);
}

/** Remove a pasta e desvincula as contas que estavam nela. */
export async function deleteFolder(id: number): Promise<void> {
  await withTx(async (c) => {
    await c.query(`UPDATE accounts SET folder_id = NULL WHERE folder_id = $1`, [id]);
    await c.query(`DELETE FROM folders WHERE id = $1`, [id]);
  });
}

/** Define (ou remove, com null) a pasta de uma conta. */
export async function setAccountFolder(id: string, folderId: number | null): Promise<void> {
  await pool.query(`UPDATE accounts SET folder_id = $1 WHERE id = $2`, [
    folderId,
    normalizeId(id),
  ]);
}

/** Atribui várias contas a uma pasta de uma vez (transação). */
export async function setAccountsFolder(
  folderId: number | null,
  ids: string[],
): Promise<void> {
  await withTx(async (c) => {
    for (const id of ids) {
      await c.query(`UPDATE accounts SET folder_id = $1 WHERE id = $2`, [
        folderId,
        normalizeId(id),
      ]);
    }
  });
}

// ---------- Persistência ----------

/** Grava uma conta e um snapshot de limite (numa transação). */
export async function saveAccountSnapshot(acc: AdAccount, capturedAt: string): Promise<void> {
  await saveAccountSnapshots([acc], capturedAt);
}

/**
 * Grava VÁRIAS contas e seus snapshots numa ÚNICA transação (upsert em lote via
 * unnest). Evita 1 ida-e-volta de rede por conta — essencial em hosts
 * serverless com orçamento de tempo curto, e bem mais rápido em qualquer host
 * (ex.: 80 contas: ~55s conta-a-conta vs. ~1-2s em lote).
 */
export async function saveAccountSnapshots(accs: AdAccount[], capturedAt: string): Promise<void> {
  if (accs.length === 0) return;
  const ids = accs.map((a) => normalizeId(a.id));
  await withTx(async (c) => {
    await c.query(
      `INSERT INTO accounts
         (id, name, currency, status, disable_reason, business_id, business_name, updated_at)
       SELECT * FROM unnest(
         $1::text[], $2::text[], $3::text[], $4::int[],
         $5::int[], $6::text[], $7::text[], $8::text[]
       )
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         currency = excluded.currency,
         status = excluded.status,
         disable_reason = excluded.disable_reason,
         business_id = excluded.business_id,
         business_name = excluded.business_name,
         updated_at = excluded.updated_at`,
      [
        ids,
        accs.map((a) => a.name),
        accs.map((a) => a.currency),
        accs.map((a) => a.status),
        accs.map((a) => a.disableReason),
        accs.map((a) => a.businessId),
        accs.map((a) => a.businessName),
        accs.map(() => capturedAt),
      ],
    );
    await c.query(
      `INSERT INTO limit_snapshots
         (account_id, spend_cap, amount_spent, balance, available, pct_used, captured_at)
       SELECT * FROM unnest(
         $1::text[], $2::float8[], $3::float8[],
         $4::float8[], $5::float8[], $6::float8[], $7::text[]
       )`,
      [
        ids,
        accs.map((a) => a.spendCap),
        accs.map((a) => a.amountSpent),
        accs.map((a) => a.balance),
        accs.map((a) => a.available),
        accs.map((a) => a.pctUsed),
        accs.map(() => capturedAt),
      ],
    );
  });
}

/** Grava/atualiza vários dias de gasto (upsert, em transação). */
export async function saveDailySpend(rows: DailySpend[]): Promise<void> {
  if (rows.length === 0) return;
  await withTx(async (c) => {
    for (const r of rows) {
      await c.query(
        `INSERT INTO daily_spend (account_id, date, spend)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id, date) DO UPDATE SET spend = excluded.spend`,
        [normalizeId(r.accountId), r.date, r.spend],
      );
    }
  });
}

export async function setState(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO meta_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export async function getState(key: string): Promise<string | null> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM meta_state WHERE key = $1`,
    [key],
  );
  return rows[0]?.value ?? null;
}

// ---------- Vendas (PerfectPay) ----------
export interface SaleInput {
  code: string;
  saleAmount: number;
  currency: string;
  status: number;
  statusDetail: string | null;
  paymentType: number | null;
  productCode: string | null;
  productName: string | null;
  customerName: string | null;
  customerEmail: string | null;
  dateCreated: string | null;
  dateApproved: string | null;
  raw: string;
}

/**
 * Grava/atualiza uma venda (upsert pelo código). Eventos posteriores do mesmo
 * pedido (ex.: aprovada -> reembolsada) atualizam o status; a data de criação
 * original é preservada.
 */
export async function saveSale(s: SaleInput): Promise<void> {
  await pool.query(
    `INSERT INTO sales
       (code, sale_amount, currency, status, status_detail, payment_type,
        product_code, product_name, customer_name, customer_email,
        date_created, date_approved, received_at, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (code) DO UPDATE SET
       sale_amount = excluded.sale_amount,
       currency = excluded.currency,
       status = excluded.status,
       status_detail = excluded.status_detail,
       payment_type = excluded.payment_type,
       product_code = excluded.product_code,
       product_name = excluded.product_name,
       customer_name = excluded.customer_name,
       customer_email = excluded.customer_email,
       date_approved = excluded.date_approved,
       received_at = excluded.received_at,
       raw = excluded.raw`,
    [
      s.code,
      s.saleAmount,
      s.currency,
      s.status,
      s.statusDetail,
      s.paymentType,
      s.productCode,
      s.productName,
      s.customerName,
      s.customerEmail,
      s.dateCreated,
      s.dateApproved,
      new Date().toISOString(),
      s.raw,
    ],
  );
}

function normalizeId(id: string): string {
  return id.startsWith('act_') ? id : `act_${id}`;
}
