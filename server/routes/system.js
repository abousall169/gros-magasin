// Connexion des appareils (adresses réseau + QR code) et sauvegardes.
import { Router } from 'express';
import os from 'node:os';
import QRCode from 'qrcode';
import { requirePerm, requireAuth } from '../auth.js';
import { makeBackup, listBackups, backupPath } from '../backup.js';
import { connectedCount, broadcast } from '../events.js';
import { notFound, bad } from '../util.js';
import { q, tx } from '../db.js';
import { updateSettings } from '../settings.js';

const r = Router();

/** Adresses IPv4 du serveur sur le réseau local (Wi-Fi / câble). */
export function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue; // adresse auto sans réseau
      out.push({ iface: name, address: a.address });
    }
  }
  // Les réseaux privés classiques (box Wi-Fi) en premier
  const score = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3);
  return out.sort((a, b) => score(a.address) - score(b.address));
}

r.get('/system/network', requireAuth, async (req, res) => {
  const port = req.socket.localPort;
  const urls = await Promise.all(
    lanAddresses().map(async (a) => {
      const url = `http://${a.address}:${port}`;
      const qr = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      return { ...a, url, qr };
    }),
  );
  res.json({ hostname: os.hostname(), port, urls, connected: connectedCount() });
});

r.get('/system/backups', requirePerm('backup'), (req, res) => res.json(listBackups()));

r.post('/system/backups', requirePerm('backup'), (req, res) => {
  res.json({ name: makeBackup('manuelle') });
});

/** Repartir à zéro : efface produits, clients, ventes, stocks et dépenses (garde employés et réglages). */
r.post('/system/reset', requirePerm('backup'), (req, res) => {
  if (String(req.body?.confirm || '').trim().toUpperCase() !== 'EFFACER') bad('Tapez EFFACER pour confirmer.');
  const backup = makeBackup('avant-remise-a-zero');
  tx(() => {
    for (const table of [
      'sale_payments',
      'sale_items',
      'sales',
      'customer_payments',
      'purchase_items',
      'purchases',
      'stock_movements',
      'expenses',
      'products',
      'categories',
      'customers',
      'suppliers',
    ]) {
      q.run(`DELETE FROM ${table}`);
    }
    updateSettings({ demo_data: false });
  });
  broadcast('products', 'sales', 'customers', 'expenses', 'settings');
  res.json({ ok: true, backup });
});

r.get('/system/backups/:name', requirePerm('backup'), (req, res) => {
  const p = backupPath(req.params.name);
  if (!p) notFound('Sauvegarde introuvable.');
  res.download(p, req.params.name);
});

export default r;
