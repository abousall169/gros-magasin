// Tableau de bord, rapports de ventes, clôture de caisse et exports.
import { Router } from 'express';
import { q } from '../db.js';
import { requirePerm } from '../auth.js';
import { BALANCE_SQL } from '../services.js';
import { CASH } from '../settings.js';
import { int, round2, dayRange, todayLocal, addDays, isDay, sum } from '../util.js';
import { toCSV, sendCSV } from '../csv.js';

const r = Router();

const SALES_TOTALS = `
  SELECT COUNT(*) AS count,
         COALESCE(SUM(total), 0) AS revenue,
         COALESCE(SUM(subtotal), 0) AS subtotal,
         COALESCE(SUM(discount), 0) AS discount,
         COALESCE(SUM(cost_total), 0) AS cost,
         COALESCE(SUM(total - paid), 0) AS credit
    FROM sales s
   WHERE s.status = 'completed' AND s.created_at >= ? AND s.created_at < ?`;

function fillDays(rows, start, end) {
  const map = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const r = map.get(d) || {};
    out.push({ day: d, count: r.count || 0, revenue: round2(r.revenue || 0), margin: round2(r.margin || 0) });
  }
  return out;
}

function receivables() {
  return q.get(
    `SELECT COALESCE(SUM(b), 0) AS total, COUNT(*) AS customers
       FROM (SELECT ${BALANCE_SQL} AS b FROM customers c) WHERE b > 0.004`,
  );
}

r.get('/reports/dashboard', requirePerm('dashboard'), (req, res) => {
  const today = todayLocal();
  const [from, to] = dayRange(today);
  const [yFrom, yTo] = dayRange(addDays(today, -1));
  const showCost = req.perms.has('cost.view');

  const t = q.get(SALES_TOTALS, from, to);
  const y = q.get(SALES_TOTALS, yFrom, yTo);
  const collected = q.all(
    `SELECT method, ROUND(SUM(amount), 2) AS amount FROM (
        SELECT p.method, p.amount FROM sale_payments p JOIN sales s ON s.id = p.sale_id
         WHERE s.status = 'completed' AND s.created_at >= ? AND s.created_at < ?
        UNION ALL
        SELECT method, amount FROM customer_payments WHERE created_at >= ? AND created_at < ?
     ) GROUP BY method ORDER BY amount DESC`,
    from,
    to,
    from,
    to,
  );
  const byType = q.all(
    `SELECT i.sale_type, ROUND(SUM(i.total), 2) AS amount
       FROM sale_items i JOIN sales s ON s.id = i.sale_id
      WHERE s.status = 'completed' AND s.created_at >= ? AND s.created_at < ?
      GROUP BY i.sale_type`,
    from,
    to,
  );
  const start = addDays(today, -13);
  const series = fillDays(
    q.all(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count, SUM(total) AS revenue, SUM(total - cost_total) AS margin
         FROM sales WHERE status = 'completed' AND created_at >= ? GROUP BY day`,
      `${start} 00:00:00`,
    ),
    start,
    today,
  );
  const top = q.all(
    `SELECT i.product_id, i.name, p.unit, p.pack_unit, p.pack_size,
            ROUND(SUM(i.base_qty), 3) AS qty, ROUND(SUM(i.total), 2) AS revenue
       FROM sale_items i JOIN sales s ON s.id = i.sale_id LEFT JOIN products p ON p.id = i.product_id
      WHERE s.status = 'completed' AND s.created_at >= ?
      GROUP BY i.product_id, i.name ORDER BY revenue DESC LIMIT 6`,
    `${addDays(today, -6)} 00:00:00`,
  );
  const lowWhere = 'active = 1 AND (stock <= 0 OR (min_stock > 0 AND stock <= min_stock))';
  const low = q.all(
    `SELECT id, name, stock, min_stock, unit, pack_unit, pack_size FROM products
      WHERE ${lowWhere} ORDER BY (stock <= 0) DESC, stock ASC LIMIT 8`,
  );
  const recent = q.all(
    `SELECT s.id, s.created_at, s.total, s.paid, s.status, s.mode, c.name AS customer_name, u.name AS user_name
       FROM sales s JOIN users u ON u.id = s.user_id LEFT JOIN customers c ON c.id = s.customer_id
      ORDER BY s.id DESC LIMIT 8`,
  );

  res.json({
    today: {
      count: t.count,
      revenue: round2(t.revenue),
      credit: round2(t.credit),
      discount: round2(t.discount),
      margin: showCost ? round2(t.revenue - t.cost) : null,
      average: t.count ? round2(t.revenue / t.count) : 0,
      expenses: round2(q.val('SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE created_at >= ? AND created_at < ?', from, to)),
    },
    yesterday: { count: y.count, revenue: round2(y.revenue) },
    collected,
    byType,
    series: showCost ? series : series.map((d) => ({ ...d, margin: null })),
    top,
    low,
    lowCount: q.val(`SELECT COUNT(*) FROM products WHERE ${lowWhere}`),
    receivables: receivables(),
    stockValue: showCost
      ? round2(q.val('SELECT COALESCE(SUM(stock * cost_price), 0) FROM products WHERE active = 1 AND stock > 0'))
      : null,
    recent,
  });
});

r.get('/reports/summary', requirePerm('reports.view'), (req, res) => {
  const [from, to] = dayRange(req.query.from, req.query.to);
  const fromDay = from.slice(0, 10);
  const toDay = addDays(to.slice(0, 10), -1);
  const t = q.get(SALES_TOTALS, from, to);
  const range = [from, to];
  const completed = `s.status = 'completed' AND s.created_at >= ? AND s.created_at < ?`;

  const byType = q.all(
    `SELECT i.sale_type, ROUND(SUM(i.total), 2) AS revenue, ROUND(SUM(i.cost_total), 2) AS cost, COUNT(DISTINCT s.id) AS sales
       FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE ${completed} GROUP BY i.sale_type`,
    ...range,
  );
  const salePayments = q.all(
    `SELECT p.method, ROUND(SUM(p.amount), 2) AS amount FROM sale_payments p JOIN sales s ON s.id = p.sale_id
      WHERE ${completed} GROUP BY p.method ORDER BY amount DESC`,
    ...range,
  );
  const customerPayments = q.all(
    `SELECT method, ROUND(SUM(amount), 2) AS amount FROM customer_payments
      WHERE created_at >= ? AND created_at < ? GROUP BY method ORDER BY amount DESC`,
    ...range,
  );
  const expenses = q.all(
    `SELECT category, ROUND(SUM(amount), 2) AS amount, COUNT(*) AS count FROM expenses
      WHERE created_at >= ? AND created_at < ? GROUP BY category ORDER BY amount DESC`,
    ...range,
  );
  const byDay = fillDays(
    q.all(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count, SUM(total) AS revenue, SUM(total - cost_total) AS margin
         FROM sales s WHERE ${completed} GROUP BY day`,
      ...range,
    ),
    fromDay,
    toDay > fromDay ? toDay : fromDay,
  );
  const products = q.all(
    `SELECT i.product_id, i.name, p.unit, p.pack_unit, p.pack_size,
            ROUND(SUM(i.base_qty), 3) AS qty, ROUND(SUM(i.total), 2) AS revenue, ROUND(SUM(i.cost_total), 2) AS cost,
            ROUND(SUM(CASE WHEN i.sale_type = 'wholesale' THEN i.total ELSE 0 END), 2) AS wholesale
       FROM sale_items i JOIN sales s ON s.id = i.sale_id LEFT JOIN products p ON p.id = i.product_id
      WHERE ${completed} GROUP BY i.product_id, i.name ORDER BY revenue DESC LIMIT 200`,
    ...range,
  );
  const categories = q.all(
    `SELECT COALESCE(c.name, 'Sans catégorie') AS name, ROUND(SUM(i.total), 2) AS revenue, ROUND(SUM(i.cost_total), 2) AS cost
       FROM sale_items i JOIN sales s ON s.id = i.sale_id
       LEFT JOIN products p ON p.id = i.product_id LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${completed} GROUP BY c.name ORDER BY revenue DESC`,
    ...range,
  );
  const users = q.all(
    `SELECT u.id, u.name, COUNT(*) AS count, ROUND(SUM(s.total), 2) AS revenue, ROUND(SUM(s.total - s.paid), 2) AS credit
       FROM sales s JOIN users u ON u.id = s.user_id WHERE ${completed} GROUP BY u.id ORDER BY revenue DESC`,
    ...range,
  );
  const cancelled = q.get(
    `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total FROM sales
      WHERE status = 'cancelled' AND created_at >= ? AND created_at < ?`,
    ...range,
  );
  const purchases = q.get(
    'SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total FROM purchases WHERE created_at >= ? AND created_at < ?',
    ...range,
  );
  const expensesTotal = round2(sum(expenses, (e) => e.amount));
  const margin = round2(t.revenue - t.cost);

  res.json({
    from: fromDay,
    to: toDay,
    totals: {
      count: t.count,
      revenue: round2(t.revenue),
      subtotal: round2(t.subtotal),
      discount: round2(t.discount),
      cost: round2(t.cost),
      margin,
      marginRate: t.revenue > 0 ? round2((margin / t.revenue) * 100) : 0,
      credit: round2(t.credit),
      average: t.count ? round2(t.revenue / t.count) : 0,
      expenses: expensesTotal,
      net: round2(margin - expensesTotal),
      customerPayments: round2(sum(customerPayments, (p) => p.amount)),
    },
    byType,
    salePayments,
    customerPayments,
    expenses,
    byDay,
    products,
    categories,
    users,
    cancelled: { count: cancelled.count, total: round2(cancelled.total) },
    purchases: { count: purchases.count, total: round2(purchases.total) },
    receivables: receivables(),
  });
});

/** Clôture de caisse d'une journée (pour un vendeur ou pour tout le magasin). */
r.get('/reports/cash', requirePerm('cash.own', 'cash.all'), (req, res) => {
  const day = isDay(req.query.date) ? req.query.date : todayLocal();
  const [from, to] = dayRange(day);
  let userId = int(req.query.user_id) || null;
  if (!req.perms.has('cash.all')) userId = req.user.id;
  const sf = userId ? ' AND s.user_id = ?' : '';
  const uf = userId ? ' AND user_id = ?' : '';
  const u = userId ? [userId] : [];

  const sales = q.get(
    `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(total - paid), 0) AS credit,
            COALESCE(SUM(discount), 0) AS discount
       FROM sales s WHERE s.status = 'completed' AND s.created_at >= ? AND s.created_at < ?${sf}`,
    from,
    to,
    ...u,
  );
  const cancelled = q.get(
    `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
       FROM sales s WHERE s.status = 'cancelled' AND s.created_at >= ? AND s.created_at < ?${sf}`,
    from,
    to,
    ...u,
  );
  const salePayments = q.all(
    `SELECT p.method, ROUND(SUM(p.amount), 2) AS amount FROM sale_payments p JOIN sales s ON s.id = p.sale_id
      WHERE s.status = 'completed' AND s.created_at >= ? AND s.created_at < ?${sf}
      GROUP BY p.method ORDER BY amount DESC`,
    from,
    to,
    ...u,
  );
  const customerPayments = q.all(
    `SELECT method, ROUND(SUM(amount), 2) AS amount, COUNT(*) AS count FROM customer_payments
      WHERE created_at >= ? AND created_at < ?${uf} GROUP BY method ORDER BY amount DESC`,
    from,
    to,
    ...u,
  );
  const expenses = q.all(
    `SELECT e.category, e.amount, e.method, e.note, e.created_at FROM expenses e
      WHERE e.created_at >= ? AND e.created_at < ?${uf.replace('user_id', 'e.user_id')} ORDER BY e.id`,
    from,
    to,
    ...u,
  );
  const cashOf = (rows) => round2(sum(rows.filter((x) => x.method === CASH), (x) => x.amount));
  const cashSales = cashOf(salePayments);
  const cashPayments = cashOf(customerPayments);
  const cashExpenses = cashOf(expenses);

  res.json({
    date: day,
    user: userId ? q.get('SELECT id, name FROM users WHERE id = ?', userId) : null,
    sales: { count: sales.count, total: round2(sales.total), credit: round2(sales.credit), discount: round2(sales.discount) },
    cancelled: { count: cancelled.count, total: round2(cancelled.total) },
    salePayments,
    customerPayments,
    expenses,
    expensesTotal: round2(sum(expenses, (e) => e.amount)),
    cash: {
      sales: cashSales,
      payments: cashPayments,
      expenses: cashExpenses,
      expected: round2(cashSales + cashPayments - cashExpenses),
    },
  });
});

// ---- Exports CSV ---------------------------------------------------------------
const MODE = { retail: 'Détail', wholesale: 'Gros', mixed: 'Gros + détail' };

r.get('/export/sales.csv', requirePerm('reports.view'), (req, res) => {
  const [from, to] = dayRange(req.query.from, req.query.to);
  const rows = q.all(
    `SELECT s.*, c.name AS customer_name, u.name AS user_name,
            (SELECT GROUP_CONCAT(method || ' ' || REPLACE(REPLACE(printf('%.2f', amount), '.00', ''), '.', ','), ' + ')
               FROM sale_payments p WHERE p.sale_id = s.id) AS methods
       FROM sales s JOIN users u ON u.id = s.user_id LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.created_at >= ? AND s.created_at < ? ORDER BY s.id`,
    from,
    to,
  );
  const cols = [
    ['numero', (s) => s.id],
    ['date', (s) => s.created_at],
    ['client', (s) => s.customer_name || ''],
    ['vendeur', (s) => s.user_name],
    ['type', (s) => MODE[s.mode] || s.mode],
    ['sous_total', (s) => s.subtotal],
    ['remise', (s) => s.discount],
    ['total', (s) => s.total],
    ['paye', (s) => s.paid],
    ['credit', (s) => round2(s.total - s.paid)],
    ['paiements', (s) => s.methods || ''],
    ['statut', (s) => (s.status === 'cancelled' ? 'Annulée' : 'Validée')],
  ];
  if (req.perms.has('cost.view')) cols.push(['marge', (s) => round2(s.total - s.cost_total)]);
  sendCSV(res, `ventes_${from.slice(0, 10)}_${addDays(to.slice(0, 10), -1)}.csv`, toCSV(rows, cols));
});

r.get('/export/sale-items.csv', requirePerm('reports.view'), (req, res) => {
  const [from, to] = dayRange(req.query.from, req.query.to);
  const rows = q.all(
    `SELECT i.*, s.created_at, s.status FROM sale_items i JOIN sales s ON s.id = i.sale_id
      WHERE s.created_at >= ? AND s.created_at < ? AND s.status = 'completed' ORDER BY i.id`,
    from,
    to,
  );
  const cols = [
    ['vente', (i) => i.sale_id],
    ['date', (i) => i.created_at],
    ['produit', (i) => i.name],
    ['type', (i) => (i.sale_type === 'wholesale' ? 'Gros' : 'Détail')],
    ['quantite', (i) => i.qty],
    ['unite', (i) => i.unit_label],
    ['prix_unitaire', (i) => i.unit_price],
    ['total', (i) => i.total],
  ];
  if (req.perms.has('cost.view')) {
    cols.push(['cout', (i) => i.cost_total], ['marge', (i) => round2(i.total - i.cost_total)]);
  }
  sendCSV(res, `lignes_ventes_${from.slice(0, 10)}.csv`, toCSV(rows, cols));
});

export default r;
