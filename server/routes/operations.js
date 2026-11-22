// Ventes (dont hors ligne et retours), approvisionnements, mouvements de stock, lots et dépenses.
import { Router } from 'express';
import { q } from '../db.js';
import { requirePerm } from '../auth.js';
import {
  createSale,
  getSale,
  cancelSale,
  refundSale,
  createPurchase,
  receivePurchase,
  cancelPurchase,
  addPurchasePayment,
  adjustStock,
  ADJUST_REASONS,
  PURCHASE_PAID_SQL,
} from '../services.js';
import { paymentMethods, getSettings } from '../settings.js';
import { bad, notFound, forbidden, str, num, int, round2, dayRange, nowLocal } from '../util.js';
import { broadcast } from '../events.js';
import { sendToPrinter, DRAWER_PULSE } from '../print/print.js';

const r = Router();

const REFUNDED_SQL = '(SELECT COALESCE(SUM(rf.amount), 0) FROM refunds rf WHERE rf.sale_id = s.id)';

// ---- Ventes -------------------------------------------------------------------
r.get('/sales', requirePerm('pos'), (req, res) => {
  const where = [];
  const args = [];
  if (req.query.review === '1') {
    if (!req.perms.has('sales.cancel')) forbidden();
    where.push('s.needs_review IS NOT NULL');
  } else {
    const [from, to] = dayRange(req.query.from, req.query.to);
    where.push('s.created_at >= ?', 's.created_at < ?');
    args.push(from, to);
  }
  if (!req.perms.has('sales.all')) {
    where.push('s.user_id = ?');
    args.push(req.user.id);
  } else if (int(req.query.user_id)) {
    where.push('s.user_id = ?');
    args.push(int(req.query.user_id));
  }
  if (int(req.query.customer_id)) {
    where.push('s.customer_id = ?');
    args.push(int(req.query.customer_id));
  }
  if (req.query.status === 'completed' || req.query.status === 'cancelled') {
    where.push('s.status = ?');
    args.push(req.query.status);
  }
  if (req.query.credit === '1') where.push('s.total - s.paid > 0.004');
  const search = str(req.query.q, 60);
  if (search) {
    const n = int(search.replace(/^n°\s*|^#/i, ''));
    if (n) {
      where.push('(s.id = ? OR c.name LIKE ?)');
      args.push(n, `%${search}%`);
    } else {
      where.push('c.name LIKE ?');
      args.push(`%${search}%`);
    }
  }
  const rows = q.all(
    `SELECT s.id, s.created_at, s.total, s.paid, s.discount, s.status, s.mode, s.customer_id, s.needs_review, s.offline,
            c.name AS customer_name, u.name AS user_name, ${REFUNDED_SQL} AS refunded_total,
            (SELECT sv.name FROM users sv WHERE sv.id = s.seller_id) AS seller_name,
            (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id) AS lines,
            (SELECT GROUP_CONCAT(method, ', ') FROM sale_payments p WHERE p.sale_id = s.id) AS methods
       FROM sales s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN customers c ON c.id = s.customer_id
      WHERE ${where.join(' AND ')}
      ORDER BY s.id DESC
      LIMIT 1000`,
    ...args,
  );
  res.json(rows);
});

r.get('/sales/review-count', requirePerm('sales.cancel'), (req, res) => {
  res.json({ count: q.val('SELECT COUNT(*) FROM sales WHERE needs_review IS NOT NULL') });
});

r.get('/sales/:id', requirePerm('pos'), (req, res) => {
  const sale = getSale(int(req.params.id), req.perms);
  if (!sale) notFound('Vente introuvable.');
  if (!req.perms.has('sales.all') && sale.user_id !== req.user.id) forbidden();
  res.json(sale);
});

/** Ouvre le tiroir-caisse branché à l'imprimante de tickets (si réglé). */
function pulseDrawer() {
  const s = getSettings();
  if (s.printer && s.cash_drawer) sendToPrinter(s.printer, DRAWER_PULSE).catch(() => {});
}

r.post('/sales', requirePerm('pos'), (req, res) => {
  const body = req.body || {};
  const result = createSale(req.user, req.perms, body);
  if (!result.duplicate) {
    broadcast('products', 'sales', 'customers', ...(body.order_id ? ['orders'] : []));
    if (result.cash && !body.offline) pulseDrawer();
  }
  res.json({ ...getSale(result.id, req.perms), duplicate: result.duplicate });
});

r.post('/sales/:id/cancel', requirePerm('sales.cancel'), (req, res) => {
  const reason = str(req.body?.reason, 300);
  if (!reason) bad("Indiquez le motif de l'annulation.");
  cancelSale(req.user, int(req.params.id), reason);
  broadcast('products', 'sales', 'customers');
  res.json(getSale(int(req.params.id), req.perms));
});

r.post('/sales/:id/refund', requirePerm('sales.cancel'), (req, res) => {
  refundSale(req.user, int(req.params.id), req.body || {});
  broadcast('products', 'sales', 'customers');
  res.json(getSale(int(req.params.id), req.perms));
});

r.post('/sales/:id/reviewed', requirePerm('sales.cancel'), (req, res) => {
  q.run('UPDATE sales SET needs_review = NULL WHERE id = ?', int(req.params.id));
  broadcast('sales');
  res.json(getSale(int(req.params.id), req.perms));
});

// ---- Approvisionnements (commandes, réceptions, paiements fournisseurs) ------------
function purchaseDetail(id) {
  const p = q.get(
    `SELECT x.*, ${PURCHASE_PAID_SQL} AS paid, s.name AS supplier_name, u.name AS user_name
       FROM purchases x LEFT JOIN suppliers s ON s.id = x.supplier_id JOIN users u ON u.id = x.user_id
      WHERE x.id = ?`,
    id,
  );
  if (!p) notFound('Achat introuvable.');
  p.items = q.all('SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY id', p.id);
  p.payments = q.all(
    `SELECT pp.*, u.name AS user_name FROM purchase_payments pp LEFT JOIN users u ON u.id = pp.user_id
      WHERE pp.purchase_id = ? ORDER BY pp.id`,
    p.id,
  );
  return p;
}

r.get('/purchases', requirePerm('stock.manage'), (req, res) => {
  const where = [];
  const args = [];
  const status = ['ordered', 'received', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  if (status === 'ordered') {
    // Les commandes en attente restent visibles quelle que soit leur date
    where.push("x.status = 'ordered'");
  } else {
    const [from, to] = dayRange(req.query.from, req.query.to);
    where.push('x.created_at >= ?', 'x.created_at < ?');
    args.push(from, to);
    if (status) {
      where.push('x.status = ?');
      args.push(status);
    }
  }
  if (req.query.unpaid === '1') where.push(`x.status <> 'cancelled' AND x.total - ${PURCHASE_PAID_SQL} > 0.004`);
  if (int(req.query.supplier_id)) {
    where.push('x.supplier_id = ?');
    args.push(int(req.query.supplier_id));
  }
  res.json(
    q.all(
      `SELECT x.*, ${PURCHASE_PAID_SQL} AS paid, s.name AS supplier_name, u.name AS user_name,
              (SELECT COUNT(*) FROM purchase_items i WHERE i.purchase_id = x.id) AS lines
         FROM purchases x
         LEFT JOIN suppliers s ON s.id = x.supplier_id
         JOIN users u ON u.id = x.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY x.id DESC LIMIT 1000`,
      ...args,
    ),
  );
});

r.get('/purchases/:id', requirePerm('stock.manage'), (req, res) => res.json(purchaseDetail(int(req.params.id))));

r.post('/purchases', requirePerm('stock.manage'), (req, res) => {
  const id = createPurchase(req.user, req.body || {});
  broadcast('products', 'purchases');
  res.json(purchaseDetail(id));
});

r.post('/purchases/:id/receive', requirePerm('stock.manage'), (req, res) => {
  receivePurchase(req.user, int(req.params.id), { updateCost: req.body?.update_cost !== false });
  broadcast('products', 'purchases');
  res.json(purchaseDetail(int(req.params.id)));
});

r.post('/purchases/:id/cancel', requirePerm('stock.manage'), (req, res) => {
  cancelPurchase(int(req.params.id));
  broadcast('purchases');
  res.json(purchaseDetail(int(req.params.id)));
});

r.post('/purchases/:id/payments', requirePerm('stock.manage'), (req, res) => {
  addPurchasePayment(req.user, int(req.params.id), req.body || {});
  broadcast('purchases');
  res.json(purchaseDetail(int(req.params.id)));
});

// ---- Stock ----------------------------------------------------------------------
r.get('/stock/reasons', requirePerm('stock.manage'), (req, res) => res.json(ADJUST_REASONS));

r.post('/stock/adjust', requirePerm('stock.manage'), (req, res) => {
  const stock = adjustStock(req.user, req.body || {});
  broadcast('products');
  res.json({ ok: true, stock });
});

r.get('/products/:id/lots', requirePerm('stock.manage', 'products.manage'), (req, res) => {
  res.json(
    q.all(
      `SELECT * FROM stock_lots WHERE product_id = ? AND qty > 0
        ORDER BY (expiry_date IS NULL OR expiry_date = ''), expiry_date, id`,
      int(req.params.id),
    ),
  );
});

r.get('/stock/expiring', requirePerm('stock.manage', 'products.manage'), (req, res) => {
  const days = Math.min(Math.max(int(req.query.days) || 30, 1), 365);
  res.json(
    q.all(
      `SELECT l.id, l.product_id, l.code, l.expiry_date, l.qty, p.name, p.unit, p.pack_unit, p.pack_size
         FROM stock_lots l JOIN products p ON p.id = l.product_id
        WHERE p.active = 1 AND l.qty > 0 AND l.expiry_date IS NOT NULL AND l.expiry_date <> ''
          AND l.expiry_date <= date('now', 'localtime', ?)
        ORDER BY l.expiry_date, p.name`,
      `+${days} day`,
    ),
  );
});

r.get('/stock/movements', requirePerm('stock.manage'), (req, res) => {
  const [from, to] = dayRange(req.query.from, req.query.to);
  const where = ['m.created_at >= ?', 'm.created_at < ?'];
  const args = [from, to];
  if (int(req.query.product_id)) {
    where.push('m.product_id = ?');
    args.push(int(req.query.product_id));
  }
  if (str(req.query.type, 20)) {
    where.push('m.type = ?');
    args.push(str(req.query.type, 20));
  }
  res.json(
    q.all(
      `SELECT m.*, p.name AS product_name, p.unit, p.pack_unit, p.pack_size, u.name AS user_name
         FROM stock_movements m
         JOIN products p ON p.id = m.product_id
         LEFT JOIN users u ON u.id = m.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY m.id DESC LIMIT 1500`,
      ...args,
    ),
  );
});

// ---- Dépenses -------------------------------------------------------------------
r.get('/expenses', requirePerm('expenses.add', 'expenses.manage'), (req, res) => {
  const [from, to] = dayRange(req.query.from, req.query.to);
  const where = ['e.created_at >= ?', 'e.created_at < ?'];
  const args = [from, to];
  if (!req.perms.has('expenses.manage')) {
    where.push('e.user_id = ?');
    args.push(req.user.id);
  }
  res.json(
    q.all(
      `SELECT e.*, u.name AS user_name FROM expenses e JOIN users u ON u.id = e.user_id
        WHERE ${where.join(' AND ')} ORDER BY e.id DESC`,
      ...args,
    ),
  );
});

export const EXPENSE_CATEGORIES = ['Transport', 'Loyer', 'Électricité / Eau', 'Salaires', 'Manutention', 'Repas', 'Fournitures', 'Taxes', 'Divers'];

r.get('/expenses/categories', requirePerm('expenses.add'), (req, res) => {
  const used = q.all('SELECT DISTINCT category FROM expenses ORDER BY category').map((x) => x.category);
  res.json([...new Set([...EXPENSE_CATEGORIES, ...used])]);
});

r.post('/expenses', requirePerm('expenses.add'), (req, res) => {
  const amount = round2(num(req.body?.amount));
  if (!(amount > 0)) bad('Montant invalide.');
  const method = str(req.body?.method, 40) || 'Espèces';
  if (!paymentMethods().includes(method)) bad('Moyen de paiement inconnu.');
  const e = q.run(
    'INSERT INTO expenses (user_id, category, amount, method, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    req.user.id,
    str(req.body?.category, 60) || 'Divers',
    amount,
    method,
    str(req.body?.note, 300),
    nowLocal(),
  );
  broadcast('expenses');
  res.json({ id: e.id });
});

r.delete('/expenses/:id', requirePerm('expenses.manage'), (req, res) => {
  q.run('DELETE FROM expenses WHERE id = ?', int(req.params.id));
  broadcast('expenses');
  res.json({ ok: true });
});

export default r;
