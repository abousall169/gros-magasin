// Étiquettes de codes-barres : choix des produits et des quantités, feuille A4 ou imprimante de tickets.
import { ref, computed } from '../vue.js';
import { api } from '../api.js';
import { store, toast, toastError, loadProducts } from '../store.js';
import { norm } from '../format.js';
import { Icon, Sheet } from './ui.js';
import { LABEL_LAYOUTS, labelHTML, printLabelSheets, canEncode } from '../print.js';
import { hasThermal, sendLabel } from '../printer.js';

export default {
  components: { Icon, Sheet },
  emits: ['close'],
  setup() {
    const sel = ref({}); // id produit -> nombre d'étiquettes
    const onlyMissing = ref(false);
    const q = ref('');
    const layoutId = ref('4x10');
    const showPrice = ref(true);
    const priceType = ref('retail');
    const showAr = ref(true);
    const cutLines = ref(true);
    const busy = ref('');

    const active = computed(() => store.products);
    const missing = computed(() => active.value.filter((p) => !p.barcode));
    const list = computed(() => {
      const words = norm(q.value).split(/\s+/).filter(Boolean);
      return (onlyMissing.value ? missing.value : active.value).filter((p) => {
        const hay = norm(`${p.name} ${p.barcode || ''}`);
        return words.every((w) => hay.includes(w));
      });
    });
    const layout = computed(() => LABEL_LAYOUTS.find((l) => l.id === layoutId.value));
    const items = computed(() => active.value.flatMap((p) => (sel.value[p.id] > 0 && canEncode(p.barcode) ? Array(sel.value[p.id]).fill(p) : [])));
    const setQty = (id, n) => {
      sel.value = { ...sel.value, [id]: Math.max(0, Math.min(99, n)) };
    };
    const selectAll = () => {
      sel.value = Object.fromEntries(list.value.filter((p) => canEncode(p.barcode)).map((p) => [p.id, sel.value[p.id] || 1]));
    };
    const opts = computed(() => ({ showPrice: showPrice.value, priceType: priceType.value, showAr: showAr.value, cutLines: cutLines.value }));
    const preview = computed(() => {
      const p = items.value[0];
      if (!p) return '';
      return labelHTML(p, { ...opts.value, w: 200 / layout.value.cols, h: 287 / layout.value.rows });
    });

    const generate = async () => {
      try {
        const r = await api.post('/products/assign-barcodes');
        await loadProducts();
        toast(`${r.assigned} code(s) créé(s).`, 'success');
      } catch (e) {
        toastError(e);
      }
    };
    const printA4 = () => printLabelSheets(items.value, layout.value, opts.value);
    const printThermal = async () => {
      if (items.value.length > 60 && !window.confirm(`Imprimer ${items.value.length} étiquettes sur l'imprimante de tickets ?`)) return;
      try {
        for (let i = 0; i < items.value.length; i++) {
          busy.value = `Impression ${i + 1} / ${items.value.length}`;
          await sendLabel(items.value[i], { showPrice: showPrice.value, priceType: priceType.value });
        }
        toast('Étiquettes envoyées à l’imprimante.', 'success');
      } catch (e) {
        toast(`Impression impossible : ${e.message}`, 'error', 6000);
      } finally {
        busy.value = '';
      }
    };
    return { sel, onlyMissing, q, layoutId, showPrice, priceType, showAr, cutLines, busy, active, missing, list, layout, items, setQty, selectAll, preview, generate, printA4, printThermal, hasThermal, canEncode, LABEL_LAYOUTS };
  },
  template: `
    <Sheet title="Étiquettes de codes-barres" size="wide" @close="$emit('close')">
      <div class="stack loose">
        <p class="small muted">Choisissez les produits et le nombre d'étiquettes. Un produit sans code-barres reçoit un code interne (EAN-13 commençant par 20), lisible par tous les lecteurs.</p>
        <div class="toolbar" style="margin:0">
          <div class="input-affix search"><Icon name="search" /><input class="input" v-model="q" placeholder="Rechercher un produit" /></div>
          <div class="chips">
            <button type="button" class="chip" :class="{ on: !onlyMissing }" @click="onlyMissing = false">Tous<span class="n">{{ active.length }}</span></button>
            <button type="button" class="chip" :class="{ on: onlyMissing }" @click="onlyMissing = true">Sans code-barres<span class="n">{{ missing.length }}</span></button>
          </div>
          <button v-if="missing.length" type="button" class="btn" @click="generate"><Icon name="barcode" />Générer les codes manquants ({{ missing.length }})</button>
        </div>
        <div class="row"><button type="button" class="btn sm ghost" @click="selectAll">Tout sélectionner</button><button type="button" class="btn sm ghost" @click="sel = {}">Aucun</button></div>
        <div class="list" style="border:1px solid var(--line);max-height:42vh;overflow:auto">
          <div v-for="p in list" :key="p.id" class="list-row">
            <div class="main-col"><div class="title">{{ p.name }}</div><div class="sub" :style="canEncode(p.barcode) ? '' : 'color:var(--credit-ink)'">{{ p.barcode ? (canEncode(p.barcode) ? p.barcode : p.barcode + ' — code non imprimable') : 'pas encore de code' }}</div></div>
            <div class="qty">
              <button type="button" :disabled="!canEncode(p.barcode) || !sel[p.id]" @click="setQty(p.id, (sel[p.id] || 0) - 1)" aria-label="Moins"><Icon name="minus" size="sm" /></button>
              <input :value="sel[p.id] || 0" inputmode="numeric" :disabled="!canEncode(p.barcode)" @change="setQty(p.id, parseInt($event.target.value) || 0)" aria-label="Nombre d'étiquettes" />
              <button type="button" :disabled="!canEncode(p.barcode)" @click="setQty(p.id, (sel[p.id] || 0) + 1)" aria-label="Plus"><Icon name="plus" size="sm" /></button>
            </div>
          </div>
          <p v-if="!list.length" class="small muted" style="padding:16px">Aucun produit.</p>
        </div>
        <div class="form-grid">
          <div class="field"><label for="lb-layout">Format de la feuille A4</label><select id="lb-layout" class="select" v-model="layoutId"><option v-for="l in LABEL_LAYOUTS" :key="l.id" :value="l.id">{{ l.name }}</option></select></div>
          <div class="field"><label for="lb-price">Prix affiché</label><select id="lb-price" class="select" v-model="priceType" :disabled="!showPrice"><option value="retail">Prix de détail</option><option value="wholesale">Prix de gros</option></select></div>
        </div>
        <div class="row wrap">
          <label class="check"><input type="checkbox" v-model="showPrice" /><span>Afficher le prix</span></label>
          <label class="check"><input type="checkbox" v-model="showAr" /><span>Nom en arabe (si renseigné)</span></label>
          <label class="check"><input type="checkbox" v-model="cutLines" /><span>Traits de découpe</span></label>
        </div>
        <div v-if="preview" class="row top"><span class="small muted">Aperçu</span><div class="label-preview" v-html="preview"></div></div>
        <p class="xsmall faint">Dans la fenêtre d'impression : échelle 100 %, sans en-têtes ni pieds de page.</p>
      </div>
      <template #foot>
        <button type="button" class="btn" :disabled="!items.length || !!busy || !hasThermal()" @click="printThermal" :title="hasThermal() ? '' : 'Aucune imprimante de tickets réglée'"><Icon name="receipt" />{{ busy || 'Imprimante de tickets' }}</button>
        <button type="button" class="btn primary" :disabled="!items.length || !!busy" @click="printA4"><Icon name="printer" />Imprimer la feuille A4 ({{ items.length }})</button>
      </template>
    </Sheet>`,
};
