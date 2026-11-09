// Paramètres du magasin et droits d'accès par rôle.
import { q } from './db.js';
import { bad, str, bool, int } from './util.js';

export const CASH = 'Espèces';

export const DEFAULT_SETTINGS = {
  store_name: 'Mon Magasin',
  store_address: '',
  store_phone: '',
  store_tax_id: '',
  currency: 'FCFA',
  currency_decimals: 0,
  receipt_footer: 'Merci de votre visite et à bientôt !',
  receipt_width: '80',
  receipt_show_balance: true,
  allow_negative_stock: false,
  cashier_can_edit_price: false,
  cashier_can_sell_on_credit: true,
  payment_methods: ['Mobile Money', 'Carte bancaire', 'Virement / Chèque'],
  phone_country_code: '',
  demo_data: false,
};

// Validation de chaque clé modifiable
const VALIDATORS = {
  store_name: (v) => str(v, 80) || bad('Le nom du magasin est obligatoire.'),
  store_address: (v) => str(v, 200) || '',
  store_phone: (v) => str(v, 80) || '',
  store_tax_id: (v) => str(v, 120) || '',
  currency: (v) => str(v, 10) || bad('La devise est obligatoire.'),
  currency_decimals: (v) => {
    const n = int(v, -1);
    if (n !== 0 && n !== 2) bad('Nombre de décimales invalide (0 ou 2).');
    return n;
  },
  receipt_footer: (v) => str(v, 300) || '',
  receipt_width: (v) => (String(v) === '58' ? '58' : '80'),
  receipt_show_balance: bool,
  allow_negative_stock: bool,
  cashier_can_edit_price: bool,
  cashier_can_sell_on_credit: bool,
  payment_methods: (v) => {
    if (!Array.isArray(v)) bad('Liste des moyens de paiement invalide.');
    const seen = new Set();
    const out = [];
    for (const m of v) {
      const s = str(m, 40);
      if (!s || s.toLowerCase() === CASH.toLowerCase() || seen.has(s.toLowerCase())) continue;
      seen.add(s.toLowerCase());
      out.push(s);
    }
    return out.slice(0, 12);
  },
  phone_country_code: (v) => (str(v, 4) || '').replace(/\D/g, ''),
  demo_data: bool,
};

let cached = null;

export function getSettings() {
  if (cached) return cached;
  const out = structuredClone(DEFAULT_SETTINGS);
  for (const row of q.all('SELECT key, value FROM settings')) {
    if (!(row.key in DEFAULT_SETTINGS)) continue;
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      /* valeur ignorée */
    }
  }
  cached = out;
  return out;
}

export function updateSettings(patch) {
  const clean = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (!VALIDATORS[k]) continue;
    clean[k] = VALIDATORS[k](v);
  }
  for (const [k, v] of Object.entries(clean)) {
    q.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      k,
      JSON.stringify(v),
    );
  }
  cached = null;
  return getSettings();
}

/** Liste des moyens de paiement acceptés (Espèces toujours en premier). */
export function paymentMethods() {
  return [CASH, ...getSettings().payment_methods];
}

// ---------------------------------------------------------------------------
// Droits d'accès
// ---------------------------------------------------------------------------
export const ROLES = {
  admin: 'Administrateur',
  manager: 'Gestionnaire',
  cashier: 'Vendeur / Caissier',
};

const BASE = ['pos', 'customers.manage', 'payments.receive', 'expenses.add', 'cash.own'];
const MANAGER = [
  ...BASE,
  'dashboard',
  'sales.all',
  'sales.cancel',
  'customers.delete',
  'products.manage',
  'cost.view',
  'stock.manage',
  'expenses.manage',
  'reports.view',
  'cash.all',
  'price.edit',
  'credit.sell',
];
const ADMIN = [...MANAGER, 'settings.manage', 'users.manage', 'backup', 'payments.delete'];

/** Ensemble des permissions d'un utilisateur (selon son rôle et les réglages). */
export function permsFor(user) {
  if (!user) return new Set();
  if (user.role === 'admin') return new Set(ADMIN);
  if (user.role === 'manager') return new Set(MANAGER);
  const s = getSettings();
  const p = new Set(BASE);
  if (s.cashier_can_edit_price) p.add('price.edit');
  if (s.cashier_can_sell_on_credit) p.add('credit.sell');
  return p;
}
