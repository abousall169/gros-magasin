// Logique métier : ventes en gros / au détail, stock, crédits clients, approvisionnements.
import { q, tx } from './db.js';
import { getSettings, CASH } from './settings.js';
import { bad, notFound, nowLocal, num, int, str, round2, round3, round4, sum, fmtQty, plural } from './util.js';

// ---------------------------------------------------------------------------
// Produits
// ---------------------------------------------------------------------------

/** Le produit se vend-il par colis (carton, sac, paquet...) ? */
export const hasPack = (p) => !!p.pack_unit && Number(p.pack_size) > 1;

/** Nombre d'unités de base dans une unité vendue selon le type de vente. */
export const unitsPerFor = (p, saleType) => (saleType === 'wholesale' && hasPack(p) ? Number(p.pack_size) : 1);

export const unitLabelFor = (p, saleType) => (saleType === 'wholesale' && hasPack(p) ? p.pack_unit : p.unit);

/**
 * Prix catalogue d'une unité vendue.
 *  - Détail : prix de détail par unité de base.
 *  - Gros : prix de gros par colis (ou par unité si le produit n'a pas de colis).
 *    Sans prix de gros défini, on retombe sur le prix de détail.
 */
export function listPriceFor(p, saleType) {
  if (saleType === 'wholesale' && Number(p.wholesale_price) > 0) return Number(p.wholesale_price);
  return round2(Number(p.retail_price) * unitsPerFor(p, saleType));
}

export const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name
    FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

/** Retire les informations sensibles (prix d'achat) si l'utilisateur ne peut pas les voir. */
export function publicProduct(p, perms) {
  if (!p) return p;
  const out = { ...p };
  if (!perms.has('cost.view')) delete out.cost_price;
  return out;
}

export function recordMovement({ productId, type, qty, refId = null, reason = null, userId = null, at }) {
  q.run(
    'UPDATE products SET stock = ROUND(stock + ?, 3), updated_at = ? WHERE id = ?',
    qty,
    at,
    productId,
  );
  const after = q.val('SELECT stock FROM products WHERE id = ?', productId);
  q.run(
    `INSERT INTO stock_movements (product_id, type, qty, stock_after, ref_id, reason, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    productId,
    type,
    round3(qty),
    after,
    refId,
    reason,
    userId,
    at,
  );
  return after;
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

/** Expression SQL du solde dû par le client (alias de table : c). */
export const BALANCE_SQL = `(
  c.opening_balance
  + COALESCE((SELECT SUM(s.total - s.paid) FROM sales s WHERE s.customer_id = c.id AND s.status = 'completed'), 0)
  - COALESCE((SELECT SUM(cp.amount) FROM customer_payments cp WHERE cp.customer_id = c.id), 0)
)`;

export function customerBalance(customerId) {
  return round2(q.val(`SELECT ${BALANCE_SQL} FROM customers c WHERE c.id = ?`, customerId) || 0);
}

// ---------------------------------------------------------------------------
// Ventes
// ---------------------------------------------------------------------------

/**
 * Enregistre une vente (transaction : contrôle des stocks, prix, paiements, crédit).
 * body = { customer_id, items: [{ product_id, sale_type, qty, unit_price? }], discount, payments: [{ method, amount }], note }
 */
/** Arrondi monétaire selon la devise (FCFA : pas de centimes). */
export function moneyRound() {
  return Number(getSettings().currency_decimals) === 2 ? round2 : (n) => Math.round(Number(n) + Number.EPSILON);
}

export function createSale(user, perms, body, { at } = {}) {
  const settings = getSettings();
  const rm = moneyRound();
  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) bad('Le panier est vide.');
  if (items.length > 300) bad('Trop de lignes dans le panier (300 maximum).');

  return tx(() => {
    const now = at || nowLocal();
    let customer = null;
    if (body.customer_id) {
      customer = q.get('SELECT * FROM customers WHERE id = ?', int(body.customer_id));
      if (!customer) bad('Client introuvable.');
    }

    // --- Lignes ---
    const lines = [];
    const need = new Map();
    for (const it of items) {
      const p = q.get('SELECT * FROM products WHERE id = ?', int(it?.product_id));
      if (!p) bad('Un produit du panier est introuvable. Actualisez la page.');
      if (!p.active) bad(`Le produit « ${p.name} » n'est plus en vente.`);
      const saleType = it.sale_type === 'wholesale' ? 'wholesale' : 'retail';
      const qty = round3(num(it.qty));
      if (!(qty > 0) || qty > 1e7) bad(`Quantité invalide pour « ${p.name} ».`);
      const unitsPer = unitsPerFor(p, saleType);
      const listPrice = listPriceFor(p, saleType);
      let unitPrice = listPrice;
      if (it.unit_price !== undefined && it.unit_price !== null && it.unit_price !== '') {
        const up = rm(num(it.unit_price));
        if (!(up >= 0)) bad(`Prix invalide pour « ${p.name} ».`);
        if (Math.abs(up - listPrice) > 0.004) {
          if (!perms.has('price.edit')) bad("Vous n'êtes pas autorisé à modifier les prix.");
          unitPrice = up;
        }
      }
      const baseQty = round3(qty * unitsPer);
      lines.push({
        p,
        saleType,
        qty,
        unitsPer,
        unitLabel: unitLabelFor(p, saleType),
        listPrice,
        unitPrice,
        baseQty,
        total: rm(qty * unitPrice),
        unitCost: Number(p.cost_price) || 0,
        costTotal: round2(baseQty * (Number(p.cost_price) || 0)),
      });
      need.set(p.id, round3((need.get(p.id) || 0) + baseQty));
    }

    if (!settings.allow_negative_stock) {
      for (const [pid, qtyNeeded] of need) {
        const p = lines.find((l) => l.p.id === pid).p;
        if (p.stock + 1e-9 < qtyNeeded) {
          const left = Math.max(0, p.stock);
          bad(`Stock insuffisant pour « ${p.name} » : il reste ${fmtQty(left)} ${plural(p.unit, left)}.`);
        }
      }
    }

    // --- Totaux ---
    const subtotal = rm(sum(lines, (l) => l.total));
    const discount = rm(num(body.discount, 0));
    if (!(discount >= 0) || discount > subtotal) bad('Remise invalide.');
    if (discount > 0 && !perms.has('price.edit')) bad("Vous n'êtes pas autorisé à accorder des remises.");
    const total = round2(subtotal - discount);

    // --- Paiements ---
    const pays = (Array.isArray(body.payments) ? body.payments : [])
      .map((x) => ({ method: str(x?.method, 40), amount: rm(num(x?.amount, 0)) }))
      .filter((x) => x.method && x.amount > 0);
    if (pays.some((x) => !Number.isFinite(x.amount))) bad('Montant de paiement invalide.');
    const cashGiven = round2(sum(pays.filter((x) => x.method === CASH), (x) => x.amount));
    const nonCash = round2(sum(pays.filter((x) => x.method !== CASH), (x) => x.amount));
    if (nonCash > total + 0.004) {
      bad('Les paiements par Mobile Money / carte / virement dépassent le total à payer.');
    }
    const cashApplied = round2(Math.max(0, Math.min(cashGiven, total - nonCash)));
    const change = round2(cashGiven - cashApplied);
    const paid = round2(nonCash + cashApplied);
    const credit = round2(total - paid);

    if (credit > 0.004) {
      if (!customer) bad('Il reste un montant à payer : choisissez un client pour enregistrer le crédit.');
      if (!perms.has('credit.sell')) bad("Vous n'êtes pas autorisé à vendre à crédit.");
      if (Number(customer.credit_limit) > 0) {
        const balance = customerBalance(customer.id);
        if (balance + credit > Number(customer.credit_limit) + 0.004) {
          bad(
            `Plafond de crédit dépassé pour ${customer.name} : plafond ${fmtQty(customer.credit_limit)}, ` +
              `déjà dû ${fmtQty(balance)}, nouveau crédit ${fmtQty(credit)}.`,
          );
        }
      }
    }

    const types = new Set(lines.map((l) => l.saleType));
    const mode = types.size > 1 ? 'mixed' : [...types][0];

    const sale = q.run(
      `INSERT INTO sales (user_id, customer_id, mode, subtotal, discount, total, paid, received, change_given, cost_total, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      user.id,
      customer?.id ?? null,
      mode,
      subtotal,
      discount,
      total,
      paid,
      round2(cashGiven + nonCash),
      change,
      round2(sum(lines, (l) => l.costTotal)),
      str(body.note, 300),
      now,
    );
    const saleId = sale.id;

    for (const l of lines) {
      q.run(
        `INSERT INTO sale_items (sale_id, product_id, name, sale_type, unit_label, qty, units_per, base_qty, unit_price, list_price, total, unit_cost, cost_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        saleId,
        l.p.id,
        l.p.name,
        l.saleType,
        l.unitLabel,
        l.qty,
        l.unitsPer,
        l.baseQty,
        l.unitPrice,
        l.listPrice,
        l.total,
        l.unitCost,
        l.costTotal,
      );
      recordMovement({ productId: l.p.id, type: 'sale', qty: -l.baseQty, refId: saleId, userId: user.id, at: now });
    }

    for (const pm of pays.filter((x) => x.method !== CASH)) {
      q.run('INSERT INTO sale_payments (sale_id, method, amount) VALUES (?, ?, ?)', saleId, pm.method, pm.amount);
    }
    if (cashApplied > 0) {
      q.run('INSERT INTO sale_payments (sale_id, method, amount) VALUES (?, ?, ?)', saleId, CASH, cashApplied);
    }
    return saleId;
  });
}

export function getSale(id, perms) {
  const sale = q.get(
    `SELECT s.*, u.name AS user_name, c.name AS customer_name, c.phone AS customer_phone,
            c.address AS customer_address, cu.name AS cancelled_by_name
       FROM sales s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN users cu ON cu.id = s.cancelled_by
      WHERE s.id = ?`,
    id,
  );
  if (!sale) return null;
  sale.items = q.all('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id', id);
  sale.payments = q.all('SELECT method, amount FROM sale_payments WHERE sale_id = ? ORDER BY id', id);
  sale.credit = round2(sale.total - sale.paid);
  if (sale.customer_id) sale.customer_balance = customerBalance(sale.customer_id);
  if (!perms.has('cost.view')) {
    delete sale.cost_total;
    for (const it of sale.items) {
      delete it.unit_cost;
      delete it.cost_total;
    }
  }
  return sale;
}

export function cancelSale(user, saleId, reason) {
  return tx(() => {
    const sale = q.get('SELECT * FROM sales WHERE id = ?', saleId);
    if (!sale) notFound('Vente introuvable.');
    if (sale.status === 'cancelled') bad('Cette vente est déjà annulée.');
    const now = nowLocal();
    q.run(
      `UPDATE sales SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?`,
      now,
      user.id,
      str(reason, 300),
      saleId,
    );
    for (const it of q.all('SELECT * FROM sale_items WHERE sale_id = ?', saleId)) {
      if (!it.product_id) continue;
      recordMovement({
        productId: it.product_id,
        type: 'cancel',
        qty: it.base_qty,
        refId: saleId,
        reason: `Annulation vente n° ${saleId}`,
        userId: user.id,
        at: now,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Approvisionnements (entrées de stock) et ajustements
// ---------------------------------------------------------------------------

/** body = { supplier_id, reference, note, update_cost, items: [{ product_id, unit_type: 'unit'|'pack', qty, unit_cost }] } */
export function createPurchase(user, body, { at } = {}) {
  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) bad('Ajoutez au moins un produit.');
  const updateCost = body.update_cost !== false;
  return tx(() => {
    const now = at || nowLocal();
    let supplierId = null;
    if (body.supplier_id) {
      supplierId = int(body.supplier_id);
      if (!q.get('SELECT id FROM suppliers WHERE id = ?', supplierId)) bad('Fournisseur introuvable.');
    }
    const lines = items.map((it) => {
      const p = q.get('SELECT * FROM products WHERE id = ?', int(it?.product_id));
      if (!p) bad('Produit introuvable.');
      const unitType = it.unit_type === 'pack' && hasPack(p) ? 'pack' : 'unit';
      const unitsPer = unitType === 'pack' ? Number(p.pack_size) : 1;
      const qty = round3(num(it.qty));
      if (!(qty > 0)) bad(`Quantité invalide pour « ${p.name} ».`);
      const unitCost = round2(num(it.unit_cost, 0));
      if (!(unitCost >= 0)) bad(`Prix d'achat invalide pour « ${p.name} ».`);
      return {
        p,
        unitType,
        unitsPer,
        unitLabel: unitType === 'pack' ? p.pack_unit : p.unit,
        qty,
        baseQty: round3(qty * unitsPer),
        unitCost,
        total: round2(qty * unitCost),
      };
    });
    const total = round2(sum(lines, (l) => l.total));
    const purchase = q.run(
      'INSERT INTO purchases (supplier_id, user_id, reference, total, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      supplierId,
      user.id,
      str(body.reference, 80),
      total,
      str(body.note, 300),
      now,
    );
    for (const l of lines) {
      q.run(
        `INSERT INTO purchase_items (purchase_id, product_id, name, unit_type, unit_label, qty, units_per, base_qty, unit_cost, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        purchase.id,
        l.p.id,
        l.p.name,
        l.unitType,
        l.unitLabel,
        l.qty,
        l.unitsPer,
        l.baseQty,
        l.unitCost,
        l.total,
      );
      recordMovement({
        productId: l.p.id,
        type: 'purchase',
        qty: l.baseQty,
        refId: purchase.id,
        userId: user.id,
        at: now,
      });
      if (updateCost && l.unitCost > 0) {
        q.run('UPDATE products SET cost_price = ? WHERE id = ?', round4(l.unitCost / l.unitsPer), l.p.id);
      }
    }
    return purchase.id;
  });
}

export const ADJUST_REASONS = ['Inventaire', 'Perte / casse', 'Produit périmé', 'Usage interne', 'Retour fournisseur', 'Correction', 'Autre'];

/** body = { product_id, mode: 'set'|'add'|'remove', qty (unités de base), reason, note } */
export function adjustStock(user, body) {
  return tx(() => {
    const p = q.get('SELECT * FROM products WHERE id = ?', int(body?.product_id));
    if (!p) notFound('Produit introuvable.');
    const qty = round3(num(body.qty));
    if (!Number.isFinite(qty) || qty < 0) bad('Quantité invalide.');
    let delta;
    if (body.mode === 'set') delta = round3(qty - p.stock);
    else if (body.mode === 'remove') delta = -qty;
    else delta = qty;
    if (delta === 0) bad('Aucun changement de stock.');
    const reason = [str(body.reason, 60) || 'Ajustement', str(body.note, 200)].filter(Boolean).join(' — ');
    return recordMovement({ productId: p.id, type: 'adjust', qty: delta, reason, userId: user.id, at: nowLocal() });
  });
}
