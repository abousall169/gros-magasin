// État partagé de l'application + synchronisation en temps réel entre appareils
// + fonctionnement hors ligne (données en cache, ventes en file d'attente).
import { reactive } from './vue.js';
import { api, setUnauthorizedHandler, flushQueue, readQueue, readRejected, sessionToken } from './api.js';

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
  offlineBoot: false, // application ouverte sans serveur (données en cache)
  pending: readQueue().length, // ventes en attente d'envoi
  rejected: readRejected(), // ventes refusées au renvoi
  showRejected: false,
  lang: 'fr',
  toasts: [],
  dialog: null,
});

export const CASH = 'Espèces';
export const can = (perm) => !!store.perms[perm];

// ---- Préférences et cache locaux de l'appareil -------------------------------------
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
      /* stockage indisponible ou plein */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(`gm_${key}`);
    } catch {
      /* stockage indisponible */
    }
  },
};

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
  try {
    store.status = await api.get('/auth/status');
    local.set('status', store.status);
  } catch (e) {
    if (e.status !== 0) throw e;
    // Hors ligne : liste des employés gardée en cache (la connexion exige quand même le serveur)
    const cached = local.get('status', null);
    if (!cached) throw e;
    store.status = { ...cached, loggedIn: false, offline: true };
  }
  return store.status;
}

function applyMe(me) {
  store.me = me.user;
  store.perms = Object.fromEntries(me.perms.map((p) => [p, true]));
  store.settings = me.settings;
  store.paymentMethods = me.paymentMethods;
  store.roles = me.roles;
  document.title = `${me.settings.store_name} — Caisse`;
}

export async function loadMe() {
  try {
    const me = await api.get('/auth/me');
    applyMe(me);
    local.set('me', me);
    store.offlineBoot = false;
    return true;
  } catch (e) {
    if (e.status === 401) {
      store.me = null;
      local.remove('me');
      return false;
    }
    // Sans réseau : l'application s'ouvre avec le dernier employé connecté sur cet appareil
    const cached = e.status === 0 ? local.get('me', null) : null;
    if (cached) {
      applyMe(cached);
      store.offlineBoot = true;
      store.online = false;
      return true;
    }
    throw e;
  }
}

export async function logout() {
  await syncQueue().catch(() => {}); // les ventes en attente partent avant la fermeture de la session
  try {
    await api.post('/auth/logout');
  } catch {
    /* hors ligne : on déconnecte localement */
  }
  disconnectEvents();
  stopSync();
  sessionToken.set(null);
  local.remove('me');
  store.me = null;
  store.perms = {};
  store.products = [];
  store.productsLoaded = false;
  await loadStatus().catch(() => {});
}

setUnauthorizedHandler(() => {
  if (store.me) {
    store.me = null;
    local.remove('me');
    disconnectEvents();
    stopSync();
    loadStatus().catch(() => {});
    toast('Session terminée. Reconnectez-vous.', 'error');
  }
});

// ---- Catalogue (mis en cache pour une recherche instantanée, même hors ligne) ------
let loadingProducts = null;
export function loadProducts() {
  if (loadingProducts) return loadingProducts;
  loadingProducts = Promise.all([api.get('/products'), api.get('/categories')])
    .then(([products, categories]) => {
      store.products = products;
      store.categories = categories;
      store.productsLoaded = true;
      local.set('products', products);
      local.set('categories', categories);
    })
    .catch((e) => {
      if (e.status !== 0) throw e;
      store.products = local.get('products', []);
      store.categories = local.get('categories', []);
      store.productsLoaded = true;
      store.online = false;
    })
    .finally(() => {
      loadingProducts = null;
    });
  return loadingProducts;
}

/** Clients (gardés en cache pour pouvoir choisir un client hors ligne). */
export async function loadCustomers() {
  try {
    const list = await api.get('/customers');
    local.set('customers', list);
    return list;
  } catch (e) {
    if (e.status !== 0) throw e;
    store.online = false;
    return local.get('customers', []);
  }
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
    if (wasOffline || store.offlineBoot) {
      wasOffline = false;
      if (store.offlineBoot) loadMe().catch(() => {});
      emit(['products', 'sales', 'customers', 'expenses', 'purchases', 'cash', 'orders']);
      syncQueue();
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

// ---- Envoi des ventes faites hors ligne --------------------------------------------
const syncHandlers = new Set();
/** Appelé pour chaque vente hors ligne enfin enregistrée (ex. : impression demandée). */
export function onSynced(fn) {
  syncHandlers.add(fn);
  return () => syncHandlers.delete(fn);
}

export async function syncQueue() {
  if (!readQueue().length) {
    store.pending = 0;
    return;
  }
  const { sent, rejected } = await flushQueue();
  store.pending = readQueue().length;
  store.rejected = readRejected();
  if (sent.length) {
    store.online = true;
    toast(sent.length > 1 ? `${sent.length} ventes hors ligne envoyées.` : 'Vente hors ligne envoyée.', 'success');
    loadProducts().catch(() => {});
    for (const { sale, entry } of sent) for (const fn of syncHandlers) fn(sale, entry);
  }
  if (rejected) {
    toast(`${rejected} vente(s) hors ligne refusée(s) par le serveur : à traiter.`, 'error', 6000);
    store.showRejected = true;
  }
}

let syncTimer = null;
export function startSync() {
  stopSync();
  syncQueue().catch(() => {});
  syncTimer = setInterval(() => syncQueue().catch(() => {}), 15_000);
  window.addEventListener('online', onBrowserOnline);
}
export function stopSync() {
  clearInterval(syncTimer);
  syncTimer = null;
  window.removeEventListener('online', onBrowserOnline);
}
function onBrowserOnline() {
  syncQueue().catch(() => {});
}
