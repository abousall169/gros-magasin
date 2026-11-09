import { Router } from 'express';
import { q, tx } from '../db.js';
import {
  hashPin,
  verifyPin,
  validPin,
  createSession,
  destroySession,
  destroyUserSessions,
  currentToken,
  checkLoginAllowed,
  loginFailed,
  loginSucceeded,
  requireAuth,
} from '../auth.js';
import { getSettings, updateSettings, paymentMethods, ROLES } from '../settings.js';
import { bad, str, int, nowLocal, HttpError } from '../util.js';
import { seedDemo } from '../demo.js';
import { broadcast } from '../events.js';

const r = Router();

/** Informations publiques pour l'écran de connexion. */
r.get('/status', (req, res) => {
  const s = getSettings();
  res.json({
    needsSetup: q.val('SELECT COUNT(*) FROM users') === 0,
    store_name: s.store_name,
    users: q.all('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name COLLATE NOCASE'),
    loggedIn: !!req.user,
  });
});

/** Première installation : création du magasin et du compte administrateur. */
r.post('/setup', (req, res) => {
  const b = req.body || {};
  const storeName = str(b.store_name, 80) || bad('Indiquez le nom du magasin.');
  const adminName = str(b.admin_name, 60) || bad('Indiquez votre nom.');
  const pin = String(b.pin || '');
  if (!validPin(pin)) bad('Le code PIN doit contenir 4 à 8 chiffres.');

  const userId = tx(() => {
    if (q.val('SELECT COUNT(*) FROM users') > 0) throw new HttpError(409, 'Le magasin est déjà configuré.');
    updateSettings({
      store_name: storeName,
      currency: str(b.currency, 10) || 'FCFA',
      currency_decimals: Number(b.currency_decimals) === 2 ? 2 : 0,
      store_phone: str(b.store_phone, 80) || '',
      store_address: str(b.store_address, 200) || '',
    });
    const u = q.run(
      'INSERT INTO users (name, role, pin_hash, active, created_at) VALUES (?, ?, ?, 1, ?)',
      adminName,
      'admin',
      hashPin(pin),
      nowLocal(),
    );
    if (b.demo) seedDemo({ id: u.id, name: adminName, role: 'admin' });
    return u.id;
  });
  createSession(res, userId, req.headers['user-agent']);
  broadcast('users', 'products', 'settings');
  res.json({ ok: true });
});

r.post('/login', (req, res) => {
  const userId = int(req.body?.user_id);
  const pin = String(req.body?.pin || '');
  const user = userId && q.get('SELECT * FROM users WHERE id = ? AND active = 1', userId);
  if (!user) bad('Utilisateur introuvable.');
  checkLoginAllowed(user.id);
  if (!verifyPin(pin, user.pin_hash)) {
    loginFailed(user.id);
    throw new HttpError(401, 'Code PIN incorrect.');
  }
  loginSucceeded(user.id);
  createSession(res, user.id, req.headers['user-agent']);
  res.json({ ok: true });
});

r.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

r.get('/me', requireAuth, (req, res) => {
  res.json({
    user: req.user,
    perms: [...req.perms],
    settings: getSettings(),
    paymentMethods: paymentMethods(),
    roles: ROLES,
  });
});

r.post('/change-pin', requireAuth, (req, res) => {
  const user = q.get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!verifyPin(String(req.body?.current || ''), user.pin_hash)) bad('Code PIN actuel incorrect.');
  const pin = String(req.body?.pin || '');
  if (!validPin(pin)) bad('Le nouveau code PIN doit contenir 4 à 8 chiffres.');
  q.run('UPDATE users SET pin_hash = ? WHERE id = ?', hashPin(pin), user.id);
  destroyUserSessions(user.id, currentToken(req));
  res.json({ ok: true });
});

export default r;
