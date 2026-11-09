// Navigation par ancre (#/caisse, #/ventes?vente=12 ...)
import { reactive } from './vue.js';

export const route = reactive({ path: '/', query: {} });

function parse() {
  const hash = decodeURI(location.hash.slice(1)) || '/';
  const [path, search] = hash.split('?');
  route.path = path || '/';
  route.query = Object.fromEntries(new URLSearchParams(search || ''));
}
window.addEventListener('hashchange', parse);
parse();

export function go(path, query) {
  const s = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  location.hash = `#${path}${s ? `?${s}` : ''}`;
}

/** Modifie les paramètres de l'adresse sans changer de page. */
export function setQuery(patch) {
  go(route.path, { ...route.query, ...patch });
}
