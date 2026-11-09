// Catalogue : prix de détail / prix de gros, contenance des colis, stock, import Excel.
import { ref, computed, watch, onMounted } from '../vue.js';
import { api } from '../api.js';
import { store, can, toast, toastError, ask, loadProducts } from '../store.js';
import {
  money,
  qty,
  plural,
  percent,
  parseNum,
  norm,
  hasPack,
  listPrice,
  sellsWholesale,
  stockText,
  stockLevel,
  dateTimeFr,
  round3,
} from '../format.js';
import { route, setQuery } from '../router.js';
import { Icon, Sheet, Empty, Skeleton, PackQtyInput, useMedia } from '../components/ui.js';

const UNITS = ['pièce', 'kg', 'litre', 'bouteille', 'sachet', 'paquet', 'boîte', 'sac', 'barre', 'mètre', 'rouleau', 'canette', 'brique', 'morceau', 'seau', 'tablette'];
const PACKS = ['carton', 'sac', 'paquet', 'balle', 'botte', 'pack', 'casier', 'ballot', 'fût', 'bidon', 'caisse', 'colis', 'douzaine'];
const MOVE = { sale: 'Vente', cancel: 'Annulation de vente', purchase: 'Réception', adjust: 'Ajustement', initial: 'Stock initial' };

const blank = () => ({
  name: '',
  barcode: '',
  category_id: '',
  unit: 'pièce',
  retail_price: '',
  has_pack: false,
  pack_unit: 'carton',
  pack_size: '',
  wholesale_price: '',
  cost_price: '',
  min_stock: 0,
  stock: 0,
  active: true,
});

const ProductEditor = {
  components: { Icon, Sheet, PackQtyInput },
  props: { id: [String, Number] },
  emits: ['close'],
  setup(props, { emit }) {
    const isNew = props.id === 'nouveau';
    const f = ref(blank());
    const product = ref(null);
    const busy = ref(false);
    const newCategory = ref('');
    const canEdit = can('products.manage');
    const load = async () => {
      if (isNew) return;
      try {
        const p = await api.get(`/products/${props.id}`);
        product.value = p;
        f.value = {
          ...blank(),
          ...p,
          category_id: p.category_id || '',
          has_pack: hasPack(p),
          pack_unit: p.pack_unit || 'carton',
          pack_size: hasPack(p) ? p.pack_size : '',
          wholesale_price: p.wholesale_price || '',
          cost_price: p.cost_price ?? '',
          active: !!p.active,
        };
      } catch (e) {
        toastError(e);
        emit('close');
      }
    };
    onMounted(load);

    const n = (v) => {
      const x = parseNum(v);
      return Number.isFinite(x) ? x : 0;
    };
    const asProduct = computed(() => ({
      unit: f.value.unit || 'pièce',
      pack_unit: f.value.has_pack ? f.value.pack_unit : null,
      pack_size: f.value.has_pack ? n(f.value.pack_size) : 1,
      retail_price: n(f.value.retail_price),
      wholesale_price: n(f.value.wholesale_price),
      cost_price: n(f.value.cost_price),
      stock: n(f.value.stock),
      min_stock: n(f.value.min_stock),
    }));
    const hints = computed(() => {
      const p = asProduct.value;
      const out = {};
      const size = hasPack(p) ? p.pack_size : 1;
      if (p.wholesale_price > 0) {
        const perUnit = p.wholesale_price / size;
        out.wholesalePerUnit = `Soit ${money(perUnit)} par ${p.unit}`;
        if (p.retail_price > 0) {
          const diff = ((perUnit - p.retail_price) / p.retail_price) * 100;
          out.wholesalePerUnit += diff < 0 ? ` (${percent(-diff)} moins cher qu'au détail)` : diff > 0 ? ' — plus cher qu’au détail !' : '';
        }
        if (p.cost_price > 0 && perUnit < p.cost_price) out.wholesaleLoss = 'Attention : le prix de gros est inférieur au prix d’achat.';
      } else if (hasPack(p) && p.retail_price > 0) {
        out.wholesalePerUnit = `Sans prix de gros, le ${p.pack_unit} sera vendu ${money(p.retail_price * size)}.`;
      }
      if (p.cost_price > 0) {
        if (hasPack(p)) out.cost = `Soit ${money(p.cost_price * size)} le ${p.pack_unit}`;
        if (p.retail_price > 0) {
          const m = p.retail_price - p.cost_price;
          out.margin = `Bénéfice au détail : ${money(m)} par ${p.unit} (${percent((m / p.retail_price) * 100)})`;
          if (m < 0) out.retailLoss = true;
        }
      }
      return out;
    });

    const addCategory = async () => {
      const name = newCategory.value.trim();
      if (!name) return;
      try {
        const c = await api.post('/categories', { name });
        await loadProducts();
        f.value.category_id = c.id;
        newCategory.value = '';
      } catch (e) {
        toastError(e);
      }
    };

    const save = async () => {
      const v = f.value;
      if (v.has_pack && !(n(v.pack_size) > 1)) return toast(`Indiquez combien de ${plural(v.unit, 2)} contient un ${v.pack_unit}.`, 'error');
      const body = {
        name: v.name,
        barcode: v.barcode,
        category_id: v.category_id || null,
        unit: v.unit,
        retail_price: n(v.retail_price),
        pack_unit: v.has_pack ? v.pack_unit : null,
        pack_size: v.has_pack ? n(v.pack_size) : 1,
        wholesale_price: n(v.wholesale_price),
        cost_price: n(v.cost_price),
        min_stock: n(v.min_stock),
        active: v.active,
      };
      if (isNew) body.stock = n(v.stock);
      busy.value = true;
      try {
        if (isNew) await api.post('/products', body);
        else await api.put(`/products/${props.id}`, body);
        await loadProducts();
        toast(isNew ? 'Produit ajouté.' : 'Produit enregistré.', 'success');
        emit('close');
      } catch (e) {
        toastError(e);
      } finally {
        busy.value = false;
      }
    };
    const archive = async () => {
      const ok = await ask({
        title: `Retirer « ${product.value.name} » de la vente ?`,
        message: 'Le produit n’apparaîtra plus en caisse. Son historique de ventes est conservé dans les rapports.',
        confirm: 'Retirer de la vente',
        danger: true,
      });
      if (!ok) return;
      try {
        const r = await api.del(`/products/${props.id}`);
        await loadProducts();
        toast(r.deleted ? 'Produit supprimé.' : 'Produit retiré de la vente.', 'success');
        emit('close');
      } catch (e) {
        toastError(e);
      }
    };
    return { isNew, f, product, busy, newCategory, canEdit, hints, asProduct, addCategory, save, archive, store, can, UNITS, PACKS, MOVE, money, qty, plural, stockText, dateTimeFr, hasPack, listPrice, round3 };
  },
  template: `
    <Sheet :title="isNew ? 'Nouveau produit' : (f.name || 'Produit')" size="wide" @close="$emit('close')">
      <form id="product-form" @submit.prevent="save">
        <fieldset :disabled="!canEdit" style="border:0;padding:0;margin:0">
        <div class="form-section">
          <h3>Le produit</h3>
          <div class="form-grid">
            <div class="field span-2"><label for="p-name">Nom du produit</label><input id="p-name" class="input" v-model="f.name" required maxlength="120" placeholder="Ex. : Huile végétale 1 L" /></div>
            <div class="field"><label for="p-cat">Rayon / catégorie</label>
              <select id="p-cat" class="select" v-model="f.category_id"><option value="">Sans rayon</option><option v-for="c in store.categories" :key="c.id" :value="c.id">{{ c.name }}</option></select>
            </div>
            <div class="field"><label for="p-newcat">Nouveau rayon</label>
              <div class="row"><input id="p-newcat" class="input" v-model="newCategory" placeholder="Ex. : Boissons" @keydown.enter.prevent="addCategory" /><button type="button" class="btn" @click="addCategory" :disabled="!newCategory.trim()">Créer</button></div>
            </div>
            <div class="field span-2"><label for="p-code">Code-barres <span class="faint">(facultatif)</span></label><input id="p-code" class="input" v-model="f.barcode" maxlength="64" placeholder="Scannez ou tapez le code" autocomplete="off" /></div>
          </div>
        </div>

        <div class="form-section">
          <h3><span class="badge retail">Détail</span> Vente à l'unité</h3>
          <div class="form-grid">
            <div class="field"><label for="p-unit">Unité de vente au détail</label><input id="p-unit" class="input" v-model="f.unit" list="units" required maxlength="20" /><datalist id="units"><option v-for="u in UNITS" :key="u" :value="u"></option></datalist></div>
            <div class="field"><label for="p-retail">Prix de détail (par {{ f.unit || 'unité' }})</label><div class="input-affix"><input id="p-retail" class="input num with-end" v-model="f.retail_price" inputmode="decimal" required style="padding-left:12px" /><span class="affix-end">{{ store.settings.currency }}</span></div>
              <span class="hint warn" v-if="hints.retailLoss">Le prix de détail est inférieur au prix d'achat.</span></div>
          </div>
        </div>

        <div class="form-section">
          <h3><span class="badge wholesale">Gros</span> Vente en gros</h3>
          <label class="check"><input type="checkbox" v-model="f.has_pack" /><span>Ce produit se vend aussi par colis (carton, sac, balle…)<small>Le stock est compté en {{ plural(f.unit || 'unité', 2) }} ; un colis vendu retire toute sa contenance.</small></span></label>
          <div class="form-grid">
            <template v-if="f.has_pack">
              <div class="field"><label for="p-pack">Unité de gros</label><input id="p-pack" class="input" v-model="f.pack_unit" list="packs" maxlength="20" /><datalist id="packs"><option v-for="u in PACKS" :key="u" :value="u"></option></datalist></div>
              <div class="field"><label for="p-size">Nombre de {{ plural(f.unit || 'unité', 2) }} dans 1 {{ f.pack_unit || 'colis' }}</label><input id="p-size" class="input num" v-model="f.pack_size" inputmode="decimal" placeholder="Ex. : 12" /></div>
            </template>
            <div class="field" :class="{ 'span-2': !f.has_pack }"><label for="p-wholesale">Prix de gros (par {{ f.has_pack ? (f.pack_unit || 'colis') : (f.unit || 'unité') }})</label>
              <div class="input-affix"><input id="p-wholesale" class="input num with-end" v-model="f.wholesale_price" inputmode="decimal" placeholder="Facultatif" style="padding-left:12px" /><span class="affix-end">{{ store.settings.currency }}</span></div>
              <span class="hint" v-if="hints.wholesalePerUnit">{{ hints.wholesalePerUnit }}</span>
              <span class="hint warn" v-if="hints.wholesaleLoss">{{ hints.wholesaleLoss }}</span>
            </div>
          </div>
        </div>

        <div class="form-section">
          <h3>Achat et stock</h3>
          <div class="form-grid">
            <div class="field" v-if="can('cost.view')"><label for="p-cost">Prix d'achat (par {{ f.unit || 'unité' }})</label>
              <div class="input-affix"><input id="p-cost" class="input num with-end" v-model="f.cost_price" inputmode="decimal" style="padding-left:12px" /><span class="affix-end">{{ store.settings.currency }}</span></div>
              <span class="hint" v-if="hints.cost">{{ hints.cost }}</span>
              <span class="hint" v-if="hints.margin">{{ hints.margin }}</span>
            </div>
            <div class="field"><span class="label">Seuil d'alerte (stock minimum)</span><PackQtyInput :product="asProduct" v-model="f.min_stock" /></div>
            <div class="field span-2" v-if="isNew"><span class="label">Stock de départ</span><PackQtyInput :product="asProduct" v-model="f.stock" /></div>
          </div>
          <label class="check" v-if="!isNew"><input type="checkbox" v-model="f.active" /><span>En vente<small>Décochez pour masquer le produit en caisse sans perdre son historique.</small></span></label>
        </div>
        </fieldset>
      </form>

      <div v-if="product" class="stack" style="margin-top:8px">
        <div class="row between">
          <h3>Stock actuel : {{ stockText(product) }}</h3>
          <a v-if="can('stock.manage')" class="btn sm" :href="'#/stock?onglet=inventaire&produit=' + product.id">Ajuster le stock</a>
        </div>
        <div v-if="product.movements && product.movements.length" class="table-wrap" style="border:1px solid var(--line)">
          <table class="table compact-table">
            <thead><tr><th>Date</th><th>Mouvement</th><th class="num">Quantité</th><th class="num">Stock après</th><th>Par</th></tr></thead>
            <tbody>
              <tr v-for="m in product.movements" :key="m.id">
                <td class="nowrap">{{ dateTimeFr(m.created_at) }}</td>
                <td>{{ MOVE[m.type] || m.type }}<span v-if="m.ref_id && (m.type === 'sale' || m.type === 'cancel')"> n° {{ m.ref_id }}</span><div class="cell-sub" v-if="m.reason">{{ m.reason }}</div></td>
                <td class="num" :style="{ color: m.qty < 0 ? 'var(--credit-ink)' : 'var(--paid-ink)' }">{{ m.qty > 0 ? '+' : '' }}{{ qty(m.qty) }}</td>
                <td class="num">{{ qty(m.stock_after) }}</td>
                <td>{{ m.user_name || '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <template #foot>
        <button v-if="!isNew && canEdit" type="button" class="btn danger" style="margin-right:auto" @click="archive">Retirer de la vente</button>
        <button type="button" class="btn" @click="$emit('close')">{{ canEdit ? 'Annuler' : 'Fermer' }}</button>
        <button v-if="canEdit" type="submit" form="product-form" class="btn primary" :class="{ loading: busy }" :disabled="busy">Enregistrer</button>
      </template>
    </Sheet>`,
};

const ImportDialog = {
  components: { Icon, Sheet },
  emits: ['close'],
  setup() {
    const file = ref(null);
    const text = ref('');
    const update = ref(true);
    const busy = ref(false);
    const result = ref(null);
    const onFile = async (ev) => {
      const f = ev.target.files?.[0];
      file.value = f || null;
      result.value = null;
      if (!f) return;
      const buf = await f.arrayBuffer();
      let s = new TextDecoder('utf-8').decode(buf);
      if (s.includes('�')) s = new TextDecoder('windows-1252').decode(buf); // fichier Excel « CSV (séparateur : point-virgule) »
      text.value = s;
    };
    const run = async () => {
      busy.value = true;
      try {
        result.value = await api.post('/products/import', { csv: text.value, update_existing: update.value });
        await loadProducts();
      } catch (e) {
        toastError(e);
      } finally {
        busy.value = false;
      }
    };
    return { file, text, update, busy, result, onFile, run, template: api.url('/export/products-template.csv') };
  },
  template: `
    <Sheet title="Importer des produits" @close="$emit('close')">
      <div class="stack">
        <ol class="steps">
          <li>Téléchargez le <a :href="template">modèle Excel (CSV)</a> et remplissez une ligne par produit.</li>
          <li>Dans Excel : <b>Fichier › Enregistrer sous › CSV (séparateur : point-virgule)</b>.</li>
          <li>Choisissez le fichier ci-dessous. Les produits qui existent déjà (même nom ou même code) sont mis à jour ; une case vide garde la valeur actuelle.</li>
        </ol>
        <input type="file" accept=".csv,text/csv,text/plain" class="input" @change="onFile" />
        <label class="check"><input type="checkbox" v-model="update" /><span>Mettre à jour les produits existants</span></label>
        <div v-if="result" class="alert" :class="result.errors.length ? 'danger' : 'ok'">
          <Icon :name="result.errors.length ? 'alert' : 'check'" />
          <div>
            <b>{{ result.created }} créé(s), {{ result.updated }} mis à jour</b><span v-if="result.skipped">, {{ result.skipped }} ignoré(s)</span>.
            <ul v-if="result.errors.length" style="margin:6px 0 0;padding-left:18px"><li v-for="e in result.errors.slice(0, 20)" :key="e.line">Ligne {{ e.line }} : {{ e.message }}</li></ul>
          </div>
        </div>
      </div>
      <template #foot>
        <button type="button" class="btn" @click="$emit('close')">Fermer</button>
        <button type="button" class="btn primary" :class="{ loading: busy }" :disabled="!text || busy" @click="run"><Icon name="upload" />Importer</button>
      </template>
    </Sheet>`,
};

const CategoriesDialog = {
  components: { Icon, Sheet },
  emits: ['close'],
  setup() {
    const name = ref('');
    const add = async () => {
      if (!name.value.trim()) return;
      try {
        await api.post('/categories', { name: name.value });
        name.value = '';
        await loadProducts();
      } catch (e) {
        toastError(e);
      }
    };
    const rename = async (c) => {
      const v = await ask({ title: 'Renommer le rayon', input: { label: 'Nom', value: c.name, required: true }, confirm: 'Renommer' });
      if (!v) return;
      try {
        await api.put(`/categories/${c.id}`, { name: v });
        await loadProducts();
      } catch (e) {
        toastError(e);
      }
    };
    const remove = async (c) => {
      if (!(await ask({ title: `Supprimer « ${c.name} » ?`, message: 'Les produits de ce rayon resteront en vente, sans rayon.', confirm: 'Supprimer', danger: true }))) return;
      try {
        await api.del(`/categories/${c.id}`);
        await loadProducts();
      } catch (e) {
        toastError(e);
      }
    };
    return { store, name, add, rename, remove };
  },
  template: `
    <Sheet title="Rayons" size="narrow" @close="$emit('close')">
      <div class="stack">
        <form class="row" @submit.prevent="add"><input class="input" v-model="name" placeholder="Nouveau rayon" /><button class="btn primary" :disabled="!name.trim()">Ajouter</button></form>
        <div class="list" style="border:1px solid var(--line)">
          <div v-for="c in store.categories" :key="c.id" class="list-row">
            <div class="main-col"><div class="title">{{ c.name }}</div><div class="sub">{{ c.products }} produit(s)</div></div>
            <button type="button" class="icon-btn sm" @click="rename(c)" :aria-label="'Renommer ' + c.name"><Icon name="edit" size="sm" /></button>
            <button type="button" class="icon-btn sm" @click="remove(c)" :aria-label="'Supprimer ' + c.name"><Icon name="trash" size="sm" /></button>
          </div>
          <p v-if="!store.categories.length" class="small muted" style="padding:16px">Aucun rayon pour l'instant.</p>
        </div>
      </div>
    </Sheet>`,
};

export default {
  components: { Icon, Empty, Skeleton, ProductEditor, ImportDialog, CategoriesDialog },
  setup() {
    const q = ref('');
    const category = ref('');
    const filter = ref(route.query.filtre === 'bas' ? 'low' : 'all');
    const archived = ref(null);
    const showImport = ref(false);
    const showCats = ref(false);
    const loadArchived = async () => {
      try {
        archived.value = (await api.get('/products', { all: 1 })).filter((p) => !p.active);
      } catch (e) {
        toastError(e);
      }
    };
    watch(filter, (v) => {
      if (v === 'archived') loadArchived();
    });
    onMounted(() => {
      if (!store.productsLoaded) loadProducts().catch(toastError);
    });
    const source = computed(() => (filter.value === 'archived' ? archived.value || [] : store.products));
    const rows = computed(() => {
      const words = norm(q.value).split(/\s+/).filter(Boolean);
      return source.value.filter((p) => {
        if (category.value && p.category_id !== Number(category.value)) return false;
        if (filter.value === 'low' && stockLevel(p) === 'ok') return false;
        if (filter.value === 'out' && stockLevel(p) !== 'out') return false;
        if (!words.length) return true;
        const hay = norm(`${p.name} ${p.barcode || ''} ${p.category_name || ''}`);
        return words.every((w) => hay.includes(w));
      });
    });
    const counts = computed(() => ({
      low: store.products.filter((p) => stockLevel(p) !== 'ok').length,
      out: store.products.filter((p) => stockLevel(p) === 'out').length,
    }));
    const editId = computed(() => route.query.produit);
    const open = (id) => setQuery({ produit: id });
    const close = () => setQuery({ produit: undefined });
    const margin = (p) => (p.retail_price > 0 && p.cost_price > 0 ? ((p.retail_price - p.cost_price) / p.retail_price) * 100 : null);
    const isPhone = useMedia('(max-width: 760px)');
    return { store, q, category, filter, rows, counts, editId, open, close, showImport, showCats, isPhone, can, money, plural, percent, margin, hasPack, listPrice, sellsWholesale, stockText, stockLevel, exportUrl: api.url('/export/products.csv') };
  },
  template: `
    <div class="page">
      <div class="page-head">
        <h1>Produits</h1>
        <template v-if="can('products.manage')">
          <button type="button" class="btn" @click="showCats = true"><Icon name="tag" />Rayons</button>
          <button type="button" class="btn hide-phone" @click="showImport = true"><Icon name="upload" />Importer</button>
          <a class="btn hide-phone" :href="exportUrl"><Icon name="download" />Exporter</a>
          <button type="button" class="btn primary" @click="open('nouveau')"><Icon name="plus" />Nouveau produit</button>
        </template>
      </div>
      <div class="toolbar">
        <div class="input-affix search"><Icon name="search" /><input class="input" v-model="q" placeholder="Nom, code-barres ou rayon" /></div>
        <select class="select" style="width:auto" v-model="category" aria-label="Rayon">
          <option value="">Tous les rayons</option>
          <option v-for="c in store.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>
      <div class="toolbar chips">
        <button type="button" class="chip" :class="{ on: filter === 'all' }" @click="filter = 'all'">En vente<span class="n">{{ store.products.length }}</span></button>
        <button type="button" class="chip" :class="{ on: filter === 'low' }" @click="filter = 'low'">Stock bas<span class="n">{{ counts.low }}</span></button>
        <button type="button" class="chip" :class="{ on: filter === 'out' }" @click="filter = 'out'">Rupture<span class="n">{{ counts.out }}</span></button>
        <button v-if="can('products.manage')" type="button" class="chip" :class="{ on: filter === 'archived' }" @click="filter = 'archived'">Retirés de la vente</button>
      </div>

      <Skeleton v-if="!store.productsLoaded" />
      <div v-else-if="rows.length && isPhone" class="list">
        <button v-for="p in rows" :key="p.id" type="button" class="list-row" @click="open(p.id)">
          <div class="main-col">
            <div class="title">{{ p.name }}</div>
            <div class="sub"><span :style="stockLevel(p) !== 'ok' ? 'color:var(--credit-ink);font-weight:600' : ''">{{ stockLevel(p) === 'out' ? 'Rupture' : stockText(p) }}</span><template v-if="hasPack(p)"> · 1 {{ p.pack_unit }} = {{ p.pack_size }} {{ plural(p.unit, p.pack_size) }}</template></div>
          </div>
          <div class="end">
            <div class="price-line retail" style="justify-content:flex-end"><i class="k"></i><b>{{ money(p.retail_price, { bare: true }) }}</b>/ {{ p.unit }}</div>
            <div v-if="sellsWholesale(p)" class="price-line wholesale" style="justify-content:flex-end"><i class="k"></i><b>{{ money(listPrice(p, 'wholesale'), { bare: true }) }}</b>/ {{ hasPack(p) ? p.pack_unit : p.unit }}</div>
          </div>
        </button>
      </div>
      <div v-else-if="rows.length" class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>Produit</th><th class="hide-phone">Rayon</th><th class="num">Prix détail</th><th class="num">Prix gros</th><th class="num">Stock</th>
            <th class="num hide-phone" v-if="can('cost.view')">Achat</th><th class="num hide-phone" v-if="can('cost.view')">Bénéfice détail</th>
          </tr></thead>
          <tbody>
            <tr v-for="p in rows" :key="p.id" class="click" @click="open(p.id)">
              <td><div class="cell-title">{{ p.name }}</div><div class="cell-sub">{{ p.barcode || '' }}<template v-if="hasPack(p)">{{ p.barcode ? ' · ' : '' }}1 {{ p.pack_unit }} = {{ p.pack_size }} {{ plural(p.unit, p.pack_size) }}</template></div></td>
              <td class="hide-phone">{{ p.category_name || '—' }}</td>
              <td class="num">{{ money(p.retail_price, { bare: true }) }}<div class="cell-sub">/ {{ p.unit }}</div></td>
              <td class="num"><template v-if="sellsWholesale(p)">{{ money(listPrice(p, 'wholesale'), { bare: true }) }}<div class="cell-sub">/ {{ hasPack(p) ? p.pack_unit : p.unit }}</div></template><span v-else class="faint">—</span></td>
              <td class="num"><span :class="{ badge: stockLevel(p) !== 'ok', danger: stockLevel(p) === 'low', 'solid-danger': stockLevel(p) === 'out' }">{{ stockLevel(p) === 'out' ? 'Rupture' : stockText(p) }}</span></td>
              <td class="num hide-phone" v-if="can('cost.view')">{{ money(p.cost_price, { bare: true }) }}</td>
              <td class="num hide-phone" v-if="can('cost.view')">{{ margin(p) === null ? '—' : percent(margin(p)) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <Empty v-else icon="box" :title="q ? 'Aucun produit trouvé' : 'Aucun produit ici'" :text="can('products.manage') && !store.products.length ? 'Ajoutez vos produits un par un, ou importez votre liste depuis Excel.' : ''">
        <div class="row" v-if="can('products.manage') && !store.products.length">
          <button type="button" class="btn" @click="showImport = true"><Icon name="upload" />Importer depuis Excel</button>
          <button type="button" class="btn primary" @click="open('nouveau')"><Icon name="plus" />Nouveau produit</button>
        </div>
      </Empty>

      <ProductEditor v-if="editId" :id="editId" :key="editId" @close="close" />
      <ImportDialog v-if="showImport" @close="showImport = false" />
      <CategoriesDialog v-if="showCats" @close="showCats = false" />
    </div>`,
};
