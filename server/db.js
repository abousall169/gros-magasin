// Base de données SQLite locale (module intégré à Node.js, aucune installation native).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.resolve(process.env.GM_DATA_DIR || path.join(ROOT, 'data'));
export const BACKUP_DIR = path.resolve(process.env.GM_BACKUP_DIR || path.join(ROOT, 'backups'));
export const DB_FILE = path.join(DATA_DIR, 'grand-magasin.db');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

export const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

// ---------------------------------------------------------------------------
// Schéma et migrations (PRAGMA user_version)
// ---------------------------------------------------------------------------
const MIGRATIONS = [
  // v1 : schéma initial
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'cashier')),
    pin_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device TEXT,
    created_at TEXT NOT NULL,
    last_seen TEXT NOT NULL
  );

  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    barcode TEXT,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    unit TEXT NOT NULL DEFAULT 'pièce',
    retail_price REAL NOT NULL DEFAULT 0,
    pack_unit TEXT,
    pack_size REAL NOT NULL DEFAULT 1,
    wholesale_price REAL NOT NULL DEFAULT 0,
    cost_price REAL NOT NULL DEFAULT 0,
    stock REAL NOT NULL DEFAULT 0,
    min_stock REAL NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL;
  CREATE INDEX idx_products_name ON products(name COLLATE NOCASE);

  CREATE TABLE customers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    type TEXT NOT NULL DEFAULT 'retail' CHECK (type IN ('retail', 'wholesale')),
    credit_limit REAL NOT NULL DEFAULT 0,
    opening_balance REAL NOT NULL DEFAULT 0,
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_customers_name ON customers(name COLLATE NOCASE);

  CREATE TABLE suppliers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sales (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    customer_id INTEGER REFERENCES customers(id),
    mode TEXT NOT NULL DEFAULT 'retail',
    subtotal REAL NOT NULL,
    discount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL,
    paid REAL NOT NULL DEFAULT 0,
    received REAL NOT NULL DEFAULT 0,
    change_given REAL NOT NULL DEFAULT 0,
    cost_total REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
    note TEXT,
    created_at TEXT NOT NULL,
    cancelled_at TEXT,
    cancelled_by INTEGER REFERENCES users(id),
    cancel_reason TEXT
  );
  CREATE INDEX idx_sales_created ON sales(created_at);
  CREATE INDEX idx_sales_customer ON sales(customer_id);
  CREATE INDEX idx_sales_user ON sales(user_id, created_at);

  CREATE TABLE sale_items (
    id INTEGER PRIMARY KEY,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    sale_type TEXT NOT NULL CHECK (sale_type IN ('retail', 'wholesale')),
    unit_label TEXT NOT NULL,
    qty REAL NOT NULL,
    units_per REAL NOT NULL DEFAULT 1,
    base_qty REAL NOT NULL,
    unit_price REAL NOT NULL,
    list_price REAL NOT NULL,
    total REAL NOT NULL,
    unit_cost REAL NOT NULL DEFAULT 0,
    cost_total REAL NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
  CREATE INDEX idx_sale_items_product ON sale_items(product_id);

  CREATE TABLE sale_payments (
    id INTEGER PRIMARY KEY,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    amount REAL NOT NULL
  );
  CREATE INDEX idx_sale_payments_sale ON sale_payments(sale_id);

  CREATE TABLE customer_payments (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount REAL NOT NULL,
    method TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_customer_payments_customer ON customer_payments(customer_id);
  CREATE INDEX idx_customer_payments_created ON customer_payments(created_at);

  CREATE TABLE purchases (
    id INTEGER PRIMARY KEY,
    supplier_id INTEGER REFERENCES suppliers(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    reference TEXT,
    total REAL NOT NULL DEFAULT 0,
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_purchases_created ON purchases(created_at);

  CREATE TABLE purchase_items (
    id INTEGER PRIMARY KEY,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    unit_type TEXT NOT NULL,
    unit_label TEXT NOT NULL,
    qty REAL NOT NULL,
    units_per REAL NOT NULL DEFAULT 1,
    base_qty REAL NOT NULL,
    unit_cost REAL NOT NULL,
    total REAL NOT NULL
  );
  CREATE INDEX idx_purchase_items_purchase ON purchase_items(purchase_id);

  CREATE TABLE stock_movements (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    qty REAL NOT NULL,
    stock_after REAL NOT NULL,
    ref_id INTEGER,
    reason TEXT,
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_movements_product ON stock_movements(product_id, created_at);
  CREATE INDEX idx_movements_created ON stock_movements(created_at);

  CREATE TABLE expenses (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    method TEXT NOT NULL DEFAULT 'Espèces',
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_expenses_created ON expenses(created_at);
  `,
];

function migrate() {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
migrate();

// ---------------------------------------------------------------------------
// Aide aux requêtes
// ---------------------------------------------------------------------------
const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

// node:sqlite refuse undefined et les booléens : on les convertit.
function clean(v) {
  if (v === undefined) return null;
  if (v === true) return 1;
  if (v === false) return 0;
  return v;
}
function params(args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    const o = {};
    for (const [k, v] of Object.entries(args[0])) o[k] = clean(v);
    return [o];
  }
  return args.map(clean);
}

const plain = (row) => (row ? { ...row } : row);

export const q = {
  all: (sql, ...args) => stmt(sql).all(...params(args)).map(plain),
  get: (sql, ...args) => plain(stmt(sql).get(...params(args))),
  run: (sql, ...args) => {
    const r = stmt(sql).run(...params(args));
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  },
  /** Valeur de la première colonne de la première ligne. */
  val: (sql, ...args) => {
    const row = stmt(sql).get(...params(args));
    return row ? Object.values(row)[0] : null;
  },
};

let depth = 0;
/** Exécute fn dans une transaction (les appels imbriqués réutilisent la transaction courante). */
export function tx(fn) {
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}
