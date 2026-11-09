// Clients (comptes, crédits, versements) et fournisseurs.
import { Router } from 'express';
import { q, tx } from '../db.js';
import { requirePerm } from '../auth.js';
import { BALANCE_SQL, customerBalance } from '../services.js';
import { paymentMethods } from '../settings.js';
import { bad, notFound, str, num, int, round2, nowLocal } from '../util.js';
import { toCSV, sendCSV } from '../csv.js';
import { broadcast } from '../events.js';

const r = Router();

// ---- Clients ------------------------------------------------------------------
r.get('/customers', (req, res) => {
  const where = [];
  const args = [];
  if (req.query.all !== '1') where.push('c.active = 1');
  const search = str(req.query.q, 60);
  if (search) {
    where.push('(c.name LIKE ? OR c.phone LIKE ?)');
    args.push(`%${search}%`, `%${search}%`);
  }
  const rows = q.all(
    `SELECT c.*, ROUND(${BALANCE_SQL}, 2) AS balance,
            (SELECT MAX(created_at) FROM sales s WHERE s.customer_id = c.id AND s.status = 'completed') AS last_sale
       FROM customers c
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY c.name COLLATE NOCASE`,
    ...args,
  );
  res.json(req.query.debt === '1' ? rows.filter((c) => c.balance > 0.004) : rows);
});

r.get('/customers/:id', (req, res) => {
  const id = int(req.params.id);
  const c = q.get(`SELECT c.*, ROUND(${BALANCE_SQL}, 2) AS balance FROM customers c WHERE c.id = ?`, id);
  if (!c) notFound('Client introuvable.');
  // Le compte client montre toutes ses opérations (quel que soit le vendeur)
  c.sales = q.all(
    `SELECT s.id, s.created_at, s.total, s.paid, s.status, s.mode, u.name AS user_name
       FROM sales s JOIN users u ON u.id = s.user_id
      WHERE s.customer_id = ?
      ORDER BY s.id DESC LIMIT 300`,
    id,
  );
  c.payments = q.all(
    `SELECT cp.*, u.name AS user_name FROM customer_payments cp JOIN users u ON u.id = cp.user_id
      WHERE cp.customer_id = ? ORDER BY cp.id DESC LIMIT 300`,
    id,
  );
  c.totals = q.get(
    `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
       FROM sales WHERE customer_id = ? AND status = 'completed'`,
    id,
  );
  res.json(c);
});

function customerInput(b) {
  const creditLimit = round2(num(b.credit_limit, 0));
  const opening = round2(num(b.opening_balance, 0));
  if (!(creditLimit >= 0)) bad('Plafond de crédit invalide.');
  if (!Number.isFinite(opening)) bad('Solde initial invalide.');
  return {
    name: str(b.name, 100) || bad('Le nom du client est obligatoire.'),
    phone: str(b.phone, 40),
    address: str(b.address, 200),
    type: b.type === 'wholesale' ? 'wholesale' : 'retail',
    credit_limit: creditLimit,
    opening_balance: opening,
    notes: str(b.notes, 500),
  };
}

r.post('/customers', requirePerm('customers.manage'), (req, res) => {
  const d = customerInput(req.body || {});
  // Seuls les responsables peuvent saisir une dette antérieure
  if (!req.perms.has('customers.delete')) d.opening_balance = 0;
  const c = q.run(
    `INSERT INTO customers (name, phone, address, type, credit_limit, opening_balance, notes, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    d.name,
    d.phone,
    d.address,
    d.type,
    d.credit_limit,
    d.opening_balance,
    d.notes,
    nowLocal(),
  );
  broadcast('customers');
  res.json({ id: c.id, ...d, balance: d.opening_balance });
});

r.put('/customers/:id', requirePerm('customers.manage'), (req, res) => {
  const id = int(req.params.id);
  const existing = q.get('SELECT * FROM customers WHERE id = ?', id);
  if (!existing) notFound('Client introuvable.');
  const d = customerInput(req.body || {});
  if (!req.perms.has('customers.delete')) {
    d.opening_balance = existing.opening_balance;
    d.credit_limit = existing.credit_limit;
  }
  q.run(
    `UPDATE customers SET name = ?, phone = ?, address = ?, type = ?, credit_limit = ?, opening_balance = ?, notes = ?
      WHERE id = ?`,
    d.name,
    d.phone,
    d.address,
    d.type,
    d.credit_limit,
    d.opening_balance,
    d.notes,
    id,
  );
  broadcast('customers');
  res.json({ ok: true });
});

r.delete('/customers/:id', requirePerm('customers.delete'), (req, res) => {
  const id = int(req.params.id);
  if (customerBalance(id) > 0.004) bad('Ce client a encore une dette : soldez son compte avant de le supprimer.');
  q.run('UPDATE customers SET active = 0 WHERE id = ?', id);
  broadcast('customers');
  res.json({ ok: true });
});

/** Versement d'un client pour rembourser sa dette. */
r.post('/customers/:id/payments', requirePerm('payments.receive'), (req, res) => {
  const id = int(req.params.id);
  const amount = round2(num(req.body?.amount));
  if (!(amount > 0)) bad('Montant invalide.');
  const method = str(req.body?.method, 40) || 'Espèces';
  if (!paymentMethods().includes(method)) bad('Moyen de paiement inconnu.');
  const result = tx(() => {
    if (!q.get('SELECT id FROM customers WHERE id = ?', id)) notFound('Client introuvable.');
    const p = q.run(
      'INSERT INTO customer_payments (customer_id, user_id, amount, method, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      req.user.id,
      amount,
      method,
      str(req.body?.note, 200),
      nowLocal(),
    );
    return { id: p.id, balance: customerBalance(id) };
  });
  broadcast('customers', 'sales');
  res.json(result);
});

r.delete('/customer-payments/:id', requirePerm('payments.delete'), (req, res) => {
  q.run('DELETE FROM customer_payments WHERE id = ?', int(req.params.id));
  broadcast('customers', 'sales');
  res.json({ ok: true });
});

r.get('/export/customers.csv', requirePerm('reports.view'), (req, res) => {
  const rows = q.all(
    `SELECT c.*, ROUND(${BALANCE_SQL}, 2) AS balance FROM customers c WHERE c.active = 1 ORDER BY c.name COLLATE NOCASE`,
  );
  sendCSV(
    res,
    'clients.csv',
    toCSV(rows, [
      ['nom', (c) => c.name],
      ['telephone', (c) => c.phone],
      ['adresse', (c) => c.address],
      ['type', (c) => (c.type === 'wholesale' ? 'Gros' : 'Détail')],
      ['plafond_credit', (c) => c.credit_limit],
      ['solde_du', (c) => c.balance],
    ]),
  );
});

// ---- Fournisseurs -------------------------------------------------------------
r.get('/suppliers', requirePerm('stock.manage'), (req, res) => {
  res.json(
    q.all(
      `SELECT s.*, (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id) AS purchases,
              (SELECT COALESCE(SUM(total), 0) FROM purchases p WHERE p.supplier_id = s.id) AS purchases_total
         FROM suppliers s WHERE s.active = 1 ORDER BY s.name COLLATE NOCASE`,
    ),
  );
});

function supplierInput(b) {
  return {
    name: str(b.name, 100) || bad('Le nom du fournisseur est obligatoire.'),
    phone: str(b.phone, 40),
    address: str(b.address, 200),
    notes: str(b.notes, 500),
  };
}

r.post('/suppliers', requirePerm('stock.manage'), (req, res) => {
  const d = supplierInput(req.body || {});
  const s = q.run(
    'INSERT INTO suppliers (name, phone, address, notes, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
    d.name,
    d.phone,
    d.address,
    d.notes,
    nowLocal(),
  );
  res.json({ id: s.id, ...d });
});

r.put('/suppliers/:id', requirePerm('stock.manage'), (req, res) => {
  const d = supplierInput(req.body || {});
  const ok = q.run(
    'UPDATE suppliers SET name = ?, phone = ?, address = ?, notes = ? WHERE id = ?',
    d.name,
    d.phone,
    d.address,
    d.notes,
    int(req.params.id),
  ).changes;
  if (!ok) notFound('Fournisseur introuvable.');
  res.json({ ok: true });
});

r.delete('/suppliers/:id', requirePerm('stock.manage'), (req, res) => {
  q.run('UPDATE suppliers SET active = 0 WHERE id = ?', int(req.params.id));
  res.json({ ok: true });
});

export default r;
