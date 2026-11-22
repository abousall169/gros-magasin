// Sessions de caisse : ouverture avec un fond de caisse, clôture avec les espèces comptées.
// Une session couvre soit la caisse d'un vendeur, soit tout le magasin.
// Le caissier, lui, n'ouvre rien : sa journée commence à la fin de la précédente (« Terminer la journée »)
// et ses totaux repartent de zéro à chaque fin de journée.
import { Router } from 'express';
import { q, tx } from '../db.js';
import { requirePerm } from '../auth.js';
import { CASH } from '../settings.js';
import { bad, notFound, forbidden, str, num, int, round2, nowLocal, todayLocal } from '../util.js';
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
  // Détail pour la clôture imprimée : nombre de ventes, encaissements hors espèces, dépenses une par une
  const done = q.get(
    `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(total - paid), 0) AS credit FROM sales s
      WHERE s.status = 'completed' AND s.created_at >= ? AND s.created_at <= ?${uf('s.user_id')}`,
    from,
    until,
  );
  const methods = q
    .all(
      `SELECT method, ROUND(SUM(amount), 2) AS amount FROM (
         SELECT p.method, p.amount FROM sale_payments p JOIN sales s ON s.id = p.sale_id
          WHERE s.status = 'completed' AND s.created_at >= ? AND s.created_at <= ?${uf('s.user_id')}
         UNION ALL
         SELECT method, amount FROM customer_payments WHERE created_at >= ? AND created_at <= ?${uf('user_id')}
       ) WHERE method <> ? GROUP BY method ORDER BY amount DESC`,
      from,
      until,
      from,
      until,
      CASH,
    )
    .map((m) => ({ method: m.method, amount: round2(m.amount) }));
  const expenseItems = q.all(
    `SELECT id, category, amount, method, note, created_at FROM expenses
      WHERE created_at >= ? AND created_at <= ?${uf('user_id')} ORDER BY id LIMIT 200`,
    from,
    until,
  );
  // Total caisse (vue du caissier) : total des ventes encaissées moins toutes les dépenses de la journée
  const expensesTotal = val(`SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE created_at >= ? AND created_at <= ?${uf('user_id')}`, from, until);
  return {
    opening_float: opening,
    sales,
    payments,
    refunds,
    expenses,
    suppliers,
    expected,
    count: Number(done.count) || 0,
    sales_total: round2(done.total),
    credit: round2(done.credit),
    methods,
    expense_items: expenseItems,
    expenses_total: expensesTotal,
    till_total: round2(done.total - expensesTotal),
  };
}

const SESSION_SELECT = `
  SELECT c.*, u.name AS user_name, a.name AS opened_by_name, b.name AS closed_by_name
    FROM cash_sessions c
    LEFT JOIN users u ON u.id = c.user_id
    LEFT JOIN users a ON a.id = c.opened_by
    LEFT JOIN users b ON b.id = c.closed_by`;

/** 'AAAA-MM-JJ HH:MM:SS' + 1 seconde : la journée suivante ne recompte pas la seconde de la clôture. */
function nextSecond(s) {
  const [d, t] = s.split(' ');
  const [y, m, day] = d.split('-').map(Number);
  const [h, mi, se] = t.split(':').map(Number);
  return nowLocal(new Date(y, m - 1, day, h, mi, se + 1));
}

/**
 * Journée en cours d'un employé : sa caisse encore ouverte (ancien fonctionnement, avec fond de caisse),
 * sinon depuis sa dernière fin de journée, sinon depuis minuit.
 */
export function currentPeriod(userId) {
  const open = q.get("SELECT * FROM cash_sessions WHERE status = 'open' AND user_id = ? ORDER BY id LIMIT 1", userId);
  if (open) return { session: open, from: open.opened_at, opening_float: round2(open.opening_float) };
  const last = q.get("SELECT closed_at FROM cash_sessions WHERE status = 'closed' AND user_id = ? ORDER BY closed_at DESC, id DESC LIMIT 1", userId);
  return { session: null, from: last?.closed_at ? nextSecond(last.closed_at) : `${todayLocal()} 00:00:00`, opening_float: 0 };
}

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

// ---- Journée du caissier : totaux depuis la dernière fin de journée, puis « Terminer la journée » ----------
const lastClosed = (userId) => {
  const s = q.get(`${SESSION_SELECT} WHERE c.status = 'closed' AND c.user_id = ? ORDER BY c.closed_at DESC, c.id DESC LIMIT 1`, userId);
  if (s) {
    try {
      s.breakdown = JSON.parse(s.breakdown || 'null');
    } catch {
      s.breakdown = null;
    }
  }
  return s || null;
};

r.get('/cash/current', requirePerm('cash.own'), (req, res) => {
  const p = currentPeriod(req.user.id);
  res.json({
    from: p.from,
    opening_float: p.opening_float,
    breakdown: cashBreakdown({ user_id: req.user.id, opened_at: p.from, opening_float: p.opening_float }),
    last_closed: lastClosed(req.user.id),
  });
});

/** Termine la journée : enregistre les totaux (et les espèces comptées, facultatives), puis tout repart de zéro. */
r.post('/cash/current/close', requirePerm('cash.own'), (req, res) => {
  const raw = req.body?.counted;
  const counted = raw === undefined || raw === null || String(raw).trim() === '' ? null : round2(num(raw, NaN));
  if (counted !== null && !(counted >= 0)) bad('Montant compté invalide.');
  const note = str(req.body?.note, 300);
  const result = tx(() => {
    const p = currentPeriod(req.user.id);
    const now = nowLocal();
    if (p.from > now) bad('La journée vient d’être terminée.');
    const breakdown = cashBreakdown({ user_id: req.user.id, opened_at: p.from, opening_float: p.opening_float }, now);
    // Journée vide (double appui, ou rien depuis la dernière fin de journée) : rien à enregistrer
    const empty = !breakdown.count && !breakdown.expense_items.length && !breakdown.payments && !breakdown.refunds && !breakdown.suppliers;
    if (!p.session && empty) bad('Rien à terminer : aucune vente ni dépense depuis la dernière fin de journée.');
    const difference = counted === null ? null : round2(counted - breakdown.expected);
    let id;
    if (p.session) {
      q.run(
        `UPDATE cash_sessions SET status = 'closed', closed_by = ?, closed_at = ?, expected = ?, counted = ?, difference = ?,
                breakdown = ?, note = ? WHERE id = ?`,
        req.user.id,
        now,
        breakdown.expected,
        counted,
        difference,
        JSON.stringify(breakdown),
        [p.session.note, note].filter(Boolean).join(' — ') || null,
        p.session.id,
      );
      id = p.session.id;
    } else {
      id = q.run(
        `INSERT INTO cash_sessions (user_id, status, opening_float, opened_by, opened_at, closed_by, closed_at, expected, counted, difference, breakdown, note)
         VALUES (?, 'closed', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        req.user.id,
        req.user.id,
        p.from,
        req.user.id,
        now,
        breakdown.expected,
        counted,
        difference,
        JSON.stringify(breakdown),
        note,
      ).id;
    }
    return q.get(`${SESSION_SELECT} WHERE c.id = ?`, id);
  });
  result.breakdown = JSON.parse(result.breakdown);
  broadcast('cash');
  res.json(result);
});

export default r;
