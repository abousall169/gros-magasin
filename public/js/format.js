// Formatage des montants, quantités, dates — en français.
import { store } from './store.js';

const NBSP = ' ';
const cleanSpaces = (s) => s.replace(/[  ]/g, NBSP);

export function decimals() {
  return Number(store.settings?.currency_decimals) === 2 ? 2 : 0;
}

/** 12500 → « 12 500 FCFA » */
export function money(n, { bare = false, sign = false } = {}) {
  const d = decimals();
  const v = Number(n) || 0;
  let s = cleanSpaces(
    new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(Math.abs(v)),
  );
  if (v < 0) s = `−${s}`;
  else if (sign && v > 0) s = `+${s}`;
  return bare ? s : `${s}${NBSP}${store.settings?.currency || 'FCFA'}`;
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
export function round3(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}

/** Arrondi d'un montant selon la devise (0 ou 2 décimales). */
export function roundMoney(n) {
  return decimals() === 2 ? round2(n) : Math.round(Number(n) || 0);
}

export function qty(n) {
  return cleanSpaces(new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(Number(n) || 0));
}

export function percent(n) {
  return `${cleanSpaces(new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(Number(n) || 0))}${NBSP}%`;
}

/** Pluriel simple : « bouteille » → « bouteilles », « kg » reste « kg ». */
export function plural(unit, n) {
  const u = String(unit || '');
  if (Math.abs(Number(n)) < 2 || u.length <= 2 || /[sxz]$/i.test(u) || /\s/.test(u)) return u;
  return `${u}s`;
}

export function unitQty(n, unit) {
  return `${qty(n)}${NBSP}${plural(unit, n)}`;
}

/** Saisie française → nombre (« 1 500 », « 2,5 »). */
export function parseNum(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim().replace(/[\s  ]/g, '');
  if (!s) return NaN;
  const lc = s.lastIndexOf(',');
  const ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc > -1) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// ---------------------------------------------------------------------------
// Produits : gros / détail
// ---------------------------------------------------------------------------
export const hasPack = (p) => !!p?.pack_unit && Number(p.pack_size) > 1;
export const unitsPer = (p, type) => (type === 'wholesale' && hasPack(p) ? Number(p.pack_size) : 1);
export const unitLabel = (p, type) => (type === 'wholesale' && hasPack(p) ? p.pack_unit : p.unit);

/** Le produit a-t-il un vrai prix de gros (colis ou prix réduit) ? */
export const sellsWholesale = (p) => hasPack(p) || Number(p?.wholesale_price) > 0;

export function listPrice(p, type) {
  if (type === 'wholesale' && Number(p.wholesale_price) > 0) return Number(p.wholesale_price);
  return round2(Number(p.retail_price) * unitsPer(p, type));
}

/** Stock en unités de base → « 20 cartons + 4 bouteilles ». */
export function stockText(p, base = p?.stock) {
  const b = Number(base) || 0;
  if (!hasPack(p) || Math.abs(b) < Number(p.pack_size)) return unitQty(b, p.unit);
  const size = Number(p.pack_size);
  const sign = b < 0 ? '−' : '';
  const abs = Math.abs(b);
  const packs = Math.floor(abs / size + 1e-9);
  const rest = round3(abs - packs * size);
  const parts = [`${sign}${qty(packs)}${NBSP}${plural(p.pack_unit, packs)}`];
  if (rest > 0) parts.push(unitQty(rest, p.unit));
  return parts.join(' + ');
}

export function stockLevel(p) {
  const s = Number(p.stock) || 0;
  if (s <= 0) return 'out';
  if (Number(p.min_stock) > 0 && s <= Number(p.min_stock)) return 'low';
  return 'ok';
}

/** Recherche sans accents ni majuscules. */
export function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Dates (le serveur enregistre l'heure locale 'YYYY-MM-DD HH:MM:SS')
// ---------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
export function today(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return today(new Date(y, m - 1, d + n));
}
export function monthStart(day = today()) {
  return `${day.slice(0, 8)}01`;
}
export function dateFr(s) {
  if (!s) return '';
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
export function timeFr(s) {
  return s ? s.slice(11, 16) : '';
}
export function dateTimeFr(s) {
  return s ? `${dateFr(s)} ${timeFr(s)}` : '';
}
const DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export function dayShort(day) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DAYS[dt.getDay()]} ${d} ${MONTHS[m - 1]}`;
}
export function dayLong(day) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const names = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  return `${names[dt.getDay()]} ${d} ${MONTHS_LONG[m - 1]} ${y}`;
}
/** « Aujourd'hui 14:32 », « Hier 09:10 », sinon « 07/11/2026 16:05 » */
export function when(s) {
  if (!s) return '';
  const day = s.slice(0, 10);
  if (day === today()) return `Aujourd'hui ${timeFr(s)}`;
  if (day === addDays(today(), -1)) return `Hier ${timeFr(s)}`;
  return dateTimeFr(s);
}

export const saleNo = (id) => `N° ${String(id).padStart(6, '0')}`;

export const MODE_LABEL = { retail: 'Détail', wholesale: 'Gros', mixed: 'Gros + détail' };

// ---------------------------------------------------------------------------
// Montant en lettres (factures)
// ---------------------------------------------------------------------------
const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const TENS = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

function below100(n) {
  if (n <= 16) return UNITS[n];
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  if (n < 70) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    if (u === 0) return TENS[t];
    if (u === 1) return `${TENS[t]} et un`;
    return `${TENS[t]}-${UNITS[u]}`;
  }
  if (n < 80) {
    const u = n - 60;
    if (u === 11) return 'soixante et onze';
    return `soixante-${below100(u)}`;
  }
  if (n === 80) return 'quatre-vingts';
  return `quatre-vingt-${below100(n - 80)}`;
}

function below1000(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  let s = '';
  if (h === 1) s = 'cent';
  else if (h > 1) s = `${UNITS[h]} cent${r === 0 ? 's' : ''}`;
  if (r) s = s ? `${s} ${below100(r)}` : below100(r);
  return s || 'zéro';
}

export function numberToWords(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n === 0) return 'zéro';
  const parts = [];
  const billions = Math.floor(n / 1e9);
  const millions = Math.floor((n % 1e9) / 1e6);
  const thousands = Math.floor((n % 1e6) / 1000);
  const rest = n % 1000;
  if (billions) parts.push(`${below1000(billions)} milliard${billions > 1 ? 's' : ''}`);
  if (millions) parts.push(`${below1000(millions)} million${millions > 1 ? 's' : ''}`);
  if (thousands) parts.push(thousands === 1 ? 'mille' : `${below1000(thousands).replace(/s$/, '')} mille`);
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

export function amountInWords(n) {
  const cur = store.settings?.currency || 'FCFA';
  const names = { FCFA: 'francs CFA', XOF: 'francs CFA', XAF: 'francs CFA', CFA: 'francs CFA', GNF: 'francs guinéens', '€': 'euros', EUR: 'euros' };
  const whole = Math.floor(Math.abs(n));
  const cents = Math.round((Math.abs(n) - whole) * 100);
  let s = `${numberToWords(whole)} ${names[cur] || cur}`;
  if (cents && decimals() === 2) s += ` et ${numberToWords(cents)} centimes`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function initials(name) {
  const parts = String(name || '?')
    .trim()
    .split(/\s+/)
    .filter((w) => /\p{L}|\d/u.test(w[0] || ''));
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
