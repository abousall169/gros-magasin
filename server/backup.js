// Sauvegardes automatiques de la base de données (dossier « backups »).
import fs from 'node:fs';
import path from 'node:path';
import { db, BACKUP_DIR } from './db.js';

const KEEP = 60;
const pad = (n) => String(n).padStart(2, '0');

export function makeBackup(label = 'auto') {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}h${pad(d.getMinutes())}`;
  let name = `sauvegarde_${stamp}_${label}.db`;
  let i = 2;
  while (fs.existsSync(path.join(BACKUP_DIR, name))) name = `sauvegarde_${stamp}_${label}-${i++}.db`;
  db.prepare('VACUUM INTO ?').run(path.join(BACKUP_DIR, name));
  prune();
  return name;
}

export function listBackups() {
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => /^sauvegarde_[\w-]+\.db$/.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, size: st.size, date: st.mtime.toISOString() };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function backupPath(name) {
  if (!/^sauvegarde_[\w-]+\.db$/.test(String(name))) return null;
  const p = path.join(BACKUP_DIR, name);
  return fs.existsSync(p) ? p : null;
}

function prune() {
  const auto = listBackups().filter((b) => b.name.includes('_auto'));
  for (const b of auto.slice(KEEP)) fs.rmSync(path.join(BACKUP_DIR, b.name), { force: true });
}

/** Sauvegarde au démarrage puis toutes les 6 heures (si des données existent). */
export function startAutoBackup() {
  const run = () => {
    try {
      const hasData = db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
      if (!hasData) return;
      const last = listBackups().find((b) => b.name.includes('_auto'));
      if (last && Date.now() - new Date(last.date).getTime() < 5.5 * 3600_000) return;
      makeBackup('auto');
    } catch (e) {
      console.error('Sauvegarde automatique impossible :', e.message);
    }
  };
  run();
  setInterval(run, 30 * 60_000).unref();
}
