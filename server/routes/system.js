// Connexion des appareils (adresses réseau + QR code), imprimante de tickets, sauvegardes.
import express, { Router } from 'express';
import os from 'node:os';
import QRCode from 'qrcode';
import { requirePerm, requireAuth } from '../auth.js';
import { makeBackup, listBackups, backupPath, backupInfo, setBackupDir, restoreFrom, restoreFromBuffer } from '../backup.js';
import { connectedCount, broadcast } from '../events.js';
import { notFound, bad, HttpError } from '../util.js';
import { q, tx } from '../db.js';
import { getSettings, updateSettings } from '../settings.js';
import { tlsState } from '../tls.js';
import { listPrinters, escposFromBitmap, validateBitmap, sendToPrinter, DRAWER_PULSE } from '../print/print.js';

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

const qrSvg = (text) => QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });

r.get('/system/network', requireAuth, async (req, res) => {
  const port = tlsState.httpPort;
  const urls = await Promise.all(
    lanAddresses().map(async (a) => {
      const url = `http://${a.address}:${port}`;
      const out = { ...a, url, qr: await qrSvg(url) };
      if (tlsState.enabled) {
        out.secureUrl = `https://${a.address}:${tlsState.httpsPort}`;
        out.installUrl = `http://${a.address}:${port}/install`;
        out.installQr = await qrSvg(out.installUrl);
      }
      return out;
    }),
  );
  res.json({
    hostname: os.hostname(),
    port,
    https: tlsState.enabled ? tlsState.httpsPort : null,
    urls,
    connected: connectedCount(),
    secure: req.secure,
  });
});

// ---- Imprimante de tickets (ESC/POS) ----------------------------------------------
// Le navigateur dessine le ticket en image ; le serveur l'envoie à l'imprimante.
r.post('/print', requirePerm('pos', 'stock.manage', 'products.manage'), async (req, res, next) => {
  try {
    const target = getSettings().printer;
    if (!target) bad("Aucune imprimante de tickets n'est réglée.");
    const bmp = validateBitmap(req.body);
    if (!bmp) bad('Image du ticket invalide.');
    try {
      await sendToPrinter(target, escposFromBitmap(bmp, { cut: getSettings().printer_cut }));
    } catch (e) {
      throw new HttpError(502, `Impression impossible : ${e.message}`);
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

r.get('/system/printers', requirePerm('settings.manage'), async (req, res) => {
  try {
    res.json({ printers: await listPrinters() });
  } catch (e) {
    res.json({ printers: [], error: e.message });
  }
});

r.post('/system/drawer', requirePerm('pos'), async (req, res, next) => {
  try {
    const target = getSettings().printer;
    if (!target) bad("Aucune imprimante de tickets n'est réglée.");
    try {
      await sendToPrinter(target, DRAWER_PULSE);
    } catch (e) {
      throw new HttpError(502, `Tiroir-caisse injoignable : ${e.message}`);
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---- Sauvegardes ----------------------------------------------------------------
r.get('/system/backups', requirePerm('backup'), (req, res) => res.json({ files: listBackups(), ...backupInfo() }));

r.post('/system/backups', requirePerm('backup'), (req, res) => {
  res.json({ name: makeBackup('manuelle') });
});

r.put('/system/backups/dir', requirePerm('backup'), (req, res) => {
  setBackupDir(req.body?.dir);
  res.json({ ok: true, ...backupInfo() });
});

function afterRestore(res, safety) {
  updateSettings({}); // vide le cache des réglages
  broadcast('products', 'sales', 'customers', 'expenses', 'settings', 'users', 'purchases', 'cash');
  res.json({ ok: true, safety });
}

r.post('/system/backups/:name/restore', requirePerm('backup'), (req, res) => {
  const p = backupPath(req.params.name);
  if (!p) notFound('Sauvegarde introuvable.');
  afterRestore(res, restoreFrom(p));
});

r.post(
  '/system/restore-upload',
  requirePerm('backup'),
  express.raw({ type: 'application/octet-stream', limit: '512mb' }),
  (req, res) => afterRestore(res, restoreFromBuffer(req.body)),
);

/** Repartir à zéro : efface produits, clients, ventes, stocks et dépenses (garde employés et réglages). */
r.post('/system/reset', requirePerm('backup'), (req, res) => {
  if (String(req.body?.confirm || '').trim().toUpperCase() !== 'EFFACER') bad('Tapez EFFACER pour confirmer.');
  const backup = makeBackup('avant-remise-a-zero');
  tx(() => {
    for (const table of [
      'refund_items',
      'refunds',
      'sale_payments',
      'sale_items',
      'sales',
      'customer_payments',
      'purchase_payments',
      'purchase_items',
      'purchases',
      'stock_movements',
      'stock_lots',
      'product_images',
      'expenses',
      'cash_sessions',
      'products',
      'categories',
      'customers',
      'suppliers',
    ]) {
      q.run(`DELETE FROM ${table}`);
    }
    updateSettings({ demo_data: false });
  });
  broadcast('products', 'sales', 'customers', 'expenses', 'settings', 'purchases', 'cash');
  res.json({ ok: true, backup });
});

r.get('/system/backups/:name', requirePerm('backup'), (req, res) => {
  const p = backupPath(req.params.name);
  if (!p) notFound('Sauvegarde introuvable.');
  res.download(p, req.params.name);
});

export default r;
