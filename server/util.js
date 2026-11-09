// Petites fonctions utilitaires partagées par le serveur.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Lève une erreur 400 avec un message lisible par l'utilisateur. */
export function bad(message) {
  throw new HttpError(400, message);
}

export function notFound(message = 'Élément introuvable.') {
  throw new HttpError(404, message);
}

export function forbidden(message = "Vous n'avez pas l'autorisation d'effectuer cette action.") {
  throw new HttpError(403, message);
}

const pad = (n, l = 2) => String(n).padStart(l, '0');

/** Date/heure locale du serveur au format 'YYYY-MM-DD HH:MM:SS'. */
export function nowLocal(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function todayLocal(d = new Date()) {
  return nowLocal(d).slice(0, 10);
}

/** Ajoute n jours à une date 'YYYY-MM-DD'. */
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return todayLocal(dt);
}

export function isDay(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Bornes [début, fin[ pour filtrer une colonne created_at entre deux jours inclus. */
export function dayRange(from, to) {
  const f = isDay(from) ? from : todayLocal();
  const t = isDay(to) ? to : f;
  return [`${f} 00:00:00`, `${addDays(t, 1)} 00:00:00`];
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
export const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;

/**
 * Convertit une valeur saisie en nombre. Accepte les formats français
 * ("1 500", "1500,50", "1.500,50").
 */
export function num(v, fallback = NaN) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (v === null || v === undefined) return fallback;
  let s = String(v).trim().replace(/[\s  ]/g, '');
  if (s === '') return fallback;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Le dernier séparateur est le séparateur décimal
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

export function int(v, fallback = null) {
  const n = num(v, NaN);
  return Number.isInteger(n) ? n : fallback;
}

/** Nettoie une chaîne saisie (trim + longueur max). Retourne null si vide. */
export function str(v, max = 200) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().slice(0, max);
  return s === '' ? null : s;
}

export const bool = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'on';

export function sum(arr, fn = (x) => x) {
  return arr.reduce((acc, x) => acc + (Number(fn(x)) || 0), 0);
}

/** Formatage simple d'une quantité pour les messages d'erreur. */
export function fmtQty(n) {
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

/** Pluriel simple d'une unité (« bouteille » → « bouteilles », « kg » reste « kg »). */
export function plural(unit, n) {
  const u = String(unit || '');
  if (Math.abs(n) < 2 || u.length <= 2 || /[sxz]$/i.test(u) || /\s/.test(u)) return u;
  return u + 's';
}
