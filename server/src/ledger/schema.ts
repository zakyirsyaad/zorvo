/**
 * The Ledger's SQLite tables (spec 7.2), the single place they are created. Times are epoch
 * milliseconds. Money is kept as whole numbers: credits as credits, stock in nano-USD (scale 9).
 * Later tasks add their tables here.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    secret_hash TEXT NOT NULL UNIQUE,
    nearai_key_id TEXT,
    credits_bought INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS topups (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    package_usd INTEGER NOT NULL,
    credits INTEGER NOT NULL,
    status TEXT NOT NULL,
    ping_session_id TEXT,
    ping_payment_id TEXT,
    reserved_until INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reservations (
    topup_id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    credits INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  // kind is 'credit' or 'rotate_key'.
  `CREATE TABLE IF NOT EXISTS queue (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    ref TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS promos (
    code_hash TEXT PRIMARY KEY,
    credits INTEGER NOT NULL,
    max_uses INTEGER NOT NULL,
    uses INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS pending_keys (
    device_id TEXT PRIMARY KEY,
    key_ciphertext TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  // One row (id = 1).
  `CREATE TABLE IF NOT EXISTS operator (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    refresh_token_ciphertext TEXT NOT NULL,
    access_token TEXT,
    access_expires_at INTEGER,
    version INTEGER NOT NULL DEFAULT 0
  )`,
  // One row (id = 1). Both amounts are nano-USD of NEAR AI cost, despite the spec's column names.
  `CREATE TABLE IF NOT EXISTS snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    org_remaining_usd INTEGER NOT NULL,
    outstanding_usd INTEGER NOT NULL,
    taken_at INTEGER NOT NULL
  )`,
  // Replaced on every snapshot refresh with the keys that belong to devices (nano-USD).
  // limit_nano is NULL for a key without a spend limit.
  `CREATE TABLE IF NOT EXISTS key_usage (
    key_id TEXT PRIMARY KEY,
    limit_nano INTEGER,
    usage_nano INTEGER
  )`,
  // Fixed-window counters, e.g. key 'devices:<ip>'.
  `CREATE TABLE IF NOT EXISTS ratelimits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    window_start INTEGER NOT NULL
  )`,
  // Webhook event ids already seen.
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    received_at INTEGER NOT NULL
  )`,
];

export function applySchema(sql: SqlStorage): void {
  for (const statement of STATEMENTS) sql.exec(statement);
}
