// Données de démonstration (proposées à la première installation) pour essayer le logiciel.
import { q, tx } from './db.js';
import { createSale, createPurchase, recordMovement, listPriceFor, customerBalance } from './services.js';
import { nowLocal, todayLocal, addDays, round2 } from './util.js';
import { updateSettings } from './settings.js';

// Générateur pseudo-aléatoire reproductible
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// [nom, catégorie, unité, prix détail, unité de gros, contenance, prix de gros, prix d'achat, stock, seuil]
const PRODUCTS = [
  ['Riz brisé', 'Alimentation', 'kg', 450, 'sac', 50, 20000, 380, 1500, 250],
  ['Riz parfumé (sac 5 kg)', 'Alimentation', 'sac', 4500, 'balle', 5, 21000, 3900, 60, 15],
  ['Sucre en poudre', 'Alimentation', 'kg', 700, 'sac', 50, 31500, 600, 1000, 200],
  ['Farine de blé', 'Alimentation', 'kg', 500, 'sac', 50, 23000, 420, 600, 150],
  ['Huile végétale 1 L', 'Alimentation', 'bouteille', 1300, 'carton', 12, 14400, 1100, 240, 48],
  ['Lait en poudre 400 g', 'Alimentation', 'sachet', 2000, 'carton', 24, 44400, 1700, 96, 24],
  ['Pâtes alimentaires 500 g', 'Alimentation', 'paquet', 400, 'carton', 20, 7200, 320, 400, 80],
  ['Concentré de tomate 70 g', 'Alimentation', 'boîte', 150, 'carton', 50, 6250, 110, 600, 100],
  ['Bouillon cube', 'Alimentation', 'paquet', 1000, 'carton', 24, 21600, 820, 144, 24],
  ["Sardines à l'huile 125 g", 'Alimentation', 'boîte', 500, 'carton', 50, 22500, 400, 300, 50],
  ['Thé vert 25 g', 'Alimentation', 'paquet', 250, 'carton', 100, 22000, 190, 500, 100],
  ['Eau minérale 1,5 L', 'Boissons', 'bouteille', 400, 'pack', 6, 2100, 300, 300, 60],
  ['Boisson gazeuse 33 cl', 'Boissons', 'canette', 400, 'carton', 24, 8400, 310, 240, 48],
  ['Jus de fruits 1 L', 'Boissons', 'brique', 1200, 'carton', 12, 12600, 950, 30, 36],
  ['Savon de ménage 400 g', 'Hygiène & entretien', 'morceau', 300, 'carton', 40, 10400, 230, 400, 80],
  ['Lessive en poudre 1 kg', 'Hygiène & entretien', 'sachet', 1200, 'carton', 10, 11000, 980, 25, 30],
  ['Papier hygiénique', 'Hygiène & entretien', 'rouleau', 250, 'ballot', 48, 10560, 190, 20, 48],
  ['Eau de javel 1 L', 'Hygiène & entretien', 'bouteille', 600, 'carton', 12, 6600, 480, 0, 12],
  ['Ciment 50 kg', 'Quincaillerie', 'sac', 4800, null, 1, 4500, 4200, 120, 30],
  ['Fer à béton 10 mm', 'Quincaillerie', 'barre', 5500, 'botte', 10, 52000, 4800, 80, 20],
  ['Pointes 70 mm', 'Quincaillerie', 'kg', 1500, 'carton', 25, 35000, 1200, 100, 25],
  ['Peinture à eau 20 L', 'Quincaillerie', 'seau', 18000, null, 1, 16500, 14500, 12, 4],
];

const CUSTOMERS = [
  ['Boutique Awa (Marché central)', '77 123 45 67', 'Marché central, allée B', 'wholesale', 500000, 0],
  ['Alimentation Konaté', '76 555 12 34', 'Quartier Plateau', 'wholesale', 300000, 0],
  ['Restaurant Le Baobab', '78 900 11 22', 'Avenue principale', 'wholesale', 200000, 0],
  ['Quincaillerie du Rond-Point', '70 321 98 76', 'Rond-point de la gare', 'wholesale', 400000, 0],
  ['Mme Diallo', '77 654 32 10', null, 'retail', 0, 0],
  ['M. Traoré', '76 112 23 34', null, 'retail', 50000, 15000],
];

const SUPPLIERS = [
  ['Distribution Sahel Import', '33 800 10 10', 'Zone industrielle'],
  ['Société Alimentaire du Port', '33 800 20 20', 'Port autonome, entrepôt 4'],
  ['Matériaux & Bâtiment SARL', '33 800 30 30', 'Route nationale'],
];

export function seedDemo(admin) {
  const rand = rng(20261109);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const perms = new Set(['pos', 'price.edit', 'credit.sell', 'cost.view']);
  const today = todayLocal();
  const start = addDays(today, -14);

  tx(() => {
    const at0 = `${start} 07:30:00`;
    const catIds = {};
    for (const c of [...new Set(PRODUCTS.map((p) => p[1]))]) catIds[c] = q.run('INSERT INTO categories (name) VALUES (?)', c).id;

    const products = PRODUCTS.map(([name, cat, unit, retail, packUnit, packSize, wholesale, cost, stock, min]) => {
      const id = q.run(
        `INSERT INTO products (name, category_id, unit, retail_price, pack_unit, pack_size, wholesale_price, cost_price, min_stock, stock, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
        name,
        catIds[cat],
        unit,
        retail,
        packUnit,
        packSize,
        wholesale,
        cost,
        min,
        at0,
        at0,
      ).id;
      // Stock de départ plus large pour couvrir l'historique de ventes simulé
      const initialQty = Math.max(stock * 2, min * 3);
      recordMovement({ productId: id, type: 'initial', qty: initialQty, reason: 'Stock initial', userId: admin.id, at: at0 });
      return { id, name, unit, packUnit, packSize, stock: initialQty, target: stock, min };
    });

    const customers = CUSTOMERS.map(([name, phone, address, type, limit, opening]) => ({
      id: q.run(
        `INSERT INTO customers (name, phone, address, type, credit_limit, opening_balance, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        name,
        phone,
        address,
        type,
        limit,
        opening,
        at0,
      ).id,
      type,
    }));
    const wholesalers = customers.filter((c) => c.type === 'wholesale');

    const suppliers = SUPPLIERS.map(
      ([name, phone, address]) =>
        q.run('INSERT INTO suppliers (name, phone, address, active, created_at) VALUES (?, ?, ?, 1, ?)', name, phone, address, at0).id,
    );

    const now = nowLocal();
    const time = (day) => `${day} ${String(between(8, 19)).padStart(2, '0')}:${String(between(0, 59)).padStart(2, '0')}:${String(between(0, 59)).padStart(2, '0')}`;

    for (let d = 0; d <= 14; d++) {
      const day = addDays(start, d);
      const events = [];
      const n = between(7, 15);
      for (let i = 0; i < n; i++) events.push({ kind: 'sale', at: time(day) });
      if (rand() < 0.5) events.push({ kind: 'payment', at: time(day) });
      events.push({ kind: 'expense', at: time(day) });
      if (d === 7) events.push({ kind: 'purchase', at: `${day} 08:05:00` });
      events.sort((a, b) => a.at.localeCompare(b.at));

      for (const ev of events) {
        if (ev.at > now) continue;
        if (ev.kind === 'sale') {
          const wholesale = rand() < 0.3;
          const customer = wholesale ? pick(wholesalers) : rand() < 0.15 ? pick(customers) : null;
          const items = [];
          const lines = between(1, wholesale ? 5 : 4);
          for (let l = 0; l < lines; l++) {
            const p = pick(products);
            if (items.some((it) => it.product_id === p.id)) continue;
            const useGros = wholesale && (p.packUnit || rand() < 0.5);
            const qty = useGros ? between(1, p.packUnit ? 4 : 10) : between(1, 6);
            const base = qty * (useGros && p.packUnit ? p.packSize : 1);
            if (p.stock - base < Math.max(p.target, p.min) * 0.5) continue;
            p.stock -= base;
            items.push({ product_id: p.id, sale_type: useGros ? 'wholesale' : 'retail', qty });
          }
          if (!items.length) continue;
          const total = round2(
            items.reduce((s, it) => {
              const row = q.get('SELECT * FROM products WHERE id = ?', it.product_id);
              return s + round2(it.qty * listPriceFor(row, it.sale_type));
            }, 0),
          );
          // Paiement : espèces, mobile money, ou crédit partiel pour les grossistes
          const r = rand();
          const full = [{ method: r < 0.75 ? 'Espèces' : 'Mobile Money', amount: total }];
          const base = { customer_id: customer?.id, items };
          if (customer?.type === 'wholesale' && r < 0.35) {
            const part = Math.round((total * (0.4 + rand() * 0.4)) / 500) * 500;
            try {
              createSale(admin, perms, { ...base, payments: [{ method: 'Espèces', amount: part }] }, { at: ev.at });
              continue;
            } catch (e) {
              if (!e.status) throw e; // plafond de crédit atteint : le client paie tout
            }
          }
          createSale(admin, perms, { ...base, payments: full }, { at: ev.at });
        } else if (ev.kind === 'payment') {
          // Un client qui a une dette en rembourse une partie (jamais plus que ce qu'il doit)
          const debtors = customers.filter((c) => customerBalance(c.id) >= 5000);
          if (!debtors.length) continue;
          const c = pick(debtors);
          const owed = customerBalance(c.id);
          const amount = Math.max(5000, Math.min(owed, Math.round((owed * (0.3 + rand() * 0.5)) / 1000) * 1000));
          q.run(
            'INSERT INTO customer_payments (customer_id, user_id, amount, method, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            c.id,
            admin.id,
            amount,
            rand() < 0.6 ? 'Espèces' : 'Mobile Money',
            'Versement',
            ev.at,
          );
        } else if (ev.kind === 'expense') {
          const [category, amount, note] = pick([
            ['Transport', between(2, 8) * 500, 'Livraison client'],
            ['Manutention', between(4, 10) * 500, 'Déchargement'],
            ['Repas', between(2, 6) * 500, 'Repas du personnel'],
            ['Divers', between(1, 6) * 500, null],
          ]);
          q.run(
            'INSERT INTO expenses (user_id, category, amount, method, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            admin.id,
            category,
            amount,
            'Espèces',
            note,
            ev.at,
          );
        } else if (ev.kind === 'purchase') {
          const restock = products.filter((p) => p.packUnit).slice(0, 8);
          createPurchase(
            admin,
            {
              supplier_id: suppliers[1],
              reference: 'BL-2026-118',
              note: 'Réapprovisionnement hebdomadaire',
              items: restock.map((p) => {
                const def = PRODUCTS.find((x) => x[0] === p.name);
                p.stock += 5 * p.packSize;
                return { product_id: p.id, unit_type: 'pack', qty: 5, unit_cost: def[7] * p.packSize };
              }),
            },
            { at: ev.at },
          );
        }
      }
    }

    // Ramène chaque produit vers son niveau de stock « réaliste » (avec quelques alertes)
    for (const p of products) {
      const current = q.val('SELECT stock FROM products WHERE id = ?', p.id);
      const delta = Math.round((p.target - current) * 1000) / 1000;
      if (delta !== 0) {
        recordMovement({ productId: p.id, type: 'adjust', qty: delta, reason: 'Inventaire', userId: admin.id, at: now });
      }
    }
    updateSettings({ demo_data: true });
    q.run(
      'INSERT INTO expenses (user_id, category, amount, method, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      admin.id,
      'Loyer',
      150000,
      'Virement / Chèque',
      'Loyer du magasin',
      `${addDays(today, -10)} 10:00:00`,
    );
  });
}
