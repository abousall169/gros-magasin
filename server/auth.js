// Authentification par code PIN + sessions (cookie httpOnly).
import crypto from 'node:crypto';
import { q } from './db.js';
import { HttpError, nowLocal } from './util.js';
import { permsFor } from './settings.js';

const COOKIE = 'gm_session';
const SESSION_DAYS = 30;

export function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPin(pin, stored) {
  const [algo, saltHex, hashHex] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function validPin(pin) {
  return typeof pin === 'string' && /^\d{4,8}$/.test(pin);
}

// --- Limitation des tentatives de connexion (en mémoire) --------------------
const attempts = new Map(); // userId -> { count, until }
export function checkLoginAllowed(userId) {
  const a = attempts.get(userId);
  if (a && a.until > Date.now()) {
    const s = Math.ceil((a.until - Date.now()) / 1000);
    throw new HttpError(429, `Trop d'essais. Réessayez dans ${s} secondes.`);
  }
}
export function loginFailed(userId) {
  const a = attempts.get(userId) || { count: 0, until: 0 };
  a.count++;
  if (a.count >= 5) {
    a.until = Date.now() + 60_000;
    a.count = 0;
  }
  attempts.set(userId, a);
}
export function loginSucceeded(userId) {
  attempts.delete(userId);
}

// --- Sessions ----------------------------------------------------------------
export function createSession(res, userId, device) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = nowLocal();
  q.run(
    'INSERT INTO sessions (token, user_id, device, created_at, last_seen) VALUES (?, ?, ?, ?, ?)',
    token,
    userId,
    String(device || '').slice(0, 200),
    now,
    now,
  );
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`,
  );
  return token;
}

export function destroySession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) q.run('DELETE FROM sessions WHERE token = ?', token);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export function destroyUserSessions(userId, exceptToken = null) {
  q.run('DELETE FROM sessions WHERE user_id = ? AND token IS NOT ?', userId, exceptToken);
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function currentToken(req) {
  return readCookie(req, COOKIE);
}

const lastTouch = new Map();

/** Middleware : charge req.user si la session est valide. */
export function loadUser(req, _res, next) {
  const token = readCookie(req, COOKIE);
  if (token) {
    const row = q.get(
      `SELECT s.token, s.last_seen, u.id, u.name, u.role, u.active
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`,
      token,
    );
    if (row && row.active) {
      const limit = nowLocal(new Date(Date.now() - SESSION_DAYS * 86400_000));
      if (row.last_seen < limit) {
        q.run('DELETE FROM sessions WHERE token = ?', token);
      } else {
        req.user = { id: row.id, name: row.name, role: row.role };
        req.perms = permsFor(req.user);
        // Mise à jour de last_seen au plus une fois par minute
        const t = lastTouch.get(token) || 0;
        if (Date.now() - t > 60_000) {
          lastTouch.set(token, Date.now());
          q.run('UPDATE sessions SET last_seen = ? WHERE token = ?', nowLocal(), token);
        }
      }
    }
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Session expirée. Veuillez vous reconnecter.'));
  next();
}

/** Middleware : exige au moins une des permissions données. */
export function requirePerm(...perms) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Session expirée. Veuillez vous reconnecter.'));
    if (!perms.some((p) => req.perms.has(p))) {
      return next(new HttpError(403, "Vous n'avez pas l'autorisation d'effectuer cette action."));
    }
    next();
  };
}
