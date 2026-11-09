// Diffusion en temps réel (Server-Sent Events) vers tous les appareils connectés :
// quand un vendeur encaisse une vente, le stock se met à jour sur les autres écrans.
const clients = new Set();
let pending = new Set();
let timer = null;

export function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

/** Signale un changement ('products', 'sales', 'customers', 'settings', 'users', ...). */
export function broadcast(...topics) {
  for (const t of topics) pending.add(t);
  if (timer) return;
  timer = setTimeout(() => {
    const data = JSON.stringify({ topics: [...pending], at: Date.now() });
    pending = new Set();
    timer = null;
    for (const c of clients) c.write(`event: change\ndata: ${data}\n\n`);
  }, 250);
}

// Battement de cœur pour garder les connexions ouvertes (téléphones, Wi-Fi)
setInterval(() => {
  for (const c of clients) c.write(': ping\n\n');
}, 25_000).unref();

export function connectedCount() {
  return clients.size;
}
