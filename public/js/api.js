// Appels au serveur local + file d'attente des ventes faites sans réseau.
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

function qs(params) {
  if (!params) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const OFFLINE_MESSAGE = 'Serveur injoignable. Vérifiez que cet appareil est connecté au Wi-Fi du magasin.';

/** token : envoie la requête au nom d'une autre session (vente hors ligne faite par un autre employé). */
async function request(method, url, body, { token, raw } = {}) {
  let res;
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = raw ? 'application/octet-stream' : 'application/json';
  if (token) headers['X-Session'] = token;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(OFFLINE_MESSAGE, 0);
  }
  let data = null;
  if ((res.headers.get('content-type') || '').includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized && !token && !url.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(data?.error || `Erreur ${res.status}`, res.status, data);
  }
  return data;
}

export const api = {
  get: (url, params) => request('GET', url + qs(params)),
  post: (url, body = {}, opts) => request('POST', url, body, opts),
  put: (url, body = {}) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
  upload: (url, blob) => request('POST', url, blob, { raw: true }),
  url: (url, params) => `/api${url}${qs(params)}`,
};

// ---------------------------------------------------------------------------
// File d'attente : une vente faite sans réseau est gardée sur l'appareil puis renvoyée.
// Elle n'est jamais perdue : si le serveur la refuse, elle reste « à traiter » jusqu'à décision.
// ---------------------------------------------------------------------------
const QUEUE_KEY = 'gm_sales_queue';
const REJECTED_KEY = 'gm_sales_rejected';
const TOKEN_KEY = 'gm_session_token';

const readList = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? [];
  } catch {
    return [];
  }
};
const writeList = (key, list) => {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* stockage plein ou indisponible */
  }
};

/** Jeton de la session de cet appareil (sert uniquement à renvoyer les ventes hors ligne). */
export const sessionToken = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t) => {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* stockage indisponible */
    }
  },
};

export const readQueue = () => readList(QUEUE_KEY);
export const enqueueSale = (entry) => writeList(QUEUE_KEY, [...readQueue(), entry]);
export const requestQueuedPrint = (clientId) =>
  writeList(
    QUEUE_KEY,
    readQueue().map((e) => (e.payload.client_id === clientId ? { ...e, print: true } : e)),
  );

export const readRejected = () => readList(REJECTED_KEY);
export function retryRejected() {
  writeList(QUEUE_KEY, [...readQueue(), ...readRejected().map(({ error, ...entry }) => entry)]);
  writeList(REJECTED_KEY, []);
}
export const dropRejected = (clientId) =>
  writeList(
    REJECTED_KEY,
    readRejected().filter((e) => e.payload.client_id !== clientId),
  );

async function sendQueued(entry) {
  const body = { ...entry.payload, offline: true, sold_at: new Date(entry.at).toISOString() };
  try {
    return await request('POST', '/sales', body, { token: entry.token || undefined });
  } catch (e) {
    // La session de l'employé a été fermée entre-temps : la vente passe au nom de la personne connectée.
    if (e.status === 401 && entry.token) return request('POST', '/sales', body);
    throw e;
  }
}

let flushing = false;
/** Renvoie les ventes en attente. Retourne { sent: [{ sale, entry }], rejected: n }. */
export async function flushQueue() {
  if (flushing) return { sent: [], rejected: 0 };
  flushing = true;
  const sent = [];
  let rejected = 0;
  try {
    let queue = readQueue();
    while (queue.length) {
      const entry = queue[0];
      try {
        sent.push({ sale: await sendQueued(entry), entry });
      } catch (e) {
        if (e.status === 0 || e.status >= 500 || e.status === 401) break; // on réessaiera plus tard
        writeList(REJECTED_KEY, [...readRejected(), { ...entry, error: e.message }]);
        rejected += 1;
      }
      queue = queue.slice(1);
      writeList(QUEUE_KEY, queue);
    }
  } finally {
    flushing = false;
  }
  return { sent, rejected };
}
