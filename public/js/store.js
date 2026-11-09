// État partagé de l'application + synchronisation en temps réel entre appareils.
import { reactive } from './vue.js';
import { api, setUnauthorizedHandler } from './api.js';

export const store = reactive({
  booted: false,
  status: null, // { needsSetup, users, store_name }
  me: null,
  perms: {},
  settings: {},
  paymentMethods: ['Espèces'],
  roles: {},
  products: [],
  categories: [],
  productsLoaded: false,
  online: true,
  toasts: [],
  dialog: null,
});

export const CASH = 'Espèces';
export const can = (perm) => !!store.perms[perm];

// ---- Notifications ----------------------------------------------------------
let toastId = 0;
export function toast(message, type = 'info', ms = 2800) {
  const id = ++toastId;
  store.toasts.push({ id, message, type });
  if (store.toasts.length > 3) store.toasts.shift();
  setTimeout(() => {
    const i = store.toasts.findIndex((t) => t.id === id);
    if (i >= 0) store.toasts.splice(i, 1);
  }, ms);
}
export const toastError = (e) => toast(e?.message || String(e), 'error', 4500);

// ---- Boîtes de dialogue (confirmation / saisie) -------------------------------
/** ask({ title, message, confirm, danger, input: { label, placeholder, required } }) → Promise<false | true | string> */
export function ask(opts) {
  return new Promise((resolve) => {
    store.dialog = { ...opts, value: opts.input?.value || '', resolve };
  });
}
export function closeDialog(result) {
  const d = store.dialog;
  store.dialog = null;
  d?.resolve(result);
}

// ---- Session -------------------------------------------------------------------
export async function loadStatus() {
  store.status = await api.get('/auth/status');
  return store.status;
}

export async function loadMe() {
  try {
    const me = await api.get('/auth/me');
    store.me = me.user;
    store.perms = Object.fromEntries(me.perms.map((p) => [p, true]));
    store.settings = me.settings;
    store.paymentMethods = me.paymentMethods;
    store.roles = me.roles;
    document.title = `${me.settings.store_name} — Caisse`;
    return true;
  } catch (e) {
    if (e.status === 401) {
      store.me = null;
      return false;
    }
    throw e;
  }
}

export async function logout() {
  try {
    await api.post('/auth/logout');
  } catch {
    /* hors ligne : on déconnecte localement */
  }
  disconnectEvents();
  store.me = null;
  store.perms = {};
  store.products = [];
  store.productsLoaded = false;
  await loadStatus().catch(() => {});
}

setUnauthorizedHandler(() => {
  if (store.me) {
    store.me = null;
    disconnectEvents();
    loadStatus().catch(() => {});
    toast('Session terminée. Reconnectez-vous.', 'error');
  }
});

// ---- Catalogue (mis en cache pour une recherche instantanée) ---------------------
let loadingProducts = null;
export function loadProducts() {
  if (loadingProducts) return loadingProducts;
  loadingProducts = Promise.all([api.get('/products'), api.get('/categories')])
    .then(([products, categories]) => {
      store.products = products;
      store.categories = categories;
      store.productsLoaded = true;
    })
    .finally(() => {
      loadingProducts = null;
    });
  return loadingProducts;
}

// ---- Temps réel (Server-Sent Events) ------------------------------------------
const listeners = new Map(); // topic -> Set(fn)
export function onChange(topic, fn) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(fn);
  return () => listeners.get(topic)?.delete(fn);
}
function emit(topics) {
  const called = new Set();
  for (const t of topics) {
    for (const fn of listeners.get(t) || []) {
      if (called.has(fn)) continue;
      called.add(fn);
      try {
        fn(topics);
      } catch (e) {
        console.error(e);
      }
    }
  }
}

let source = null;
let wasOffline = false;
export function connectEvents() {
  disconnectEvents();
  source = new EventSource('/api/events');
  source.addEventListener('open', () => {
    store.online = true;
    if (wasOffline) {
      wasOffline = false;
      emit(['products', 'sales', 'customers', 'expenses']);
    }
  });
  source.addEventListener('error', () => {
    store.online = false;
    wasOffline = true;
  });
  source.addEventListener('change', (ev) => {
    try {
      emit(JSON.parse(ev.data).topics || []);
    } catch {
      /* message ignoré */
    }
  });
}
export function disconnectEvents() {
  source?.close();
  source = null;
}

let productTimer = null;
onChange('products', () => {
  clearTimeout(productTimer);
  productTimer = setTimeout(() => loadProducts().catch(() => {}), 200);
});
onChange('settings', () => loadMe().catch(() => {}));
onChange('users', () => loadMe().catch(() => {}));

// ---- Préférences locales de l'appareil -------------------------------------------
export const local = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`gm_${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`gm_${key}`, JSON.stringify(value));
    } catch {
      /* stockage indisponible */
    }
  },
};
