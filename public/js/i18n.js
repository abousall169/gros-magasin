// Langues de l'interface : français (par défaut), arabe (de droite à gauche) et anglais.
// Les textes sont écrits en français dans le code : t('Encaisser') renvoie la traduction si elle existe.
import { store, local } from './store.js';
import { api } from './api.js';
import { AR, EN } from './i18n-dict.js';

export const LANGS = [
  { id: 'fr', label: 'Français', short: 'FR' },
  { id: 'ar', label: 'العربية', short: 'عربي' },
  { id: 'en', label: 'English', short: 'EN' },
];
const DICT = { ar: AR, en: EN };

/** t('Il reste {n} articles', { n: 3 }) */
export function t(fr, params) {
  const d = DICT[store.lang];
  let s = (d && d[fr]) || fr;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m));
  return s;
}

export function applyLang(lang) {
  const l = LANGS.some((x) => x.id === lang) ? lang : 'fr';
  store.lang = l;
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
  local.set('lang', l);
}

/** Langue de l'appareil au démarrage (avant la connexion). */
export function initLang() {
  applyLang(local.get('lang', 'fr'));
}

/** Change la langue et la retient pour l'employé connecté. */
export function setLang(lang) {
  applyLang(lang);
  if (store.me) {
    store.me.lang = store.lang;
    api.put('/auth/lang', { lang: store.lang }).catch(() => {});
  }
}

/** Nom du produit dans la langue choisie (repli sur le nom français). */
export const pname = (p) => (store.lang === 'ar' && p?.name_ar) || p?.name || '';

/** Libellé d'un moyen de paiement (les moyens ajoutés par le gérant restent tels quels). */
export const payLabel = (m) => (m === 'Espèces' || m === 'Compte client' || m === 'Réglé avant la mise à jour' ? t(m) : m);
