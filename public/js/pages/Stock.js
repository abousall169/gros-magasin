// Stock : réceptions de marchandises, inventaire / ajustements, mouvements, fournisseurs.
import { ref, computed, watch, onMounted } from '../vue.js';
import { api } from '../api.js';
import { store, can, toast, toastError, ask, loadProducts } from '../store.js';
import { money, qty, plural, parseNum, round3, roundMoney, hasPack, stockText, stockLevel, dateTimeFr, when } from '../format.js';
import { route, setQuery } from '../router.js';
import { Icon, Sheet, Empty, Skeleton, PeriodPicker, periodRange, ProductSearch, PackQtyInput } from '../components/ui.js';

const MOVE = { sale: 'Vente', cancel: 'Annulation', purchase: 'Réception', adjust: 'Ajustement', initial: 'Stock initial' };

// ---- Nouvelle réception -------------------------------------------------------------
const ReceptionForm = {
  components: { Icon, Sheet, ProductSearch },
  props: { suppliers: Array },
  emits: ['close', 'saved', 'supplier'],
  setup(props, { emit }) {
    const f = ref({ supplier_id: '', reference: '', note: '', update_cost: true, items: [] });
    const busy = ref(false);
    const addProduct = (p) => {
      const pack = hasPack(p);
      f.value.items.push({
        product: p,
        unit_type: pack ? 'pack' : 'unit',
        qty: '',
        unit_cost: p.cost_price ? String(roundMoney(p.cost_price * (pack ? p.pack_size : 1))) : '',
      });
    };
    const setType = (it, t) => {
      if (it.unit_type === t) return;
      const c = parseNum(it.unit_cost);
      if (c > 0 && hasPack(it.product)) it.unit_cost = String(roundMoney(t === 'pack' ? c * it.product.pack_size : c / it.product.pack_size));
      it.unit_type = t;
    };
    const lineTotal = (it) => roundMoney((parseNum(it.qty) || 0) * (parseNum(it.unit_cost) || 0));
    const total = computed(() => f.value.items.reduce((s, it) => s + lineTotal(it), 0));
    const newSupplier = async () => {
      const name = await ask({ title: 'Nouveau fournisseur', input: { label: 'Nom du fournisseur', required: true }, confirm: 'Ajouter' });
      if (!name) return;
      try {
        const s = await api.post('/suppliers', { name });
        emit('supplier', s);
        f.value.supplier_id = s.id;
      } catch (e) {
        toastError(e);
      }
    };
    const save = async () => {
      const v = f.value;
      if (!v.items.length) return toast('Ajoutez au moins un produit.', 'error');
      const bad = v.items.find((it) => !(parseNum(it.qty) > 0));
      if (bad) return toast(`Quantité manquante pour « ${bad.product.name} ».`, 'error');
      busy.value = true;
      try {
        await api.post('/purchases', {
          supplier_id: v.supplier_id || null,
          reference: v.reference,
          note: v.note,
          update_cost: v.update_cost,
          items: v.items.map((it) => ({ product_id: it.product.id, unit_type: it.unit_type, qty: parseNum(it.qty), unit_cost: parseNum(it.unit_cost) || 0 })),
        });
        await loadProducts();
        toast('Réception enregistrée, stock mis à jour.', 'success');
        emit('saved');
      } catch (e) {
        toastError(e);
      } finally {
        busy.value = false;
      }
    };
    return { f, busy, addProduct, setType, lineTotal, total, newSupplier, save, can, store, money, plural, hasPack, stockText, qty };
  },
  template: `
    <Sheet title="Réception de marchandises" size="wide" @close="$emit('close')">
      <form id="reception" class="stack loose" @submit.prevent="save">
        <div class="form-grid">
          <div class="field"><label for="r-sup">Fournisseur</label>
            <div class="row"><select id="r-sup" class="select" v-model="f.supplier_id"><option value="">Sans fournisseur</option><option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }}</option></select>
            <button type="button" class="btn" @click="newSupplier" aria-label="Nouveau fournisseur"><Icon name="plus" /></button></div>
          </div>
          <div class="field"><label for="r-ref">N° de bon de livraison / facture</label><input id="r-ref" class="input" v-model="f.reference" maxlength="80" placeholder="Facultatif" /></div>
        </div>
        <div class="field"><span class="label">Ajouter un produit reçu</span><ProductSearch @pick="addProduct" /></div>
        <div v-if="f.items.length" class="list" style="border:1px solid var(--line)">
          <div v-for="(it, i) in f.items" :key="i" class="list-row" style="flex-wrap:wrap">
            <div class="main-col" style="min-width:180px"><div class="title">{{ it.product.name }}</div><div class="sub">Stock actuel : {{ stockText(it.product) }}</div></div>
            <div class="seg" v-if="hasPack(it.product)">
              <button type="button" :class="{ on: it.unit_type === 'pack' }" @click="setType(it, 'pack')">{{ plural(it.product.pack_unit, 2) }}</button>
              <button type="button" :class="{ on: it.unit_type === 'unit' }" @click="setType(it, 'unit')">{{ plural(it.product.unit, 2) }}</button>
            </div>
            <div class="field" style="width:96px"><label class="xsmall">Quantité</label><input class="input num" v-model="it.qty" inputmode="decimal" placeholder="0" /></div>
            <div class="field" style="width:130px" v-if="can('cost.view')"><label class="xsmall">Prix d'achat / {{ it.unit_type === 'pack' ? it.product.pack_unit : it.product.unit }}</label><input class="input num" v-model="it.unit_cost" inputmode="decimal" /></div>
            <div class="num strong" style="width:110px;text-align:right" v-if="can('cost.view')">{{ money(lineTotal(it), { bare: true }) }}</div>
            <button type="button" class="icon-btn sm" @click="f.items.splice(i, 1)" aria-label="Retirer"><Icon name="trash" size="sm" /></button>
          </div>
        </div>
        <div class="row between" v-if="f.items.length && can('cost.view')">
          <label class="check"><input type="checkbox" v-model="f.update_cost" /><span>Mettre à jour le prix d'achat des produits<small>Le dernier prix payé sert au calcul du bénéfice.</small></span></label>
          <div class="right"><div class="xsmall faint">Total de la réception</div><div class="strong num" style="font-size:1.4375rem">{{ money(total) }}</div></div>
        </div>
        <div class="field"><label for="r-note">Remarque</label><input id="r-note" class="input" v-model="f.note" maxlength="300" placeholder="Facultatif" /></div>
      </form>
      <template #foot>
        <button type="button" class="btn" @click="$emit('close')">Annuler</button>
        <button type="submit" form="reception" class="btn primary" :class="{ loading: busy }" :disabled="busy || !f.items.length">Enregistrer la réception</button>
      </template>
    </Sheet>`,
};

const PurchaseDetail = {
  components: { Sheet, Skeleton },
  props: { id: [Number, String] },
  emits: ['close'],
  setup(props) {
    const p = ref(null);
    onMounted(async () => {
      try {
        p.value = await api.get(`/purchases/${props.id}`);
      } catch (e) {
        toastError(e);
      }
    });
    return { p, money, qty, plural, dateTimeFr };
  },
  template: `
    <Sheet :title="'Réception du ' + (p ? dateTimeFr(p.created_at) : '')" size="wide" @close="$emit('close')">
      <Skeleton v-if="!p" :rows="3" />
      <div v-else class="stack">
        <p class="muted small">{{ p.supplier_name || 'Sans fournisseur' }}<template v-if="p.reference"> · Réf. {{ p.reference }}</template> · saisie par {{ p.user_name }}</p>
        <table class="table">
          <thead><tr><th>Produit</th><th class="num">Quantité</th><th class="num">Prix d'achat</th><th class="num">Total</th></tr></thead>
          <tbody><tr v-for="it in p.items" :key="it.id"><td class="cell-title">{{ it.name }}</td><td class="num">{{ qty(it.qty) }} {{ plural(it.unit_label, it.qty) }}</td><td class="num">{{ money(it.unit_cost, { bare: true }) }}</td><td class="num">{{ money(it.total, { bare: true }) }}</td></tr></tbody>
          <tfoot><tr><td colspan="3">Total</td><td class="num">{{ money(p.total) }}</td></tr></tfoot>
        </table>
        <p v-if="p.note" class="small">{{ p.note }}</p>
      </div>
    </Sheet>`,
};

// ---- Inventaire / ajustement ----------------------------------------------------------
const Adjust = {
  components: { Icon, ProductSearch, PackQtyInput },
  setup() {
    const product = ref(null);
    const mode = ref('set');
    const amount = ref(0);
    const reason = ref('Inventaire');
    const note = ref('');
    const reasons = ref(['Inventaire', 'Perte / casse', 'Produit périmé', 'Usage interne', 'Retour fournisseur', 'Correction', 'Autre']);
    const busy = ref(false);
    const pick = (p) => {
      product.value = store.products.find((x) => x.id === p.id) || p;
      amount.value = mode.value === 'set' ? Number(product.value.stock) || 0 : 0;
    };
    onMounted(async () => {
      try {
        reasons.value = await api.get('/stock/reasons');
      } catch {
        /* liste par défaut */
      }
      const id = Number(route.query.produit);
      if (id) {
        if (!store.productsLoaded) await loadProducts();
        const p = store.products.find((x) => x.id === id);
        if (p) pick(p);
      }
    });
    watch(mode, (m) => {
      if (product.value) amount.value = m === 'set' ? Number(product.value.stock) || 0 : 0;
      reason.value = m === 'set' ? 'Inventaire' : m === 'remove' ? 'Perte / casse' : 'Correction';
    });
    const preview = computed(() => {
      if (!product.value) return null;
      const cur = Number(product.value.stock) || 0;
      const a = Number(amount.value) || 0;
      const after = mode.value === 'set' ? a : mode.value === 'add' ? cur + a : cur - a;
      return { cur, after: round3(after), delta: round3(after - cur) };
    });
    const save = async () => {
      if (!product.value || !preview.value || preview.value.delta === 0) return toast('Aucun changement de stock.', 'error');
      busy.value = true;
      try {
        await api.post('/stock/adjust', { product_id: product.value.id, mode: mode.value, qty: amount.value, reason: reason.value, note: note.value });
        await loadProducts();
        toast(`Stock de « ${product.value.name} » mis à jour.`, 'success');
        product.value = store.products.find((x) => x.id === product.value.id) || null;
        amount.value = product.value ? Number(product.value.stock) : 0;
        note.value = '';
        mode.value = 'set';
      } catch (e) {
        toastError(e);
      } finally {
        busy.value = false;
      }
    };
    const lowList = computed(() => store.products.filter((p) => stockLevel(p) !== 'ok').slice(0, 30));
    return { product, mode, amount, reason, note, reasons, busy, pick, preview, save, lowList, stockText, stockLevel, qty };
  },
  template: `
    <div class="cols">
      <section class="panel">
        <div class="panel-head"><h2>Compter ou corriger un stock</h2></div>
        <div class="stack loose">
          <ProductSearch @pick="pick" placeholder="Quel produit ? (nom ou code)" />
          <template v-if="product">
            <div class="alert"><Icon name="box" /><div><b>{{ product.name }}</b><br>Stock enregistré : {{ stockText(product) }}</div></div>
            <div class="seg block">
              <button type="button" :class="{ on: mode === 'set' }" @click="mode = 'set'">J'ai compté</button>
              <button type="button" :class="{ on: mode === 'add' }" @click="mode = 'add'">Ajouter</button>
              <button type="button" :class="{ on: mode === 'remove' }" @click="mode = 'remove'">Retirer</button>
            </div>
            <div class="field"><span class="label">{{ mode === 'set' ? 'Quantité réellement en magasin' : mode === 'add' ? 'Quantité à ajouter' : 'Quantité à retirer' }}</span><PackQtyInput :product="product" v-model="amount" /></div>
            <div class="form-grid">
              <div class="field"><label for="adj-reason">Motif</label><select id="adj-reason" class="select" v-model="reason"><option v-for="r in reasons" :key="r">{{ r }}</option></select></div>
              <div class="field"><label for="adj-note">Précision</label><input id="adj-note" class="input" v-model="note" maxlength="200" placeholder="Facultatif" /></div>
            </div>
            <div v-if="preview" class="pay-summary">
              <div class="sum-row"><span>Nouveau stock</span><b>{{ stockText(product, preview.after) }}</b></div>
              <div class="sum-row"><span>Différence</span><b :style="{ color: preview.delta < 0 ? 'var(--credit-ink)' : 'var(--paid-ink)' }">{{ preview.delta > 0 ? '+' : '' }}{{ qty(preview.delta) }} {{ product.unit }}</b></div>
            </div>
            <button type="button" class="btn primary lg" :class="{ loading: busy }" :disabled="busy || !preview || preview.delta === 0" @click="save">Enregistrer le stock</button>
          </template>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Stock bas ou en rupture</h2></div>
        <div v-if="lowList.length" class="list">
          <button v-for="p in lowList" :key="p.id" type="button" class="list-row" @click="pick(p)">
            <div class="main-col"><div class="title">{{ p.name }}</div><div class="sub">Seuil : {{ stockText(p, p.min_stock) }}</div></div>
            <span class="badge" :class="stockLevel(p) === 'out' ? 'solid-danger' : 'danger'">{{ stockLevel(p) === 'out' ? 'Rupture' : stockText(p) }}</span>
          </button>
        </div>
        <p v-else class="small muted">Tous les produits sont au-dessus de leur seuil d'alerte.</p>
      </section>
    </div>`,
};

// ---- Page -------------------------------------------------------------------------------
export default {
  components: { Icon, Sheet, Empty, Skeleton, PeriodPicker, ReceptionForm, PurchaseDetail, Adjust },
  setup() {
    const tab = computed(() => route.query.onglet || 'receptions');
    const setTab = (t) => setQuery({ onglet: t, produit: undefined });
    const period = ref({ id: '7d', ...periodRange('7d') });
    const purchases = ref(null);
    const movements = ref(null);
    const moveType = ref('');
    const suppliers = ref([]);
    const showForm = ref(false);
    const detailId = ref(null);
    const editSupplier = ref(null);

    const loadPurchases = async () => {
      try {
        purchases.value = await api.get('/purchases', { from: period.value.from, to: period.value.to });
      } catch (e) {
        toastError(e);
      }
    };
    const loadMovements = async () => {
      try {
        movements.value = await api.get('/stock/movements', { from: period.value.from, to: period.value.to, type: moveType.value });
      } catch (e) {
        toastError(e);
      }
    };
    const loadSuppliers = async () => {
      try {
        suppliers.value = await api.get('/suppliers');
      } catch (e) {
        toastError(e);
      }
    };
    const refresh = () => {
      if (tab.value === 'receptions') loadPurchases();
      if (tab.value === 'mouvements') loadMovements();
    };
    watch([tab, period, moveType], refresh, { deep: true });
    onMounted(() => {
      refresh();
      loadSuppliers();
      if (!store.productsLoaded) loadProducts().catch(toastError);
    });
    const saved = () => {
      showForm.value = false;
      loadPurchases();
    };
    const supplierAdded = (s) => suppliers.value.push(s);
    const saveSupplier = async () => {
      const s = editSupplier.value;
      try {
        if (s.id) await api.put(`/suppliers/${s.id}`, s);
        else await api.post('/suppliers', s);
        editSupplier.value = null;
        loadSuppliers();
      } catch (e) {
        toastError(e);
      }
    };
    const removeSupplier = async (s) => {
      if (!(await ask({ title: `Supprimer ${s.name} ?`, message: 'Ses anciennes réceptions restent dans l’historique.', confirm: 'Supprimer', danger: true }))) return;
      try {
        await api.del(`/suppliers/${s.id}`);
        loadSuppliers();
      } catch (e) {
        toastError(e);
      }
    };
    const fmtMove = (m) => {
      const p = { unit: m.unit, pack_unit: m.pack_unit, pack_size: m.pack_size };
      return `${m.qty > 0 ? '+' : '−'}${stockText(p, Math.abs(m.qty))}`;
    };
    return { tab, setTab, period, purchases, movements, moveType, suppliers, showForm, detailId, editSupplier, saved, supplierAdded, saveSupplier, removeSupplier, fmtMove, MOVE, can, money, qty, when, dateTimeFr, stockText };
  },
  template: `
    <div class="page">
      <div class="page-head">
        <h1>Stock & réceptions</h1>
        <button v-if="tab === 'receptions'" type="button" class="btn primary" @click="showForm = true"><Icon name="plus" />Nouvelle réception</button>
        <button v-if="tab === 'fournisseurs'" type="button" class="btn primary" @click="editSupplier = { name: '', phone: '', address: '', notes: '' }"><Icon name="plus" />Nouveau fournisseur</button>
      </div>
      <nav class="tabs">
        <button type="button" :class="{ on: tab === 'receptions' }" @click="setTab('receptions')">Réceptions</button>
        <button type="button" :class="{ on: tab === 'inventaire' }" @click="setTab('inventaire')">Inventaire</button>
        <button type="button" :class="{ on: tab === 'mouvements' }" @click="setTab('mouvements')">Mouvements</button>
        <button type="button" :class="{ on: tab === 'fournisseurs' }" @click="setTab('fournisseurs')">Fournisseurs</button>
      </nav>

      <template v-if="tab === 'receptions'">
        <div class="toolbar"><PeriodPicker v-model="period" /></div>
        <Skeleton v-if="!purchases" />
        <div v-else-if="purchases.length" class="list">
          <button v-for="p in purchases" :key="p.id" type="button" class="list-row" @click="detailId = p.id">
            <div class="main-col"><div class="title">{{ p.supplier_name || 'Sans fournisseur' }}<span v-if="p.reference" class="faint"> · {{ p.reference }}</span></div><div class="sub">{{ when(p.created_at) }} · {{ p.lines }} produit(s) · {{ p.user_name }}</div></div>
            <div class="end num strong" v-if="can('cost.view')">{{ money(p.total) }}</div>
          </button>
        </div>
        <Empty v-else icon="truck" title="Aucune réception sur cette période" text="Quand une livraison arrive, enregistrez-la ici : le stock augmente et le prix d'achat est mis à jour.">
          <button type="button" class="btn primary" @click="showForm = true"><Icon name="plus" />Nouvelle réception</button>
        </Empty>
      </template>

      <Adjust v-else-if="tab === 'inventaire'" />

      <template v-else-if="tab === 'mouvements'">
        <div class="toolbar">
          <PeriodPicker v-model="period" />
          <select class="select" style="width:auto" v-model="moveType" aria-label="Type de mouvement">
            <option value="">Tous les mouvements</option>
            <option v-for="(label, key) in MOVE" :key="key" :value="key">{{ label }}</option>
          </select>
        </div>
        <Skeleton v-if="!movements" />
        <div v-else-if="movements.length" class="table-wrap">
          <table class="table">
            <thead><tr><th>Date</th><th>Produit</th><th>Mouvement</th><th class="num">Quantité</th><th class="num hide-phone">Stock après</th><th class="hide-phone">Par</th></tr></thead>
            <tbody>
              <tr v-for="m in movements" :key="m.id">
                <td class="nowrap">{{ dateTimeFr(m.created_at) }}</td>
                <td class="cell-title">{{ m.product_name }}</td>
                <td>{{ MOVE[m.type] || m.type }}<div class="cell-sub" v-if="m.reason">{{ m.reason }}</div></td>
                <td class="num" :style="{ color: m.qty < 0 ? 'var(--credit-ink)' : 'var(--paid-ink)' }">{{ fmtMove(m) }}</td>
                <td class="num hide-phone">{{ qty(m.stock_after) }}</td>
                <td class="hide-phone">{{ m.user_name || '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Empty v-else icon="layers" title="Aucun mouvement sur cette période" />
      </template>

      <template v-else-if="tab === 'fournisseurs'">
        <div v-if="suppliers.length" class="list">
          <div v-for="s in suppliers" :key="s.id" class="list-row">
            <div class="main-col"><div class="title">{{ s.name }}</div><div class="sub">{{ s.phone || 'Sans téléphone' }}<template v-if="s.address"> · {{ s.address }}</template> · {{ s.purchases }} réception(s)<template v-if="can('cost.view')"> · {{ money(s.purchases_total) }}</template></div></div>
            <a v-if="s.phone" class="icon-btn sm" :href="'tel:' + s.phone" :aria-label="'Appeler ' + s.name"><Icon name="phone" size="sm" /></a>
            <button type="button" class="icon-btn sm" @click="editSupplier = { ...s }" :aria-label="'Modifier ' + s.name"><Icon name="edit" size="sm" /></button>
            <button type="button" class="icon-btn sm" @click="removeSupplier(s)" :aria-label="'Supprimer ' + s.name"><Icon name="trash" size="sm" /></button>
          </div>
        </div>
        <Empty v-else icon="truck" title="Aucun fournisseur" text="Ajoutez vos fournisseurs pour suivre ce que vous achetez chez chacun." />
      </template>

      <ReceptionForm v-if="showForm" :suppliers="suppliers" @close="showForm = false" @saved="saved" @supplier="supplierAdded" />
      <PurchaseDetail v-if="detailId" :id="detailId" @close="detailId = null" />
      <Sheet v-if="editSupplier" :title="editSupplier.id ? 'Modifier le fournisseur' : 'Nouveau fournisseur'" size="narrow" @close="editSupplier = null">
        <form id="sup-form" class="stack" @submit.prevent="saveSupplier">
          <div class="field"><label for="sf-name">Nom</label><input id="sf-name" class="input" v-model="editSupplier.name" required maxlength="100" /></div>
          <div class="field"><label for="sf-phone">Téléphone</label><input id="sf-phone" class="input" v-model="editSupplier.phone" inputmode="tel" /></div>
          <div class="field"><label for="sf-addr">Adresse</label><input id="sf-addr" class="input" v-model="editSupplier.address" /></div>
          <div class="field"><label for="sf-notes">Notes</label><textarea id="sf-notes" class="textarea" v-model="editSupplier.notes"></textarea></div>
        </form>
        <template #foot><button type="button" class="btn" @click="editSupplier = null">Annuler</button><button type="submit" form="sup-form" class="btn primary">Enregistrer</button></template>
      </Sheet>
    </div>`,
};
