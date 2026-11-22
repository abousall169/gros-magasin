// Catégories et produits (catalogue, prix gros / détail, import / export CSV).
import { Router } from 'express';
import { q, tx } from '../db.js';
import { requirePerm } from '../auth.js';
import { PRODUCT_SELECT, publicProduct, recordMovement, addLot, consumeLots, syncExpiry } from '../services.js';
import { bad, notFound, str, num, int, bool, round2, round3, round4, nowLocal, isDay } from '../util.js';
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
  // Demi-gros (facultatif) : un prix, et éventuellement une unité intermédiaire plus petite que le colis
  const semiUnit = str(b.semi_unit, 20);
  let semiSize = round3(num(b.semi_size, 1));
  const semi = round2(num(b.semi_price, 0));
  if (semiUnit) {
    if (!(semiSize > 1)) bad(`Indiquez combien de « ${unit} » contient un(e) « ${semiUnit} » (demi-gros, au moins 2).`);
    if (packUnit && semiSize >= packSize) {
      bad(`Le demi-gros (« ${semiUnit} » de ${semiSize}) doit contenir moins que le gros (« ${packUnit} » de ${packSize}).`);
    }
    if (!(semi > 0)) bad(`Indiquez le prix demi-gros d'un(e) « ${semiUnit} ».`);
  } else semiSize = 1;
  const retail = round2(num(b.retail_price, 0));
  const wholesale = round2(num(b.wholesale_price, 0));
  const cost = round4(num(b.cost_price, 0));
  const minStock = round3(num(b.min_stock, 0));
  for (const [v, label] of [
    [retail, 'Prix de détail'],
    [wholesale, 'Prix de gros'],
    [semi, 'Prix demi-gros'],
    [cost, "Prix d'achat"],
    [minStock, "Seuil d'alerte"],
  ]) {
    if (!(v >= 0)) bad(`${label} invalide.`);
  }
  let categoryIdValue = null;
  if (b.category_id) categoryIdValue = int(b.category_id);
  else if (b.category_name) categoryIdValue = categoryId(b.category_name);
  let taxRate = null;
  if (b.tax_rate !== undefined && b.tax_rate !== null && String(b.tax_rate).trim() !== '') {
    taxRate = num(b.tax_rate);
    if (!(taxRate >= 0 && taxRate <= 100)) bad('Taux de TVA invalide (entre 0 et 100).');
  }
  const expiry = str(b.expiry_date, 10);
  if (expiry && !isDay(expiry)) bad('Date de péremption invalide.');
  return {
    name,
    name_ar: str(b.name_ar, 120),
    tax_rate: taxRate,
    expiry_date: expiry,
    barcode: normalizeCode(str(b.barcode, 64)),
    category_id: categoryIdValue,
    unit,
    retail_price: retail,
    pack_unit: packUnit,
    pack_size: packSize,
    wholesale_price: wholesale,
    semi_unit: semiUnit,
    semi_size: semiSize,
    semi_price: semi,
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
    `INSERT INTO products (name, name_ar, barcode, category_id, unit, retail_price, pack_unit, pack_size, wholesale_price,
                           semi_unit, semi_size, semi_price, cost_price, min_stock, active, tax_rate, expiry_date, stock, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    d.name,
    d.name_ar,
    d.barcode,
    d.category_id,
    d.unit,
    d.retail_price,
    d.pack_unit,
    d.pack_size,
    d.wholesale_price,
    d.semi_unit,
    d.semi_size,
    d.semi_price,
    d.cost_price,
    d.min_stock,
    d.active,
    d.tax_rate,
    d.expiry_date,
    now,
    now,
  );
  if (initialStock > 0) {
    recordMovement({ productId: p.id, type: 'initial', qty: initialStock, reason: 'Stock initial', userId: user.id, at: now });
    if (d.expiry_date) addLot(p.id, { qty: initialStock, expiry: d.expiry_date, source: 'Stock initial', at: now });
  }
  return p.id;
}

/** La date saisie sur la fiche s'applique au lot unique ; avec plusieurs lots, elle est calculée. */
function applyExpiry(id, date) {
  const lots = q.all('SELECT id FROM stock_lots WHERE product_id = ? AND qty > 0', id);
  if (lots.length === 1) {
    q.run('UPDATE stock_lots SET expiry_date = ? WHERE id = ?', date, lots[0].id);
  } else if (!lots.length) {
    const stock = q.val('SELECT stock FROM products WHERE id = ?', id);
    if (date && stock > 0) addLot(id, { qty: stock, expiry: date, source: 'Fiche produit' });
    return;
  }
  syncExpiry(id);
}

function updateProduct(id, d) {
  q.run(
    `UPDATE products SET name = ?, name_ar = ?, barcode = ?, category_id = ?, unit = ?, retail_price = ?, pack_unit = ?, pack_size = ?,
            wholesale_price = ?, semi_unit = ?, semi_size = ?, semi_price = ?, cost_price = ?, min_stock = ?, active = ?, tax_rate = ?,
            expiry_date = ?, updated_at = ?
      WHERE id = ?`,
    d.name,
    d.name_ar,
    d.barcode,
    d.category_id,
    d.unit,
    d.retail_price,
    d.pack_unit,
    d.pack_size,
    d.wholesale_price,
    d.semi_unit,
    d.semi_size,
    d.semi_price,
    d.cost_price,
    d.min_stock,
    d.active,
    d.tax_rate,
    d.expiry_date,
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
    if ((d.expiry_date || null) !== (existing.expiry_date || null)) applyExpiry(id, d.expiry_date);
  });
  broadcast('products');
  res.json({ ok: true });
});

// ---- Codes-barres internes (produits sans code) -----------------------------------
// EAN-13 « usage magasin » : préfixe 20 (réservé par GS1 aux codes internes) + n° du produit + clé.
// Même calcul que public/js/barcode.js (internalEan13).
export function internalEan13(id) {
  const body = `20${String(id).padStart(10, '0')}`;
  let total = 0;
  for (let i = 0; i < 12; i++) total += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  return body + ((10 - (total % 10)) % 10);
}

/** Un UPC-A (12 chiffres) est un EAN-13 qui commence par 0 : on garde toujours la forme à 13 chiffres. */
export function normalizeCode(code) {
  if (!code) return code;
  return /^\d{12}$/.test(code) ? `0${code}` : code;
}

r.post('/products/assign-barcodes', requirePerm('products.manage'), (req, res) => {
  const ids = tx(() => {
    const rows = q.all("SELECT id FROM products WHERE active = 1 AND (barcode IS NULL OR barcode = '')");
    const done = [];
    for (const { id } of rows) {
      const code = internalEan13(id);
      if (q.get('SELECT id FROM products WHERE barcode = ?', code)) continue;
      q.run('UPDATE products SET barcode = ?, updated_at = ? WHERE id = ?', code, nowLocal(), id);
      done.push(id);
    }
    return done;
  });
  if (ids.length) broadcast('products');
  res.json({ assigned: ids.length });
});

r.post('/products/:id/barcode', requirePerm('products.manage'), (req, res) => {
  const id = int(req.params.id);
  const p = q.get('SELECT * FROM products WHERE id = ?', id);
  if (!p) notFound('Produit introuvable.');
  if (!p.barcode) {
    const code = internalEan13(id);
    checkBarcode(code, id);
    q.run('UPDATE products SET barcode = ?, updated_at = ? WHERE id = ?', code, nowLocal(), id);
    broadcast('products');
  }
  res.json({ barcode: q.val('SELECT barcode FROM products WHERE id = ?', id) });
});

// ---- Reconnaissance par photo ------------------------------------------------------
// Le modèle DINOv2-small (quantifié) tourne dans le navigateur ; le serveur garde les empreintes
// des photos de référence et les renvoie aux appareils, qui comparent sur place.
export const VISION_MODEL = 'dinov2-small-q8';
const VISION_DIM = 768;
const MAX_IMAGES = 12;

r.get('/embeddings', (req, res) => {
  const st = q.get(
    `SELECT COUNT(*) AS n, COALESCE(MAX(i.id), 0) AS maxId, COALESCE(SUM(p.active), 0) AS act
       FROM product_images i JOIN products p ON p.id = i.product_id`,
  );
  const etag = `"${VISION_MODEL}-${st.n}-${st.maxId}-${st.act}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'no-cache');
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  const rows = q.all(
    `SELECT i.id, i.product_id, i.embedding FROM product_images i
       JOIN products p ON p.id = i.product_id WHERE p.active = 1 AND i.model = ?`,
    VISION_MODEL,
  );
  res.json({
    model: VISION_MODEL,
    dim: VISION_DIM,
    items: rows.map((x) => ({ id: x.id, productId: x.product_id, v: Buffer.from(x.embedding).toString('base64') })),
  });
});

r.get('/products/:id/images', (req, res) => {
  res.json(q.all('SELECT id, thumb FROM product_images WHERE product_id = ? ORDER BY id', int(req.params.id)));
});

r.post('/products/:id/images', requirePerm('products.manage'), (req, res) => {
  const id = int(req.params.id);
  const { embedding, thumb } = req.body || {};
  const emb = Buffer.from(String(embedding ?? ''), 'base64');
  if (emb.length !== VISION_DIM * 4) bad('Empreinte de photo invalide.');
  if (typeof thumb !== 'string' || !thumb.startsWith('data:image/jpeg;base64,') || thumb.length > 40000) bad('Miniature invalide.');
  if (!q.get('SELECT id FROM products WHERE id = ?', id)) notFound('Produit introuvable.');
  if (q.val('SELECT COUNT(*) FROM product_images WHERE product_id = ?', id) >= MAX_IMAGES) {
    bad(`${MAX_IMAGES} photos au maximum par produit.`);
  }
  const img = q.run(
    'INSERT INTO product_images (product_id, model, embedding, thumb, created_at) VALUES (?, ?, ?, ?, ?)',
    id,
    VISION_MODEL,
    emb,
    thumb,
    nowLocal(),
  );
  broadcast('products');
  res.json({ id: img.id });
});

r.delete('/product-images/:id', requirePerm('products.manage'), (req, res) => {
  q.run('DELETE FROM product_images WHERE id = ?', int(req.params.id));
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
  ['nom_arabe', (p) => p.name_ar],
  ['code', (p) => p.barcode],
  ['categorie', (p) => p.category_name],
  ['unite', (p) => p.unit],
  ['prix_detail', (p) => p.retail_price],
  ['unite_gros', (p) => p.pack_unit],
  ['contenance', (p) => (p.pack_unit ? p.pack_size : '')],
  ['prix_gros', (p) => p.wholesale_price],
  ['unite_demi_gros', (p) => p.semi_unit],
  ['contenance_demi_gros', (p) => (p.semi_unit ? p.semi_size : '')],
  ['prix_demi_gros', (p) => p.semi_price || ''],
  ['prix_achat', (p) => p.cost_price],
  ['stock', (p) => p.stock],
  ['seuil_alerte', (p) => p.min_stock],
  ['tva', (p) => p.tax_rate],
  ['peremption', (p) => p.expiry_date],
];

r.get('/export/products.csv', requirePerm('products.manage'), (req, res) => {
  const rows = q.all(`${PRODUCT_SELECT} WHERE p.active = 1 ORDER BY p.name COLLATE NOCASE`);
  const cols = req.perms.has('cost.view') ? CSV_COLUMNS : CSV_COLUMNS.filter(([h]) => h !== 'prix_achat');
  sendCSV(res, 'produits.csv', toCSV(rows, cols));
});

r.get('/export/products-template.csv', requirePerm('products.manage'), (req, res) => {
  const sample = [
    { name: 'Huile végétale 1 L', barcode: '', category_name: 'Alimentation', unit: 'bouteille', retail_price: 1300, pack_unit: 'carton', pack_size: 12, wholesale_price: 14400, semi_unit: 'pack', semi_size: 6, semi_price: 7500, cost_price: 1100, stock: 120, min_stock: 24 },
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
  unite_demi_gros: ['unite_demi_gros', 'unite_de_demi_gros'],
  contenance_demi_gros: ['contenance_demi_gros', 'quantite_demi_gros', 'qte_demi_gros'],
  prix_demi_gros: ['prix_demi_gros', 'prix_de_demi_gros', 'prix_semi_gros'],
  prix_achat: ['prix_achat', 'prix_d_achat', 'cout', 'pa'],
  stock: ['stock', 'quantite', 'qte', 'stock_initial'],
  seuil_alerte: ['seuil_alerte', 'seuil', 'alerte', 'stock_min', 'stock_minimum'],
  nom_arabe: ['nom_arabe', 'nom_ar', 'name_ar', 'arabe'],
  tva: ['tva', 'taux_tva', 'tax_rate', 'vat'],
  peremption: ['peremption', 'date_peremption', 'expiration', 'expiry_date', 'dlc'],
};

/** Date de péremption lue dans Excel : AAAA-MM-JJ ou JJ/MM/AAAA. */
function csvDay(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (isDay(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s;
}

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
          semi_unit: get('unite_demi_gros'),
          semi_size: get('contenance_demi_gros'),
          semi_price: get('prix_demi_gros'),
          cost_price: get('prix_achat'),
          min_stock: get('seuil_alerte'),
          name_ar: get('nom_arabe'),
          tax_rate: get('tva'),
          expiry_date: get('peremption') === undefined ? undefined : csvDay(get('peremption')),
        };
        for (const k of ['retail_price', 'pack_size', 'wholesale_price', 'semi_size', 'semi_price', 'cost_price', 'min_stock', 'tax_rate']) {
          if (body[k] !== undefined && String(body[k]).trim() !== '' && !Number.isFinite(num(body[k]))) {
            bad(`valeur numérique invalide « ${body[k]} »`);
          }
        }
        const stockRaw = get('stock');
        const stock = stockRaw === undefined || String(stockRaw).trim() === '' ? null : round3(num(stockRaw));
        if (stock !== null && !(stock >= 0)) bad('stock invalide');

        const name = str(body.name, 120);
        const barcode = normalizeCode(str(body.barcode, 64));
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
            semi_unit: existing.semi_unit,
            semi_size: existing.semi_size,
            semi_price: existing.semi_price,
            cost_price: existing.cost_price,
            min_stock: existing.min_stock,
            name_ar: existing.name_ar,
            tax_rate: existing.tax_rate,
            expiry_date: existing.expiry_date,
          };
          for (const [k, v] of Object.entries(keep)) {
            if (body[k] === undefined || body[k] === null || String(body[k]).trim() === '') body[k] = v;
          }
          if (!req.perms.has('cost.view')) body.cost_price = existing.cost_price;
          const d = productInput(body);
          if (!str(body.category_name, 60)) d.category_id = existing.category_id;
          checkBarcode(d.barcode, existing.id);
          updateProduct(existing.id, d);
          if ((d.expiry_date || null) !== (existing.expiry_date || null)) applyExpiry(existing.id, d.expiry_date);
          if (stock !== null && Math.abs(stock - existing.stock) > 0.0005) {
            if (stock < existing.stock) consumeLots(existing.id, round3(existing.stock - stock));
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
