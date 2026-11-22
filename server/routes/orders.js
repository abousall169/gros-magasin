// Commandes : le vendeur prépare le panier et l'envoie à la caisse ; le caissier l'encaisse (POST /sales avec order_id).
import { Router } from 'express';
import { q, tx } from '../db.js';
import { requirePerm } from '../auth.js';
import { BALANCE_SQL, listPriceFor, moneyRound, saleTypeOf } from '../services.js';
import { bad, notFound, forbidden, str, num, int, round3, sum, fmtQty, nowLocal } from '../util.js';
import { broadcast } from '../events.js';

const r = Router();

const ORDER_SELECT = `
  SELECT o.*, u.name AS seller_name, c.name AS customer_name, c.phone AS customer_phone, c.type AS customer_type,
         c.credit_limit AS customer_credit_limit, ROUND(${BALANCE_SQL}, 2) AS customer_balance
    FROM orders o JOIN users u ON u.id = o.seller_id LEFT JOIN customers c ON c.id = o.customer_id`;

const withItems = (o) => ({ ...o, items: JSON.parse(o.items) });

/** Commandes en attente : toutes pour la caisse, les siennes pour un vendeur. */
r.get('/orders', requirePerm('orders.cash', 'orders.send'), (req, res) => {
  const mine = !req.perms.has('orders.cash');
  const rows = q.all(
    `${ORDER_SELECT} WHERE o.status = 'pending'${mine ? ' AND o.seller_id = ?' : ''} ORDER BY o.id`,
    ...(mine ? [req.user.id] : []),
  );
  res.json(rows.map(withItems));
});

/** Envoi d'un panier à la caisse. body = { customer_id, items: [{ product_id, sale_type, qty, unit_price? }], note } */
r.post('/orders', requirePerm('orders.send'), (req, res) => {
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) bad('Le panier est vide.');
  if (items.length > 300) bad('Trop de lignes dans le panier (300 maximum).');
  const rm = moneyRound();
  const id = tx(() => {
    let customerId = null;
    if (b.customer_id) {
      customerId = int(b.customer_id);
      if (!q.get('SELECT id FROM customers WHERE id = ?', customerId)) bad('Client introuvable.');
    }
    const lines = items.map((it) => {
      const p = q.get('SELECT * FROM products WHERE id = ?', int(it?.product_id));
      if (!p) bad('Un produit du panier est introuvable. Actualisez la page.');
      if (!p.active) bad(`Le produit « ${p.name} » n'est plus en vente.`);
      const saleType = saleTypeOf(it.sale_type);
      const qty = round3(num(it.qty));
      if (!(qty > 0) || qty > 1e7) bad(`Quantité invalide pour « ${p.name} ».`);
      const listPrice = listPriceFor(p, saleType);
      let unitPrice = null;
      if (it.unit_price !== undefined && it.unit_price !== null && it.unit_price !== '') {
        const up = rm(num(it.unit_price));
        if (!(up >= 0)) bad(`Prix invalide pour « ${p.name} ».`);
        if (Math.abs(up - listPrice) > 0.004) {
          if (up < listPrice && !req.perms.has('price.edit')) {
            bad(`Le prix de « ${p.name} » ne peut pas être inférieur au prix fixé par le gérant (${fmtQty(listPrice)}).`);
          }
          unitPrice = up;
        }
      }
      // Le prix est figé à l'envoi : la caisse encaisse exactement ce que le vendeur a annoncé au client.
      const price = unitPrice ?? listPrice;
      return { product_id: p.id, sale_type: saleType, qty, unit_price: price, total: rm(qty * price) };
    });
    const types = new Set(lines.map((l) => l.sale_type));
    return q.run(
      'INSERT INTO orders (seller_id, customer_id, mode, items, total, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      req.user.id,
      customerId,
      types.size > 1 ? 'mixed' : [...types][0],
      JSON.stringify(lines.map(({ total, ...l }) => l)),
      rm(sum(lines, (l) => l.total)),
      str(b.note, 300),
      nowLocal(),
    ).id;
  });
  broadcast('orders');
  res.json(withItems(q.get(`${ORDER_SELECT} WHERE o.id = ?`, id)));
});

/** Annulation d'une commande pas encore encaissée (le vendeur la reprend, ou le client est parti).
 *  Le caissier ne peut pas l'annuler : seul le vendeur qui l'a envoyée, ou un gérant. */
r.post('/orders/:id/cancel', requirePerm('orders.send', 'sales.cancel'), (req, res) => {
  const id = int(req.params.id);
  tx(() => {
    const o = q.get('SELECT * FROM orders WHERE id = ?', id);
    if (!o) notFound('Commande introuvable.');
    if (!req.perms.has('sales.cancel') && o.seller_id !== req.user.id) forbidden();
    if (o.status !== 'pending') bad('Cette commande a déjà été encaissée ou annulée.');
    q.run("UPDATE orders SET status = 'cancelled', closed_at = ?, closed_by = ? WHERE id = ?", nowLocal(), req.user.id, id);
  });
  broadcast('orders');
  res.json({ ok: true });
});

export default r;
