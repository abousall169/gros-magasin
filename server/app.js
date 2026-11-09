import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import QRCode from 'qrcode';
import { db, DB_FILE } from './db.js';
import { loadUser, requireAuth } from './auth.js';
import { sseHandler } from './events.js';
import { startAutoBackup } from './backup.js';
import { getSettings } from './settings.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import catalogRoutes from './routes/catalog.js';
import partnersRoutes from './routes/partners.js';
import operationsRoutes from './routes/operations.js';
import reportsRoutes from './routes/reports.js';
import systemRoutes, { lanAddresses } from './routes/system.js';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use(loadUser);

// ---- API ----------------------------------------------------------------------
app.use('/api/auth', authRoutes);
app.get('/api/events', requireAuth, sseHandler);

const api = express.Router();
api.use(requireAuth);
api.use(usersRoutes);
api.use(catalogRoutes);
api.use(partnersRoutes);
api.use(operationsRoutes);
api.use(reportsRoutes);
api.use(systemRoutes);
app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Adresse inconnue.' }));

// ---- Interface (fichiers statiques) ---------------------------------------------
app.use(
  express.static(PUBLIC, {
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);

// ---- Erreurs --------------------------------------------------------------------
app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Requête invalide.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Fichier trop volumineux.' });
  const status = Number(err.status) || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Erreur interne du serveur. Réessayez.' : err.message });
});

// ---- Démarrage --------------------------------------------------------------------
const server = http.createServer(app);
server.keepAliveTimeout = 65_000;

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(
      `\n  Le port ${PORT} est déjà utilisé : le logiciel est peut-être déjà ouvert dans une autre fenêtre.\n` +
        `  Ouvrez http://localhost:${PORT} dans le navigateur, ou fermez l'autre fenêtre.\n`,
    );
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, async () => {
  startAutoBackup();
  const lan = lanAddresses();
  const line = '─'.repeat(58);
  console.log(`\n  ${line}`);
  console.log(`   ${getSettings().store_name} — logiciel de caisse démarré`);
  console.log(`  ${line}`);
  console.log(`   Sur cet ordinateur :   http://localhost:${PORT}`);
  if (lan.length) {
    console.log('   Sur les téléphones, tablettes et autres ordinateurs');
    console.log('   (connectés au même Wi-Fi / réseau) :');
    for (const a of lan) console.log(`      http://${a.address}:${PORT}`);
    try {
      const qr = await QRCode.toString(`http://${lan[0].address}:${PORT}`, { type: 'terminal', small: true });
      console.log('\n   Scannez ce code avec l’appareil photo du téléphone :\n');
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
