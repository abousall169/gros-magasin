// Logique métier : ventes en gros / au détail, stock et lots, crédits clients, retours, approvisionnements.
import { q, tx } from './db.js';
import { getSettings, paymentMethods, CASH, ACCOUNT_REFUND } from './settings.js';
import { bad, notFound, nowLocal, num, int, str, round2, round3, round4, sum, fmtQty, plural, isDay } from './util.js';

// ---------------------------------------------------------------------------
// Produits
// ---------------------------------------------------------------------------

/** Le produit se vend-il par colis (carton, sac, paquet...) ? */
export const hasPack = (p) => !!p.pack_unit && Number(p.pack_size) > 1;

/** Demi-gros par unité intermédiaire (paquet, demi-carton…) ? Sinon le demi-gros est un prix par unité de base. */
export const hasSemiPack = (p) => !!p.semi_unit && Number(p.semi_size) > 1;

/** Types de vente : détail, demi-gros, gros. Toute autre valeur est lue comme du détail. */
export const saleTypeOf = (v) => (v === 'wholesale' || v === 'semi' ? v : 'retail');

/** Nombre d'unités de base dans une unité vendue selon le type de vente. */
export const unitsPerFor = (p, saleType) =>
  saleType === 'wholesale' && hasPack(p) ? Number(p.pack_size) : saleType === 'semi' && hasSemiPack(p) ? Number(p.semi_size) : 1;

export const unitLabelFor = (p, saleType) =>
  saleType === 'wholesale' && hasPack(p) ? p.pack_unit : saleType === 'semi' && hasSemiPack(p) ? p.semi_unit : p.unit;

/**
 * Prix catalogue d'une unité vendue.
 *  - Détail : prix de détail par unité de base.
 *  - Demi-gros : prix demi-gros par unité intermédiaire (ou par unité de base sans unité intermédiaire).
 *  - Gros : prix de gros par colis (ou par unité si le produit n'a pas de colis).
 *    Sans prix demi-gros ou de gros défini, on retombe sur le prix de détail.
 */
export function listPriceFor(p, saleType) {
  if (saleType === 'wholesale' && Number(p.wholesale_price) > 0) return Number(p.wholesale_price);
  if (saleType === 'semi' && Number(p.semi_price) > 0) return Number(p.semi_price);
  return round2(Number(p.retail_price) * unitsPerFor(p, saleType));
}

export const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name,
         (SELECT COUNT(*) FROM product_images i WHERE i.product_id = p.id) AS image_count
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
// Lots (péremption) — quantités en unités de base
// ---------------------------------------------------------------------------

/** La date affichée sur le produit suit le lot qui périme le plus tôt. */
export function syncExpiry(productId) {
  q.run(
    `UPDATE products SET expiry_date = (
        SELECT MIN(expiry_date) FROM stock_lots
         WHERE product_id = ? AND qty > 0 AND expiry_date IS NOT NULL AND expiry_date <> '')
      WHERE id = ?`,
    productId,
    productId,
  );
}

export function addLot(productId, { qty, expiry = null, code = null, source = null, at = nowLocal() }) {
  if (!(qty > 0)) return;
  q.run(
    'INSERT INTO stock_lots (product_id, code, expiry_date, qty, source, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    productId,
    str(code, 60),
    isDay(expiry) ? expiry : null,
    round3(qty),
    source,
    at,
  );
  syncExpiry(productId);
}

/** Retire qty des lots, péremption la plus proche d'abord. Renvoie la répartition pour pouvoir la restituer. */
export function consumeLots(productId, qty) {
  const lots = q.all(
    `SELECT id, qty FROM stock_lots WHERE product_id = ? AND qty > 0
      ORDER BY (expiry_date IS NULL OR expiry_date = ''), expiry_date, id`,
    productId,
  );
  const used = [];
  let left = round3(qty);
  for (const lot of lots) {
    if (left <= 0) break;
    const take = round3(Math.min(lot.qty, left));
    q.run('UPDATE stock_lots SET qty = ROUND(qty - ?, 3) WHERE id = ?', take, lot.id);
    used.push({ lot: lot.id, qty: take });
    left = round3(left - take);
  }
  if (used.length) syncExpiry(productId);
  return used;
}

/** Remet baseQty dans les lots d'où venait une ligne de vente (retour ou annulation). */
export function restoreLots(saleItem, baseQty) {
  let alloc;
  try {
    alloc = JSON.parse(saleItem.lots || '[]');
  } catch {
    alloc = [];
  }
  if (!alloc.length || !saleItem.product_id) return;
  let left = round3(baseQty);
  for (let i = alloc.length - 1; i >= 0 && left > 0; i--) {
    const give = round3(Math.min(alloc[i].qty, left));
    q.run('UPDATE stock_lots SET qty = ROUND(qty + ?, 3) WHERE id = ?', give, alloc[i].lot);
    alloc[i].qty = round3(alloc[i].qty - give);
    left = round3(left - give);
  }
  q.run('UPDATE sale_items SET lots = ? WHERE id = ?', JSON.stringify(alloc.filter((a) => a.qty > 0)), saleItem.id);
  syncExpiry(saleItem.product_id);
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

/** Expression SQL du solde dû par le client (alias de table : c). */
export const BALANCE_SQL = `(
  c.opening_balance
  + COALESCE((SELECT SUM(s.total - s.paid) FROM sales s WHERE s.customer_id = c.id AND s.status = 'completed'), 0)
  - COALESCE((SELECT SUM(cp.amount) FROM customer_payments cp WHERE cp.customer_id = c.id), 0)
  - COALESCE((SELECT SUM(r.amount) FROM refunds r JOIN sales rs ON rs.id = r.sale_id
               WHERE rs.customer_id = c.id AND rs.status = 'completed' AND r.method = '${ACCOUNT_REFUND}'), 0)
)`;

export function customerBalance(customerId) {
  return round2(q.val(`SELECT ${BALANCE_SQL} FROM customers c WHERE c.id = ?`, customerId) || 0);
}

// ---------------------------------------------------------------------------
// Ventes
// ---------------------------------------------------------------------------

/** Arrondi monétaire selon la devise (FCFA : pas de centimes). */
export function moneyRound() {
  return Number(getSettings().currency_decimals) === 2 ? round2 : (n) => Math.round(Number(n) + Number.EPSILON);
}

const MAX_OFFLINE_AGE = 60 * 86400_000;

/** Date d'une vente faite hors ligne (horloge de l'appareil). null si l'horloge est manifestement fausse. */
function offlineDate(value) {
  const d = new Date(value);
  const ms = d.getTime();
  if (!value || Number.isNaN(ms)) return null;
  const now = Date.now();
  if (ms > now + 5 * 60_000 || ms < now - MAX_OFFLINE_AGE) return null;
  return nowLocal(d);
}

/**
 * Enregistre une vente (transaction : contrôle des stocks, prix, paiements, crédit).
 * body = { client_id, offline, sold_at, customer_id, order_id, items: [{ product_id, sale_type, qty, unit_price? }],
 *          discount, payments: [{ method, amount, reference }], note }
 * order_id : commande préparée par un vendeur ; elle passe à « encaissée » et le vendeur est noté sur la vente.
 *
 * Une vente faite hors ligne a déjà eu lieu au comptoir : elle n'est pas refusée pour une règle
 * de gestion (stock, prix, remise, crédit) mais marquée « à vérifier » pour le gérant.
 * Renvoie { id, duplicate, cash } (duplicate : vente déjà reçue, envoyée deux fois).
 */
export function createSale(user, perms, input, { at } = {}) {
  let body = input || {};
  // Caissier : il encaisse uniquement une vente envoyée par un vendeur, exactement telle qu'elle a été envoyée
  // (articles, prix, client) ; il ne peut ni vendre lui-même ni modifier la vente.
  const orderOnly = !perms.has('sales.create');
  if (orderOnly) {
    if (!body.order_id) bad("Vous ne pouvez qu'encaisser les ventes envoyées par les vendeurs.");
    const sent = q.get('SELECT * FROM orders WHERE id = ?', int(body.order_id));
    if (!sent) bad('Vente à encaisser introuvable.');
    body = { ...body, items: JSON.parse(sent.items), customer_id: sent.customer_id, discount: 0, note: sent.note };
  }
  const settings = getSettings();
  const rm = moneyRound();
  const offline = !!body?.offline;
  const clientId = str(body?.client_id, 64);
  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) bad('Le panier est vide.');
  if (items.length > 300) bad('Trop de lignes dans le panier (300 maximum).');

  return tx(() => {
    if (clientId) {
      const dup = q.get('SELECT id FROM sales WHERE client_id = ?', clientId);
      if (dup) return { id: dup.id, duplicate: true, cash: false };
    }
    const review = new Set();
    const flag = (reason, message) => {
      if (!offline) bad(message);
      review.add(reason);
    };

    let now = at || nowLocal();
    if (offline && body.sold_at) {
      const d = offlineDate(body.sold_at);
      if (d) now = d;
      else review.add('date');
    }

    let customer = null;
    if (body.customer_id) {
      customer = q.get('SELECT * FROM customers WHERE id = ?', int(body.customer_id));
      if (!customer) bad('Client introuvable.');
    }

    // Commande préparée par un vendeur et encaissée ici
    let order = null;
    if (body.order_id) {
      if (!perms.has('orders.cash')) bad("Vous n'êtes pas autorisé à encaisser les commandes des vendeurs.");
      order = q.get('SELECT * FROM orders WHERE id = ?', int(body.order_id));
      if (!order) bad('Commande introuvable.');
      if (order.status !== 'pending') flag('order', `La commande n° ${order.id} a déjà été encaissée ou annulée.`);
    }

    // --- Lignes ---
    const lines = [];
    const need = new Map();
    for (const it of items) {
      const p = q.get('SELECT * FROM products WHERE id = ?', int(it?.product_id));
      if (!p) bad('Un produit du panier est introuvable. Actualisez la page.');
      if (!p.active && !offline) bad(`Le produit « ${p.name} » n'est plus en vente.`);
      const saleType = saleTypeOf(it.sale_type);
      const qty = round3(num(it.qty));
      if (!(qty > 0) || qty > 1e7) bad(`Quantité invalide pour « ${p.name} ».`);
      const unitsPer = unitsPerFor(p, saleType);
      const listPrice = listPriceFor(p, saleType);
      let unitPrice = listPrice;
      if (it.unit_price !== undefined && it.unit_price !== null && it.unit_price !== '') {
        const up = rm(num(it.unit_price));
        if (!(up >= 0)) bad(`Prix invalide pour « ${p.name} ».`);
        if (Math.abs(up - listPrice) > 0.004) {
          // Tout vendeur peut vendre plus cher que le prix fixé par le gérant ; seul le gérant peut vendre moins cher.
          // Une vente envoyée par un vendeur a été contrôlée à l'envoi (le prix du gérant a pu changer depuis).
          if (up < listPrice && !perms.has('price.edit') && !orderOnly) {
            flag('price', `Le prix de « ${p.name} » ne peut pas être inférieur au prix fixé par le gérant (${fmtQty(listPrice)}).`);
          }
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
        taxRate: settings.tax_enabled ? Number(p.tax_rate ?? settings.tax_rate) || 0 : 0,
      });
      need.set(p.id, round3((need.get(p.id) || 0) + baseQty));
    }

    if (!settings.allow_negative_stock) {
      for (const [pid, qtyNeeded] of need) {
        const p = lines.find((l) => l.p.id === pid).p;
        if (p.stock + 1e-9 < qtyNeeded) {
          const left = Math.max(0, p.stock);
          flag('stock', `Stock insuffisant pour « ${p.name} » : il reste ${fmtQty(left)} ${plural(p.unit, left)}.`);
        }
      }
    }

    // --- Totaux ---
    const subtotal = rm(sum(lines, (l) => l.total));
    const discount = rm(num(body.discount, 0));
    if (!(discount >= 0) || discount > subtotal) bad('Remise invalide.');
    if (discount > 0 && !perms.has('price.edit')) flag('discount', "Vous n'êtes pas autorisé à accorder des remises.");
    const total = round2(subtotal - discount);

    // --- Paiements ---
    const pays = (Array.isArray(body.payments) ? body.payments : [])
      .map((x) => ({ method: str(x?.method, 40), amount: rm(num(x?.amount, 0)), reference: str(x?.reference, 60) }))
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
      if (!perms.has('credit.sell')) flag('credit', "Vous n'êtes pas autorisé à vendre à crédit.");
      if (Number(customer.credit_limit) > 0) {
        const balance = customerBalance(customer.id);
        if (balance + credit > Number(customer.credit_limit) + 0.004) {
          flag(
            'credit',
            `Plafond de crédit dépassé pour ${customer.name} : plafond ${fmtQty(customer.credit_limit)}, ` +
              `déjà dû ${fmtQty(balance)}, nouveau crédit ${fmtQty(credit)}.`,
          );
        }
      }
    }

    // --- TVA (comprise dans les prix ; la remise du ticket est répartie sur les lignes) ---
    const netRatio = subtotal > 0 ? total / subtotal : 0;
    for (const l of lines) {
      const net = l.total * netRatio;
      l.tax = l.taxRate > 0 ? round2(net - net / (1 + l.taxRate / 100)) : 0;
    }
    const taxTotal = round2(sum(lines, (l) => l.tax));

    const types = new Set(lines.map((l) => l.saleType));
    const mode = types.size > 1 ? 'mixed' : [...types][0];

    const sale = q.run(
      `INSERT INTO sales (user_id, customer_id, mode, subtotal, discount, total, paid, received, change_given, cost_total, note,
                          created_at, client_id, offline, needs_review, synced_at, tax_total, seller_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      clientId,
      offline ? 1 : 0,
      review.size ? [...review].join(',') : null,
      offline ? nowLocal() : null,
      taxTotal,
      order?.seller_id ?? null,
    );
    const saleId = sale.id;
    if (order?.status === 'pending') {
      q.run(
        "UPDATE orders SET status = 'paid', sale_id = ?, closed_at = ?, closed_by = ? WHERE id = ?",
        saleId,
        nowLocal(),
        user.id,
        order.id,
      );
    }

    for (const l of lines) {
      const lots = consumeLots(l.p.id, l.baseQty);
      q.run(
        `INSERT INTO sale_items (sale_id, product_id, name, sale_type, unit_label, qty, units_per, base_qty, unit_price, list_price, total,
                                 unit_cost, cost_total, tax_rate, tax_amount, lots)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        l.taxRate,
        l.tax,
        JSON.stringify(lots),
      );
      recordMovement({ productId: l.p.id, type: 'sale', qty: -l.baseQty, refId: saleId, userId: user.id, at: now });
    }

    for (const pm of pays.filter((x) => x.method !== CASH)) {
      q.run('INSERT INTO sale_payments (sale_id, method, amount, reference) VALUES (?, ?, ?, ?)', saleId, pm.method, pm.amount, pm.reference);
    }
    if (cashApplied > 0) {
      q.run('INSERT INTO sale_payments (sale_id, method, amount) VALUES (?, ?, ?)', saleId, CASH, cashApplied);
    }
    return { id: saleId, duplicate: false, cash: cashApplied > 0 };
  });
}

export function getSale(id, perms) {
  const sale = q.get(
    `SELECT s.*, u.name AS user_name, sv.name AS seller_name, c.name AS customer_name, c.phone AS customer_phone,
            c.address AS customer_address, cu.name AS cancelled_by_name,
            (SELECT o.id FROM orders o WHERE o.sale_id = s.id) AS order_id
       FROM sales s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN users sv ON sv.id = s.seller_id
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN users cu ON cu.id = s.cancelled_by
      WHERE s.id = ?`,
    id,
  );
  if (!sale) return null;
  sale.items = q.all(
    `SELECT i.*, p.name_ar FROM sale_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.sale_id = ? ORDER BY i.id`,
    id,
  );
  sale.payments = q.all('SELECT method, amount, reference FROM sale_payments WHERE sale_id = ? ORDER BY id', id);
  sale.refunds = q.all(
    `SELECT r.*, u.name AS user_name FROM refunds r JOIN users u ON u.id = r.user_id WHERE r.sale_id = ? ORDER BY r.id`,
    id,
  );
  sale.refunded_total = round2(sum(sale.refunds, (r) => r.amount));
  sale.credit = round2(sale.total - sale.paid);
  if (sale.customer_id) sale.customer_balance = customerBalance(sale.customer_id);
  if (!perms.has('cost.view')) {
    delete sale.cost_total;
    for (const it of sale.items) {
      delete it.unit_cost;
      delete it.cost_total;
    }
  }
  for (const it of sale.items) delete it.lots;
  return sale;
}

export function cancelSale(user, saleId, reason) {
  return tx(() => {
    const sale = q.get('SELECT * FROM sales WHERE id = ?', saleId);
    if (!sale) notFound('Vente introuvable.');
    if (sale.status === 'cancelled') bad('Cette vente est déjà annulée.');
    const now = nowLocal();
    q.run(
      `UPDATE sales SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, needs_review = NULL WHERE id = ?`,
      now,
      user.id,
      str(reason, 300),
      saleId,
    );
    for (const it of q.all('SELECT * FROM sale_items WHERE sale_id = ?', saleId)) {
      if (!it.product_id) continue;
      // Les articles déjà retournés ont été traités lors du retour
      const back = round3((it.qty - it.returned_qty) * it.units_per);
      if (back <= 0) continue;
      restoreLots(it, back);
      recordMovement({
        productId: it.product_id,
        type: 'cancel',
        qty: back,
        refId: saleId,
        reason: `Annulation vente n° ${saleId}`,
        userId: user.id,
        at: now,
      });
    }
  });
}

/**
 * Retour d'une partie des articles d'une vente.
 * body = { items: [{ sale_item_id, qty }], method, restock, reason }
 * method : un moyen de paiement, ou « Compte client » (déduit de la dette du client).
 */
export function refundSale(user, saleId, body) {
  const reason = str(body?.reason, 300);
  if (!reason) bad('Indiquez le motif du retour.');
  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) bad('Indiquez les articles retournés.');
  const method = str(body?.method, 40);
  const restock = body?.restock !== false;
  const rm = moneyRound();
  return tx(() => {
    const s = q.get('SELECT * FROM sales WHERE id = ?', saleId);
    if (!s) notFound('Vente introuvable.');
    if (s.status === 'cancelled') bad('Cette vente est annulée.');
    if (method === ACCOUNT_REFUND) {
      if (!s.customer_id) bad('Cette vente n’a pas de client : remboursez par un moyen de paiement.');
    } else if (!paymentMethods().includes(method)) bad('Moyen de remboursement inconnu.');

    const netRatio = s.subtotal > 0 ? s.total / s.subtotal : 0;
    const rows = [];
    for (const r of items) {
      const it = q.get('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?', int(r?.sale_item_id), saleId);
      if (!it) notFound('Article introuvable dans cette vente.');
      const qty = round3(num(r.qty));
      const left = round3(it.qty - it.returned_qty);
      if (!(qty > 0) || qty > left + 1e-9) bad(`Quantité retournée invalide pour « ${it.name} » (maximum ${fmtQty(left)}).`);
      // Dernier retour de la ligne : on rend exactement ce qui reste, sans écart d'arrondi
      const done = q.get(
        'SELECT COALESCE(SUM(amount), 0) AS a, COALESCE(SUM(tax_amount), 0) AS t FROM refund_items WHERE sale_item_id = ?',
        it.id,
      );
      const lineNet = rm(it.total * netRatio);
      const all = Math.abs(qty - left) < 1e-9;
      const amount = all ? round2(lineNet - done.a) : rm((lineNet * qty) / it.qty);
      const tax = all ? round2(it.tax_amount - done.t) : round2((it.tax_amount * qty) / it.qty);
      const baseQty = round3(qty * it.units_per);
      rows.push({ it, qty, baseQty, amount, tax, cost: restock ? round2(baseQty * it.unit_cost) : 0 });
    }
    if (!rows.length) bad('Indiquez les articles retournés.');
    const total = round2(sum(rows, (r) => r.amount));
    const now = nowLocal();
    const refund = q.run(
      'INSERT INTO refunds (sale_id, user_id, amount, method, restock, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      saleId,
      user.id,
      total,
      method,
      restock ? 1 : 0,
      reason,
      now,
    );
    for (const r of rows) {
      q.run(
        `INSERT INTO refund_items (refund_id, sale_item_id, qty, base_qty, amount, tax_amount, cost_total)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        refund.id,
        r.it.id,
        r.qty,
        r.baseQty,
        r.amount,
        r.tax,
        r.cost,
      );
      q.run('UPDATE sale_items SET returned_qty = ROUND(returned_qty + ?, 3) WHERE id = ?', r.qty, r.it.id);
      if (restock && r.it.product_id) {
        restoreLots(r.it, r.baseQty);
        recordMovement({
          productId: r.it.product_id,
          type: 'refund',
          qty: r.baseQty,
          refId: saleId,
          reason: `Retour vente n° ${saleId} — ${reason}`,
          userId: user.id,
          at: now,
        });
      }
    }
    return refund.id;
  });
}

// ---------------------------------------------------------------------------
// Approvisionnements (commandes, réceptions, paiements fournisseurs) et ajustements
// ---------------------------------------------------------------------------

/** Montant déjà payé sur un achat (alias de table : x). */
export const PURCHASE_PAID_SQL = 'COALESCE((SELECT SUM(pp.amount) FROM purchase_payments pp WHERE pp.purchase_id = x.id), 0)';

/** Entrée en stock d'un achat commandé : quantités, lots et prix d'achat. */
function receiveItems(purchase, user, { at, updateCost }) {
  for (const it of q.all('SELECT * FROM purchase_items WHERE purchase_id = ?', purchase.id)) {
    if (!it.product_id) continue;
    recordMovement({ productId: it.product_id, type: 'purchase', qty: it.base_qty, refId: purchase.id, userId: user.id, at });
    if (it.expiry_date || it.lot_code) {
      addLot(it.product_id, { qty: it.base_qty, expiry: it.expiry_date, code: it.lot_code, source: `Réception n° ${purchase.id}`, at });
    }
    if (updateCost && it.unit_cost > 0) {
      q.run('UPDATE products SET cost_price = ? WHERE id = ?', round4(it.unit_cost / it.units_per), it.product_id);
    }
  }
  q.run("UPDATE purchases SET status = 'received', received_at = ? WHERE id = ?", at, purchase.id);
}

/** Paiement (total ou partiel) d'un achat au fournisseur. */
export function addPurchasePayment(user, purchaseId, { amount, method }, { at } = {}) {
  const value = round2(num(amount));
  if (!(value > 0)) bad('Montant invalide.');
  const m = str(method, 40) || CASH;
  if (!paymentMethods().includes(m)) bad('Moyen de paiement inconnu.');
  const p = q.get(`SELECT x.*, ${PURCHASE_PAID_SQL} AS paid FROM purchases x WHERE x.id = ?`, purchaseId);
  if (!p) notFound('Achat introuvable.');
  if (p.status === 'cancelled') bad('Cette commande est annulée.');
  const due = round2(p.total - p.paid);
  if (value > due + 0.004) bad(`Montant supérieur au reste à payer (${fmtQty(due)}).`);
  q.run(
    'INSERT INTO purchase_payments (purchase_id, user_id, amount, method, created_at) VALUES (?, ?, ?, ?, ?)',
    purchaseId,
    user.id,
    value,
    m,
    at || nowLocal(),
  );
}

/**
 * body = { supplier_id, reference, note, update_cost, receive, paid, method,
 *          items: [{ product_id, unit_type: 'unit'|'pack', qty, unit_cost, expiry_date, lot_code }] }
 * receive : marchandise reçue maintenant (sinon simple commande, entrée en stock plus tard).
 */
export function createPurchase(user, body, { at } = {}) {
  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) bad('Ajoutez au moins un produit.');
  const updateCost = body.update_cost !== false;
  const receive = body.receive !== false;
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
      const expiry = str(it.expiry_date, 10);
      if (expiry && !isDay(expiry)) bad(`Date de péremption invalide pour « ${p.name} ».`);
      return {
        p,
        unitType,
        unitsPer,
        unitLabel: unitType === 'pack' ? p.pack_unit : p.unit,
        qty,
        baseQty: round3(qty * unitsPer),
        unitCost,
        total: round2(qty * unitCost),
        expiry,
        lotCode: str(it.lot_code, 60),
      };
    });
    const total = round2(sum(lines, (l) => l.total));
    const purchase = q.run(
      'INSERT INTO purchases (supplier_id, user_id, reference, total, note, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      supplierId,
      user.id,
      str(body.reference, 80),
      total,
      str(body.note, 300),
      now,
      'ordered',
    );
    for (const l of lines) {
      q.run(
        `INSERT INTO purchase_items (purchase_id, product_id, name, unit_type, unit_label, qty, units_per, base_qty, unit_cost, total, expiry_date, lot_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        l.expiry,
        l.lotCode,
      );
    }
    if (receive) receiveItems({ id: purchase.id }, user, { at: now, updateCost });
    const paidNow = round2(num(body.paid, 0));
    if (paidNow > 0) addPurchasePayment(user, purchase.id, { amount: paidNow, method: body.method }, { at: now });
    return purchase.id;
  });
}

export function receivePurchase(user, purchaseId, { updateCost = true } = {}) {
  return tx(() => {
    const p = q.get('SELECT * FROM purchases WHERE id = ?', purchaseId);
    if (!p) notFound('Achat introuvable.');
    if (p.status !== 'ordered') bad('Cette commande est déjà reçue ou annulée.');
    receiveItems(p, user, { at: nowLocal(), updateCost });
  });
}

export function cancelPurchase(purchaseId) {
  return tx(() => {
    const p = q.get(`SELECT x.*, ${PURCHASE_PAID_SQL} AS paid FROM purchases x WHERE x.id = ?`, purchaseId);
    if (!p) notFound('Achat introuvable.');
    if (p.status !== 'ordered') bad('Seule une commande pas encore reçue peut être annulée.');
    if (p.paid > 0.004) bad('Un acompte a déjà été versé sur cette commande : elle ne peut pas être annulée.');
    q.run("UPDATE purchases SET status = 'cancelled' WHERE id = ?", purchaseId);
  });
}

/** Dettes envers les fournisseurs (achats reçus non payés). */
export function supplierPayables() {
  return round2(
    q.val(
      `SELECT COALESCE(SUM(x.total - ${PURCHASE_PAID_SQL}), 0) FROM purchases x WHERE x.status = 'received'`,
    ) || 0,
  );
}

export const ADJUST_REASONS = ['Inventaire', 'Perte / casse', 'Produit périmé', 'Usage interne', 'Retour fournisseur', 'Correction', 'Autre'];

/** body = { product_id, mode: 'set'|'add'|'remove', qty (unités de base), reason, note, expiry_date, lot_code } */
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
    const expiry = str(body.expiry_date, 10);
    if (expiry && !isDay(expiry)) bad('Date de péremption invalide.');
    const reason = [str(body.reason, 60) || 'Ajustement', str(body.note, 200)].filter(Boolean).join(' — ');
    const at = nowLocal();
    if (delta < 0) consumeLots(p.id, -delta);
    else if (expiry || str(body.lot_code, 60)) addLot(p.id, { qty: delta, expiry, code: body.lot_code, source: reason, at });
    return recordMovement({ productId: p.id, type: 'adjust', qty: delta, reason, userId: user.id, at });
  });
}
