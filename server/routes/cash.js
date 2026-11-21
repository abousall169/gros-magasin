// Sessions de caisse : ouverture avec un fond de caisse, clôture avec les espèces comptées.
// Une session couvre soit la caisse d'un vendeur, soit tout le magasin.
import { Router } from 'express';
import { q, tx } from '../db.js';
import { requirePerm } from '../auth.js';
import { CASH } from '../settings.js';
import { bad, notFound, forbidden, str, num, int, round2, nowLocal } from '../util.js';
import { broadcast } from '../events.js';

const r = Router();

/** Détail des espèces attendues dans le tiroir entre l'ouverture de la session et « until ». */
export function cashBreakdown(session, until = nowLocal()) {
  const userId = session.user_id;
  const uf = (col) => (userId ? ` AND ${col} = ${Number(userId)}` : '');
  const val = (sql, ...args) => round2(q.val(sql, ...args) || 0);
  const from = session.opened_at;
  const sales = val(
    `SELECT COALESCE(SUM(p.amount), 0) FROM sale_payments p JOIN sales s ON s.id = p.sale_id
      WHERE p.method = ? AND s.status = 'completed' AND s.created_at >= ? AND s.created_at <= ?${uf('s.user_id')}`,
    CASH,
    from,
    until,
  );
  const payments = val(
    `SELECT COALESCE(SUM(amount), 0) FROM customer_payments
      WHERE method = ? AND created_at >= ? AND created_at <= ?${uf('user_id')}`,
    CASH,
    from,
    until,
  );
  const refunds = val(
    `SELECT COALESCE(SUM(r.amount), 0) FROM refunds r JOIN sales s ON s.id = r.sale_id
      WHERE r.method = ? AND s.status = 'completed' AND r.created_at >= ? AND r.created_at <= ?${uf('r.user_id')}`,
    CASH,
    from,
    until,
  );
  const expenses = val(
    `SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE method = ? AND created_at >= ? AND created_at <= ?${uf('user_id')}`,
    CASH,
    from,
    until,
  );
  const suppliers = val(
    `SELECT COALESCE(SUM(amount), 0) FROM purchase_payments
      WHERE method = ? AND created_at >= ? AND created_at <= ?${uf('user_id')}`,
    CASH,
    from,
    until,
  );
  const opening = round2(session.opening_float);
  const expected = round2(opening + sales + payments - refunds - expenses - suppliers);
  return { opening_float: opening, sales, payments, refunds, expenses, suppliers, expected };
}

const SESSION_SELECT = `
  SELECT c.*, u.name AS user_name, a.name AS opened_by_name, b.name AS closed_by_name
    FROM cash_sessions c
    LEFT JOIN users u ON u.id = c.user_id
    LEFT JOIN users a ON a.id = c.opened_by
    LEFT JOIN users b ON b.id = c.closed_by`;

function canSee(req, session) {
  return req.perms.has('cash.all') || session.user_id === req.user.id;
}

r.get('/cash/sessions', requirePerm('cash.own', 'cash.all'), (req, res) => {
  const all = req.perms.has('cash.all');
  const scope = all ? '' : ` AND c.user_id = ${Number(req.user.id)}`;
  const open = q.all(`${SESSION_SELECT} WHERE c.status = 'open'${scope} ORDER BY c.user_id IS NOT NULL, u.name`);
  for (const s of open) s.breakdown = cashBreakdown(s);
  const history = q.all(`${SESSION_SELECT} WHERE c.status = 'closed'${scope} ORDER BY c.id DESC LIMIT 40`);
  for (const s of history) {
    try {
      s.breakdown = JSON.parse(s.breakdown || 'null');
    } catch {
      s.breakdown = null;
    }
  }
  res.json({ open, history });
});

r.post('/cash/sessions', requirePerm('cash.own', 'cash.all'), (req, res) => {
  const float = round2(num(req.body?.opening_float, 0));
  if (!(float >= 0)) bad('Fond de caisse invalide.');
  const store = req.body?.scope === 'store';
  if (store && !req.perms.has('cash.all')) forbidden();
  const userId = store ? null : req.user.id;
  const id = tx(() => {
    const already = q.get(`SELECT id FROM cash_sessions WHERE status = 'open' AND user_id IS ?`, userId);
    if (already) bad(store ? 'La caisse du magasin est déjà ouverte.' : 'Votre caisse est déjà ouverte.');
    return q.run(
      'INSERT INTO cash_sessions (user_id, opening_float, opened_by, opened_at, note) VALUES (?, ?, ?, ?, ?)',
      userId,
      float,
      req.user.id,
      nowLocal(),
      str(req.body?.note, 300),
    ).id;
  });
  broadcast('cash');
  res.json({ id });
});

r.post('/cash/sessions/:id/close', requirePerm('cash.own', 'cash.all'), (req, res) => {
  const id = int(req.params.id);
  const counted = round2(num(req.body?.counted));
  if (!(counted >= 0)) bad('Indiquez les espèces comptées.');
  const result = tx(() => {
    const s = q.get('SELECT * FROM cash_sessions WHERE id = ?', id);
    if (!s) notFound('Session de caisse introuvable.');
    if (!canSee(req, s)) forbidden();
    if (s.status !== 'open') bad('Cette caisse est déjà clôturée.');
    const now = nowLocal();
    const breakdown = cashBreakdown(s, now);
    const difference = round2(counted - breakdown.expected);
    const note = [s.note, str(req.body?.note, 300)].filter(Boolean).join(' — ') || null;
    q.run(
      `UPDATE cash_sessions SET status = 'closed', closed_by = ?, closed_at = ?, expected = ?, counted = ?, difference = ?,
              breakdown = ?, note = ? WHERE id = ?`,
      req.user.id,
      now,
      breakdown.expected,
      counted,
      difference,
      JSON.stringify(breakdown),
      note,
      id,
    );
    return q.get(`${SESSION_SELECT} WHERE c.id = ?`, id);
  });
  result.breakdown = JSON.parse(result.breakdown);
  broadcast('cash');
  res.json(result);
});

export default r;
