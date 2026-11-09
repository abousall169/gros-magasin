import { Router } from 'express';
import { q, tx } from '../db.js';
import { hashPin, validPin, destroyUserSessions, currentToken, requirePerm } from '../auth.js';
import { ROLES, getSettings, updateSettings } from '../settings.js';
import { bad, notFound, str, int, bool, nowLocal } from '../util.js';
import { broadcast } from '../events.js';

const r = Router();

// ---- Paramètres -------------------------------------------------------------
r.get('/settings', (req, res) => res.json(getSettings()));

r.put('/settings', requirePerm('settings.manage'), (req, res) => {
  const s = updateSettings(req.body || {});
  broadcast('settings');
  res.json(s);
});

// ---- Utilisateurs -----------------------------------------------------------
r.get('/users', requirePerm('users.manage'), (req, res) => {
  res.json(
    q.all(
      `SELECT u.id, u.name, u.role, u.active, u.created_at,
              (SELECT MAX(last_seen) FROM sessions s WHERE s.user_id = u.id) AS last_seen,
              (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS devices
         FROM users u
        ORDER BY u.active DESC, u.name COLLATE NOCASE`,
    ),
  );
});

function checkRole(role) {
  if (!ROLES[role]) bad('Rôle invalide.');
  return role;
}

function activeAdmins(exceptId) {
  return q.val("SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1 AND id <> ?", exceptId);
}

r.post('/users', requirePerm('users.manage'), (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 60) || bad('Le nom est obligatoire.');
  const role = checkRole(b.role || 'cashier');
  const pin = String(b.pin || '');
  if (!validPin(pin)) bad('Le code PIN doit contenir 4 à 8 chiffres.');
  if (q.get('SELECT id FROM users WHERE name = ? COLLATE NOCASE AND active = 1', name)) {
    bad('Un utilisateur actif porte déjà ce nom.');
  }
  const u = q.run(
    'INSERT INTO users (name, role, pin_hash, active, created_at) VALUES (?, ?, ?, 1, ?)',
    name,
    role,
    hashPin(pin),
    nowLocal(),
  );
  broadcast('users');
  res.json({ id: u.id });
});

r.put('/users/:id', requirePerm('users.manage'), (req, res) => {
  const id = int(req.params.id);
  const b = req.body || {};
  tx(() => {
    const u = q.get('SELECT * FROM users WHERE id = ?', id);
    if (!u) notFound('Utilisateur introuvable.');
    const name = b.name !== undefined ? str(b.name, 60) || bad('Le nom est obligatoire.') : u.name;
    const role = b.role !== undefined ? checkRole(b.role) : u.role;
    const active = b.active !== undefined ? (bool(b.active) ? 1 : 0) : u.active;
    if (u.role === 'admin' && (role !== 'admin' || !active) && activeAdmins(id) === 0) {
      bad('Il doit rester au moins un administrateur actif.');
    }
    if (active && q.get('SELECT id FROM users WHERE name = ? COLLATE NOCASE AND active = 1 AND id <> ?', name, id)) {
      bad('Un utilisateur actif porte déjà ce nom.');
    }
    q.run('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?', name, role, active, id);
    if (b.pin) {
      if (!validPin(String(b.pin))) bad('Le code PIN doit contenir 4 à 8 chiffres.');
      q.run('UPDATE users SET pin_hash = ? WHERE id = ?', hashPin(String(b.pin)), id);
    }
    // Déconnexion des autres appareils si le compte est désactivé ou si le code PIN change
    if (!active || b.pin) destroyUserSessions(id, id === req.user.id ? currentToken(req) : null);
  });
  broadcast('users');
  res.json({ ok: true });
});

export default r;
