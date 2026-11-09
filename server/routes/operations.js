// Ventes, approvisionnements, mouvements de stock et dépenses.
import { Router } from 'express';
import { q } from '../db.js';
import { requirePerm } from '../auth.js';
import { createSale, getSale, cancelSale, createPurchase, adjustStock, ADJUST_REASONS } from '../services.js';
import { paymentMethods } from '../settings.js';
import { bad, notFound, forbidden, str, num, int, round2, dayRange, nowLocal } from '../util.js';
import { broadcast } from '../events.js';

const r = Router();

// ---- Ventes -------------------------------------------------------------------
r.get('/sales', requirePerm('pos'), (req, res) => {
  const [from, to] = dayRange(req.query.from, req.query.to);
  const where = ['s.created_at >= ?', 's.created_at < ?'];
  const args = [from, to];
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
    `SELECT s.id, s.created_at, s.total, s.paid, s.discount, s.status, s.mode, s.customer_id,
            c.name AS customer_name, u.name AS user_name,
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

r.get('/sales/:id', requirePerm('pos'), (req, res) => {
  const sale = getSale(int(req.params.id), req.perms);
  if (!sale) notFound('Vente introuvable.');
  if (!req.perms.has('sales.all') && sale.user_id !== req.user.id) forbidden();
  res.json(sale);
});

r.post('/sales', requirePerm('pos'), (req, res) => {
  const id = createSale(req.user, req.perms, req.body || {});
  broadcast('products', 'sales', 'customers');
  res.json(getSale(id, req.perms));
});

r.post('/sales/:id/cancel', requirePerm('sales.cancel'), (req, res) => {
  const reason = str(req.body?.reason, 300);
  if (!reason) bad("Indiquez le motif de l'annulation.");
  cancelSale(req.user, int(req.params.id), reason);
  broadcast('products', 'sales', 'customers');
  res.json(getSale(int(req.params.id), req.perms));
});

// ---- Approvisionnements ---------------------------------------------------------
r.get('/purchases', requirePerm('stock.manage'), (req, res) => {
  const [from, to] = dayRange(req.query.from, req.query.to);
  res.json(
    q.all(
      `SELECT p.*, s.name AS supplier_name, u.name AS user_name,
              (SELECT COUNT(*) FROM purchase_items i WHERE i.purchase_id = p.id) AS lines
         FROM purchases p
         LEFT JOIN suppliers s ON s.id = p.supplier_id
         JOIN users u ON u.id = p.user_id
        WHERE p.created_at >= ? AND p.created_at < ?
        ORDER BY p.id DESC`,
      from,
      to,
    ),
  );
});

r.get('/purchases/:id', requirePerm('stock.manage'), (req, res) => {
  const p = q.get(
    `SELECT p.*, s.name AS supplier_name, u.name AS user_name
       FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id JOIN users u ON u.id = p.user_id
      WHERE p.id = ?`,
    int(req.params.id),
  );
  if (!p) notFound('Approvisionnement introuvable.');
  p.items = q.all('SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY id', p.id);
  res.json(p);
});

r.post('/purchases', requirePerm('stock.manage'), (req, res) => {
  const id = createPurchase(req.user, req.body || {});
  broadcast('products');
  res.json({ id });
});

// ---- Stock ----------------------------------------------------------------------
r.get('/stock/reasons', requirePerm('stock.manage'), (req, res) => res.json(ADJUST_REASONS));

r.post('/stock/adjust', requirePerm('stock.manage'), (req, res) => {
  const stock = adjustStock(req.user, req.body || {});
  broadcast('products');
  res.json({ ok: true, stock });
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
