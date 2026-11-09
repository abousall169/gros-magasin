// Catégories et produits (catalogue, prix gros / détail, import / export CSV).
import { Router } from 'express';
import { q, tx } from '../db.js';
import { requirePerm } from '../auth.js';
import { PRODUCT_SELECT, publicProduct, recordMovement } from '../services.js';
import { bad, notFound, str, num, int, bool, round2, round3, round4, nowLocal } from '../util.js';
import { toCSV, sendCSV, parseCSV, normHeader } from '../csv.js';
import { broadcast } from '../events.js';

const r = Router();

// ---- Catégories -------------------------------------------------------------
r.get('/categories', (req, res) => {
  res.json(
    q.all(
      `SELECT c.id, c.name, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS products
         FROM categories c ORDER BY c.name COLLATE NOCASE`,
    ),
  );
});

function categoryId(name) {
  const n = str(name, 60);
  if (!n) return null;
  const found = q.get('SELECT id FROM categories WHERE name = ? COLLATE NOCASE', n);
  return found ? found.id : q.run('INSERT INTO categories (name) VALUES (?)', n).id;
}

r.post('/categories', requirePerm('products.manage'), (req, res) => {
  const name = str(req.body?.name, 60) || bad('Le nom de la catégorie est obligatoire.');
  if (q.get('SELECT id FROM categories WHERE name = ? COLLATE NOCASE', name)) bad('Cette catégorie existe déjà.');
  const c = q.run('INSERT INTO categories (name) VALUES (?)', name);
  broadcast('products');
  res.json({ id: c.id, name });
});

r.put('/categories/:id', requirePerm('products.manage'), (req, res) => {
  const id = int(req.params.id);
  const name = str(req.body?.name, 60) || bad('Le nom de la catégorie est obligatoire.');
  if (q.get('SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND id <> ?', name, id)) {
    bad('Cette catégorie existe déjà.');
  }
  if (!q.run('UPDATE categories SET name = ? WHERE id = ?', name, id).changes) notFound();
  broadcast('products');
  res.json({ ok: true });
});

r.delete('/categories/:id', requirePerm('products.manage'), (req, res) => {
  const id = int(req.params.id);
  tx(() => {
    q.run('UPDATE products SET category_id = NULL WHERE category_id = ?', id);
    q.run('DELETE FROM categories WHERE id = ?', id);
  });
  broadcast('products');
  res.json({ ok: true });
});

// ---- Produits ---------------------------------------------------------------
r.get('/products', (req, res) => {
  const all = req.query.all === '1';
  const rows = q.all(`${PRODUCT_SELECT} ${all ? '' : 'WHERE p.active = 1'} ORDER BY p.name COLLATE NOCASE`);
  res.json(rows.map((p) => publicProduct(p, req.perms)));
});

r.get('/products/:id', (req, res) => {
  const p = q.get(`${PRODUCT_SELECT} WHERE p.id = ?`, int(req.params.id));
  if (!p) notFound('Produit introuvable.');
  const out = publicProduct(p, req.perms);
  if (req.perms.has('stock.manage') || req.perms.has('products.manage')) {
    out.movements = q.all(
      `SELECT m.*, u.name AS user_name FROM stock_movements m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.product_id = ? ORDER BY m.id DESC LIMIT 60`,
      p.id,
    );
  }
  res.json(out);
});

/** Valide et normalise les champs d'un produit. */
function productInput(b) {
  const name = str(b.name, 120) || bad('Le nom du produit est obligatoire.');
  const unit = str(b.unit, 20) || 'pièce';
  const packUnit = str(b.pack_unit, 20);
  let packSize = round3(num(b.pack_size, 1));
  if (packUnit) {
    if (!(packSize > 1)) bad(`Indiquez combien de « ${unit} » contient un(e) « ${packUnit} » (au moins 2).`);
  } else packSize = 1;
  const retail = round2(num(b.retail_price, 0));
  const wholesale = round2(num(b.wholesale_price, 0));
  const cost = round4(num(b.cost_price, 0));
  const minStock = round3(num(b.min_stock, 0));
  for (const [v, label] of [
    [retail, 'Prix de détail'],
    [wholesale, 'Prix de gros'],
    [cost, "Prix d'achat"],
    [minStock, "Seuil d'alerte"],
  ]) {
    if (!(v >= 0)) bad(`${label} invalide.`);
  }
  let categoryIdValue = null;
  if (b.category_id) categoryIdValue = int(b.category_id);
  else if (b.category_name) categoryIdValue = categoryId(b.category_name);
  return {
    name,
    barcode: str(b.barcode, 64),
    category_id: categoryIdValue,
    unit,
    retail_price: retail,
    pack_unit: packUnit,
    pack_size: packSize,
    wholesale_price: wholesale,
    cost_price: cost,
    min_stock: minStock,
    active: b.active === undefined ? 1 : bool(b.active) ? 1 : 0,
  };
}

function checkBarcode(barcode, id = 0) {
  if (!barcode) return;
  const other = q.get('SELECT name FROM products WHERE barcode = ? AND id <> ?', barcode, id);
  if (other) bad(`Ce code est déjà utilisé par « ${other.name} ».`);
}

function insertProduct(d, user, initialStock = 0) {
  const now = nowLocal();
  const p = q.run(
    `INSERT INTO products (name, barcode, category_id, unit, retail_price, pack_unit, pack_size, wholesale_price, cost_price, min_stock, active, stock, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    d.name,
    d.barcode,
    d.category_id,
    d.unit,
    d.retail_price,
    d.pack_unit,
    d.pack_size,
    d.wholesale_price,
    d.cost_price,
    d.min_stock,
    d.active,
    now,
    now,
  );
  if (initialStock > 0) {
    recordMovement({ productId: p.id, type: 'initial', qty: initialStock, reason: 'Stock initial', userId: user.id, at: now });
  }
  return p.id;
}

function updateProduct(id, d) {
  q.run(
    `UPDATE products SET name = ?, barcode = ?, category_id = ?, unit = ?, retail_price = ?, pack_unit = ?, pack_size = ?,
            wholesale_price = ?, cost_price = ?, min_stock = ?, active = ?, updated_at = ?
      WHERE id = ?`,
    d.name,
    d.barcode,
    d.category_id,
    d.unit,
    d.retail_price,
    d.pack_unit,
    d.pack_size,
    d.wholesale_price,
    d.cost_price,
    d.min_stock,
    d.active,
    nowLocal(),
    id,
  );
}

r.post('/products', requirePerm('products.manage'), (req, res) => {
  const d = productInput(req.body || {});
  const stock = round3(num(req.body?.stock, 0));
  if (!(stock >= 0)) bad('Stock initial invalide.');
  const id = tx(() => {
    checkBarcode(d.barcode);
    return insertProduct(d, req.user, stock);
  });
  broadcast('products');
  res.json({ id });
});

r.put('/products/:id', requirePerm('products.manage'), (req, res) => {
  const id = int(req.params.id);
  const existing = q.get('SELECT * FROM products WHERE id = ?', id);
  if (!existing) notFound('Produit introuvable.');
  // Un gestionnaire sans accès aux prix d'achat ne doit pas les effacer
  const body = { ...req.body };
  if (!req.perms.has('cost.view')) body.cost_price = existing.cost_price;
  const d = productInput(body);
  tx(() => {
    checkBarcode(d.barcode, id);
    updateProduct(id, d);
  });
  broadcast('products');
  res.json({ ok: true });
});

r.delete('/products/:id', requirePerm('products.manage'), (req, res) => {
  const id = int(req.params.id);
  const used =
    q.val('SELECT COUNT(*) FROM sale_items WHERE product_id = ?', id) +
    q.val('SELECT COUNT(*) FROM purchase_items WHERE product_id = ?', id);
  if (used > 0) {
    // Le produit a un historique : on le désactive pour garder les rapports justes
    q.run('UPDATE products SET active = 0, updated_at = ? WHERE id = ?', nowLocal(), id);
    broadcast('products');
    return res.json({ ok: true, archived: true });
  }
  q.run('DELETE FROM products WHERE id = ?', id);
  broadcast('products');
  res.json({ ok: true, deleted: true });
});

// ---- Import / export CSV ------------------------------------------------------
const CSV_COLUMNS = [
  ['nom', (p) => p.name],
  ['code', (p) => p.barcode],
  ['categorie', (p) => p.category_name],
  ['unite', (p) => p.unit],
  ['prix_detail', (p) => p.retail_price],
  ['unite_gros', (p) => p.pack_unit],
  ['contenance', (p) => (p.pack_unit ? p.pack_size : '')],
  ['prix_gros', (p) => p.wholesale_price],
  ['prix_achat', (p) => p.cost_price],
  ['stock', (p) => p.stock],
  ['seuil_alerte', (p) => p.min_stock],
];

r.get('/export/products.csv', requirePerm('products.manage'), (req, res) => {
  const rows = q.all(`${PRODUCT_SELECT} WHERE p.active = 1 ORDER BY p.name COLLATE NOCASE`);
  const cols = req.perms.has('cost.view') ? CSV_COLUMNS : CSV_COLUMNS.filter(([h]) => h !== 'prix_achat');
  sendCSV(res, 'produits.csv', toCSV(rows, cols));
});

r.get('/export/products-template.csv', requirePerm('products.manage'), (req, res) => {
  const sample = [
    { name: 'Huile végétale 1 L', barcode: '', category_name: 'Alimentation', unit: 'bouteille', retail_price: 1300, pack_unit: 'carton', pack_size: 12, wholesale_price: 14400, cost_price: 1100, stock: 120, min_stock: 24 },
    { name: 'Ciment 50 kg', barcode: '', category_name: 'Quincaillerie', unit: 'sac', retail_price: 4800, pack_unit: '', pack_size: 1, wholesale_price: 4500, cost_price: 4200, stock: 40, min_stock: 10 },
  ];
  sendCSV(res, 'modele-produits.csv', toCSV(sample, CSV_COLUMNS));
});

const ALIASES = {
  nom: ['nom', 'name', 'produit', 'designation', 'article', 'libelle'],
  code: ['code', 'code_barre', 'code_barres', 'barcode', 'reference', 'ref'],
  categorie: ['categorie', 'category', 'famille', 'rayon'],
  unite: ['unite', 'unit', 'unite_detail', 'unite_de_vente'],
  prix_detail: ['prix_detail', 'prix_de_detail', 'prix_vente', 'prix', 'pv', 'prix_unitaire'],
  unite_gros: ['unite_gros', 'unite_de_gros', 'colis', 'conditionnement'],
  contenance: ['contenance', 'quantite_par_colis', 'qte_par_colis', 'nb_par_colis', 'pack_size'],
  prix_gros: ['prix_gros', 'prix_de_gros'],
  prix_achat: ['prix_achat', 'prix_d_achat', 'cout', 'pa'],
  stock: ['stock', 'quantite', 'qte', 'stock_initial'],
  seuil_alerte: ['seuil_alerte', 'seuil', 'alerte', 'stock_min', 'stock_minimum'],
};

r.post('/products/import', requirePerm('products.manage'), (req, res) => {
  const rows = parseCSV(req.body?.csv);
  if (rows.length < 2) bad('Le fichier est vide ou ne contient pas de ligne de produit.');
  const headers = rows[0].map(normHeader);
  const col = {};
  for (const [key, names] of Object.entries(ALIASES)) {
    const i = headers.findIndex((h) => names.includes(h));
    if (i >= 0) col[key] = i;
  }
  if (col.nom === undefined) bad('Colonne « nom » introuvable. Utilisez le modèle fourni.');
  const updateExisting = req.body?.update_existing !== false;
  const result = { created: 0, updated: 0, skipped: 0, errors: [] };

  tx(() => {
    rows.slice(1).forEach((row, idx) => {
      const get = (k) => (col[k] === undefined ? undefined : row[col[k]]);
      const line = idx + 2;
      try {
        const body = {
          name: get('nom'),
          barcode: get('code'),
          category_name: get('categorie'),
          unit: get('unite'),
          retail_price: get('prix_detail'),
          pack_unit: get('unite_gros'),
          pack_size: get('contenance'),
          wholesale_price: get('prix_gros'),
          cost_price: get('prix_achat'),
          min_stock: get('seuil_alerte'),
        };
        for (const k of ['retail_price', 'pack_size', 'wholesale_price', 'cost_price', 'min_stock']) {
          if (body[k] !== undefined && String(body[k]).trim() !== '' && !Number.isFinite(num(body[k]))) {
            bad(`valeur numérique invalide « ${body[k]} »`);
          }
        }
        const stockRaw = get('stock');
        const stock = stockRaw === undefined || String(stockRaw).trim() === '' ? null : round3(num(stockRaw));
        if (stock !== null && !(stock >= 0)) bad('stock invalide');

        const name = str(body.name, 120);
        const barcode = str(body.barcode, 64);
        const existing =
          (barcode && q.get('SELECT * FROM products WHERE barcode = ?', barcode)) ||
          (name && q.get('SELECT * FROM products WHERE name = ? COLLATE NOCASE', name));
        if (existing) {
          if (!updateExisting) {
            result.skipped++;
            return;
          }
          // Une case vide conserve la valeur actuelle du produit
          const keep = {
            barcode: existing.barcode,
            unit: existing.unit,
            retail_price: existing.retail_price,
            pack_unit: existing.pack_unit,
            pack_size: existing.pack_size,
            wholesale_price: existing.wholesale_price,
            cost_price: existing.cost_price,
            min_stock: existing.min_stock,
          };
          for (const [k, v] of Object.entries(keep)) {
            if (body[k] === undefined || String(body[k]).trim() === '') body[k] = v;
          }
          if (!req.perms.has('cost.view')) body.cost_price = existing.cost_price;
          const d = productInput(body);
          if (!str(body.category_name, 60)) d.category_id = existing.category_id;
          checkBarcode(d.barcode, existing.id);
          updateProduct(existing.id, d);
          if (stock !== null && Math.abs(stock - existing.stock) > 0.0005) {
            recordMovement({
              productId: existing.id,
              type: 'adjust',
              qty: round3(stock - existing.stock),
              reason: 'Import CSV',
              userId: req.user.id,
              at: nowLocal(),
            });
          }
          result.updated++;
        } else {
          const d = productInput(body);
          checkBarcode(d.barcode);
          insertProduct(d, req.user, stock || 0);
          result.created++;
        }
      } catch (e) {
        if (!e.status) throw e;
        result.errors.push({ line, message: e.message });
      }
    });
  });
  broadcast('products');
  res.json(result);
});

export default r;
