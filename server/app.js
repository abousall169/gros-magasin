import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import QRCode from 'qrcode';
import { db, DB_FILE } from './db.js';
import { loadUser, requireAuth } from './auth.js';
import { sseHandler } from './events.js';
import { startAutoBackup } from './backup.js';
import { getSettings } from './settings.js';
import { ensureTls, tlsState } from './tls.js';
import installRoutes from './install.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import catalogRoutes from './routes/catalog.js';
import partnersRoutes from './routes/partners.js';
import operationsRoutes from './routes/operations.js';
import reportsRoutes from './routes/reports.js';
import cashRoutes from './routes/cash.js';
import ordersRoutes from './routes/orders.js';
import systemRoutes, { lanAddresses } from './routes/system.js';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;
const HTTPS_ON = process.env.NO_HTTPS !== '1';

tlsState.httpPort = PORT;
tlsState.httpsPort = HTTPS_PORT;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use(loadUser);

// ---- API ----------------------------------------------------------------------
app.get('/api/health', (req, res) => res.json({ ok: true, app: 'grand-magasin' }));
app.use('/api/auth', authRoutes);
app.get('/api/events', requireAuth, sseHandler);

const api = express.Router();
api.use(requireAuth);
api.use(usersRoutes);
api.use(catalogRoutes);
api.use(partnersRoutes);
api.use(operationsRoutes);
api.use(reportsRoutes);
api.use(cashRoutes);
api.use(ordersRoutes);
api.use(systemRoutes);
app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Adresse inconnue.' }));

// ---- Installation des téléphones (certificat HTTPS) ------------------------------
app.use(installRoutes);

// ---- Interface (fichiers statiques) ---------------------------------------------
// Les fichiers lourds de la reconnaissance par photo ne changent jamais : cache long.
app.use(['/models', '/vendor/ort'], (req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  next();
});
app.use(
  express.static(PUBLIC, {
    setHeaders(res, file) {
      if (!/[\\/](models|ort)[\\/]/.test(file)) res.setHeader('Cache-Control', 'no-cache');
      if (file.endsWith(`${path.sep}sw.js`)) res.setHeader('Service-Worker-Allowed', '/');
    },
  }),
);

// ---- Erreurs --------------------------------------------------------------------
app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Requête invalide.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Fichier trop volumineux.' });
  const status = Number(err.status) || 500;
  if (status >= 500 && status !== 502) console.error(err);
  res.status(status).json({ error: status >= 500 && status !== 502 ? 'Erreur interne du serveur. Réessayez.' : err.message });
});

// ---- Démarrage --------------------------------------------------------------------
function onListenError(port) {
  return (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(
        `\n  Le port ${port} est déjà utilisé : le logiciel est peut-être déjà ouvert dans une autre fenêtre.\n` +
          `  Ouvrez http://localhost:${PORT} dans le navigateur, ou fermez l'autre fenêtre.\n`,
      );
      process.exit(1);
    }
    throw e;
  };
}

const server = http.createServer(app);
server.keepAliveTimeout = 65_000;
server.on('error', onListenError(PORT));

// HTTPS : requis par les navigateurs pour la caméra et le mode hors ligne sur téléphone.
let secure = null;
if (HTTPS_ON) {
  try {
    const tls = ensureTls();
    tlsState.caPem = tls.caPem;
    secure = https.createServer({ key: tls.key, cert: tls.cert }, app);
    secure.keepAliveTimeout = 65_000;
    secure.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.error(`  HTTPS indisponible : le port ${HTTPS_PORT} est déjà utilisé.`);
        tlsState.enabled = false;
        return;
      }
      console.error('  HTTPS indisponible :', e.message);
      tlsState.enabled = false;
    });
  } catch (e) {
    console.error('  HTTPS indisponible :', e.message);
  }
}

server.listen(PORT, async () => {
  startAutoBackup();
  if (secure) {
    await new Promise((resolve) => {
      secure.listen(HTTPS_PORT, () => {
        tlsState.enabled = true;
        resolve();
      });
      secure.once('error', resolve);
    });
  }
  const lan = lanAddresses();
  const line = '─'.repeat(64);
  console.log(`\n  ${line}`);
  console.log(`   ${getSettings().store_name} — logiciel de caisse démarré`);
  console.log(`  ${line}`);
  console.log(`   Sur cet ordinateur :   http://localhost:${PORT}`);
  if (lan.length) {
    console.log('   Sur les téléphones, tablettes et autres ordinateurs');
    console.log('   (connectés au même Wi-Fi / réseau) :');
    for (const a of lan) {
      if (tlsState.enabled) {
        console.log(`      https://${a.address}:${HTTPS_PORT}   (1re fois sur un appareil : http://${a.address}:${PORT}/install)`);
      } else console.log(`      http://${a.address}:${PORT}`);
    }
    try {
      const target = tlsState.enabled ? `http://${lan[0].address}:${PORT}/install` : `http://${lan[0].address}:${PORT}`;
      const qr = await QRCode.toString(target, { type: 'terminal', small: true });
      console.log(`\n   Scannez ce code avec l’appareil photo du téléphone (${target}) :\n`);
      console.log(qr.replace(/^/gm, '     '));
    } catch {
      /* QR facultatif */
    }
  } else {
    console.log('   Aucun réseau détecté : connectez cet ordinateur au Wi-Fi du magasin');
    console.log('   pour que les téléphones et tablettes puissent s’y connecter.');
  }
  console.log(`   Données : ${DB_FILE}`);
  console.log('   Laissez cette fenêtre ouverte pendant la journée. Pour arrêter : Ctrl + C');
  console.log(`  ${line}\n`);
});

function shutdown() {
  try {
    db.close();
  } catch {
    /* déjà fermée */
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
