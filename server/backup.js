// Sauvegardes de la base : automatiques (dossier « backups »), copie vers un autre dossier
// (clé USB, dossier synchronisé), téléchargement et restauration sans redémarrer le logiciel.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { db, BACKUP_DIR, rawSetting, migrateDatabase } from './db.js';
import { nowLocal, HttpError } from './util.js';

const KEEP = 60;
const NAME_RE = /^sauvegarde_[\w-]+\.db$/;
const pad = (n) => String(n).padStart(2, '0');
const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Copie la sauvegarde vers le dossier choisi par le gérant (si réglé). */
function copyOutside(name) {
  const target = rawSetting.get('backup_dir', '');
  if (!target) return;
  try {
    if (!fs.existsSync(target)) throw new Error('dossier introuvable');
    fs.copyFileSync(path.join(BACKUP_DIR, name), path.join(target, name));
    rawSetting.set('backup_last_copy', JSON.stringify({ at: nowLocal(), ok: true, file: name }));
  } catch (e) {
    rawSetting.set('backup_last_copy', JSON.stringify({ at: nowLocal(), ok: false, error: e.message }));
  }
}

export function makeBackup(label = 'auto') {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}h${pad(d.getMinutes())}`;
  let name = `sauvegarde_${stamp}_${label}.db`;
  let i = 2;
  while (fs.existsSync(path.join(BACKUP_DIR, name))) name = `sauvegarde_${stamp}_${label}-${i++}.db`;
  db.prepare('VACUUM INTO ?').run(path.join(BACKUP_DIR, name));
  prune();
  copyOutside(name);
  return name;
}

export function listBackups() {
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => NAME_RE.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, size: st.size, date: st.mtime.toISOString() };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function backupPath(name) {
  if (!NAME_RE.test(String(name))) return null;
  const p = path.join(BACKUP_DIR, name);
  return fs.existsSync(p) ? p : null;
}

function prune() {
  const auto = listBackups().filter((b) => b.name.includes('_auto'));
  for (const b of auto.slice(KEEP)) fs.rmSync(path.join(BACKUP_DIR, b.name), { force: true });
}

export function backupInfo() {
  let lastCopy = null;
  try {
    lastCopy = JSON.parse(rawSetting.get('backup_last_copy', 'null'));
  } catch {
    /* jamais copié */
  }
  return { dir: rawSetting.get('backup_dir', ''), lastCopy };
}

export function setBackupDir(dir) {
  const clean = String(dir || '').trim().slice(0, 300);
  if (clean && !fs.existsSync(clean)) throw new HttpError(400, "Ce dossier n'existe pas sur l'ordinateur serveur.");
  rawSetting.set('backup_dir', clean);
  if (clean) makeBackup('copie');
}

/**
 * Remplace le contenu de la base par celui d'un fichier de sauvegarde, sans redémarrer.
 * Une sauvegarde de sécurité est faite juste avant. Toutes les sessions sont fermées.
 */
export function restoreFrom(source) {
  const tmp = path.join(BACKUP_DIR, `restauration-${Date.now()}.tmp`);
  fs.copyFileSync(source, tmp);
  try {
    const check = new DatabaseSync(tmp);
    try {
      if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('corrompu');
      for (const t of ['users', 'products', 'sales', 'settings']) check.prepare(`SELECT COUNT(*) FROM ${t}`).get();
      if (!check.prepare('SELECT COUNT(*) AS n FROM users').get().n) throw new Error('aucun utilisateur');
      migrateDatabase(check);
    } catch {
      throw new HttpError(400, "Ce fichier n'est pas une sauvegarde valide de ce logiciel.");
    } finally {
      check.close();
    }

    const safety = makeBackup('avant-restauration');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'sessions'")
      .all()
      .map((x) => x.name);
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`ATTACH DATABASE ${quote(tmp)} AS restored`);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('DELETE FROM main.sessions');
      for (const t of tables) db.exec(`DELETE FROM main."${t}"`);
      for (const t of tables) {
        const cols = db
          .prepare(`PRAGMA restored.table_info("${t}")`)
          .all()
          .map((c) => `"${c.name}"`)
          .join(', ');
        if (cols) db.exec(`INSERT INTO main."${t}" (${cols}) SELECT ${cols} FROM restored."${t}"`);
      }
      if (db.prepare('PRAGMA main.foreign_key_check').all().length) {
        throw new HttpError(400, 'La sauvegarde contient des liens incohérents : restauration annulée.');
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      db.exec('DETACH DATABASE restored');
      db.exec('PRAGMA foreign_keys = ON');
    }
    return safety;
  } finally {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${tmp}${suffix}`, { force: true });
  }
}

export function restoreFromBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 100) throw new HttpError(400, "Ce fichier n'est pas une sauvegarde valide de ce logiciel.");
  const file = path.join(BACKUP_DIR, `envoi-${Date.now()}.tmp`);
  fs.writeFileSync(file, buf);
  try {
    return restoreFrom(file);
  } finally {
    fs.rmSync(file, { force: true });
  }
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
