// Composants d'interface partagés.
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from '../vue.js';
import { store, closeDialog } from '../store.js';
import { today, addDays, monthStart, norm, hasPack, plural, parseNum, round3, unitQty, stockText } from '../format.js';

// ---- Icônes (tracé unique, trait arrondi) --------------------------------------
const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M8 8h8"/><path d="M8 12h8"/><path d="M8 16h5"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  sliders: '<path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  wifi: '<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.86a10 10 0 0 1 14 0"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3z"/><path d="M21 14v.01"/><path d="M14 21h.01"/><path d="M17 21h4v-4"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8"/><path d="M11 8v8"/><path d="M15 8v8"/><path d="M18 8v8"/>',
  calculator: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8"/><path d="M8 11h.01"/><path d="M12 11h.01"/><path d="M16 11h.01"/><path d="M8 15h.01"/><path d="M12 15h.01"/><path d="M16 15h.01"/><path d="M8 19h.01"/><path d="M12 19h4"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  backspace: '<path d="M10 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H10l-7-7Z"/><path d="m18 9-6 6"/><path d="m12 9 6 6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  swap: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  store: '<path d="M3 9 4.5 4h15L21 9"/><path d="M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0Z"/><path d="M5 13v8h14v-8"/><path d="M10 21v-5h4v5"/>',
  tag: '<path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.82 8.82a2 2 0 0 0 2.83 0l7.17-7.17a2 2 0 0 0 0-2.83Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
};

export const Icon = {
  props: { name: String, size: String },
  computed: {
    svg() {
      return PATHS[this.name] || '';
    },
  },
  template: `<svg class="icon" :class="size" viewBox="0 0 24 24" aria-hidden="true" v-html="svg"></svg>`,
};

/** Vrai tant que la requête média correspond (ex. : écran de téléphone). */
export function useMedia(query) {
  const mq = window.matchMedia(query);
  const matches = ref(mq.matches);
  const onChange = (e) => (matches.value = e.matches);
  onMounted(() => mq.addEventListener('change', onChange));
  onUnmounted(() => mq.removeEventListener('change', onChange));
  return matches;
}

// ---- Feuille (dialogue) ------------------------------------------------------------
let openSheets = 0;
export const Sheet = {
  components: { Icon },
  props: { title: String, size: String, full: Boolean, band: Boolean, cls: [String, Object, Array] },
  emits: ['close'],
  setup(props, { emit }) {
    const el = ref(null);
    const onKey = (e) => {
      if (e.key === 'Escape') {
        const sheets = document.querySelectorAll('.sheet');
        if (sheets[sheets.length - 1] === el.value) emit('close');
      }
    };
    onMounted(async () => {
      openSheets++;
      document.body.classList.add('locked');
      document.addEventListener('keydown', onKey);
      await nextTick();
      const first = el.value?.querySelector('[autofocus], .sheet-body input:not([type=checkbox]):not([readonly]), .sheet-body select, .sheet-body textarea');
      if (first && window.matchMedia('(pointer: fine)').matches) first.focus();
      else el.value?.focus();
    });
    onUnmounted(() => {
      openSheets = Math.max(0, openSheets - 1);
      if (!openSheets) document.body.classList.remove('locked');
      document.removeEventListener('keydown', onKey);
    });
    return { el };
  },
  template: `
    <teleport to="body">
      <div class="sheet-backdrop" :class="cls" @mousedown.self="$emit('close')">
        <section ref="el" class="sheet" :class="[size, { full }]" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1">
          <header class="sheet-head" :class="{ band }">
            <h2 class="ellipsis">{{ title }}</h2>
            <slot name="head"></slot>
            <button type="button" class="icon-btn" @click="$emit('close')" aria-label="Fermer"><Icon name="x" /></button>
          </header>
          <div class="sheet-body"><slot></slot></div>
          <footer class="sheet-foot" v-if="$slots.foot"><slot name="foot"></slot></footer>
        </section>
      </div>
    </teleport>`,
};

// ---- Notifications et dialogues globaux ----------------------------------------------
export const Toasts = {
  components: { Icon },
  setup: () => ({ store }),
  template: `
    <div class="toasts" aria-live="polite">
      <div v-for="t in store.toasts" :key="t.id" class="toast" :class="t.type">
        <Icon :name="t.type === 'error' ? 'alert' : 'check'" />
        <span>{{ t.message }}</span>
      </div>
    </div>`,
};

export const DialogHost = {
  components: { Sheet },
  setup() {
    const input = ref(null);
    const d = computed(() => store.dialog);
    const ok = () => {
      if (d.value.input) {
        const v = String(d.value.value || '').trim();
        if (d.value.input.required && !v) return input.value?.focus();
        closeDialog(v);
      } else closeDialog(true);
    };
    return { d, ok, input, closeDialog };
  },
  template: `
    <Sheet v-if="d" :title="d.title" size="narrow" @close="closeDialog(false)">
      <form class="stack" @submit.prevent="ok" id="dlg-form">
        <p v-if="d.message" class="dlg-message">{{ d.message }}</p>
        <div v-if="d.input" class="field">
          <label for="dlg-input">{{ d.input.label }}</label>
          <input id="dlg-input" ref="input" class="input" v-model="d.value" :placeholder="d.input.placeholder || ''" autofocus />
        </div>
      </form>
      <template #foot>
        <button type="button" class="btn" @click="closeDialog(false)">{{ d.cancel || 'Annuler' }}</button>
        <button type="submit" form="dlg-form" class="btn" :class="d.danger ? 'danger solid' : 'primary'">{{ d.confirm || 'Confirmer' }}</button>
      </template>
    </Sheet>`,
};

export const Empty = {
  components: { Icon },
  props: { icon: { type: String, default: 'box' }, title: String, text: String },
  template: `
    <div class="empty">
      <Icon :name="icon" />
      <h3 v-if="title">{{ title }}</h3>
      <p v-if="text">{{ text }}</p>
      <slot></slot>
    </div>`,
};

export const Skeleton = {
  props: { rows: { type: Number, default: 5 } },
  template: `<div class="skeleton" aria-label="Chargement"><i v-for="n in rows" :key="n"></i></div>`,
};

// ---- Choix de période -----------------------------------------------------------------
export const PERIODS = [
  { id: 'today', label: "Aujourd'hui" },
  { id: 'yesterday', label: 'Hier' },
  { id: '7d', label: '7 jours' },
  { id: 'month', label: 'Ce mois' },
  { id: 'lastmonth', label: 'Mois dernier' },
  { id: 'custom', label: 'Dates…' },
];
export function periodRange(id, custom = {}) {
  const t = today();
  switch (id) {
    case 'yesterday':
      return { from: addDays(t, -1), to: addDays(t, -1) };
    case '7d':
      return { from: addDays(t, -6), to: t };
    case 'month':
      return { from: monthStart(t), to: t };
    case 'lastmonth': {
      const end = addDays(monthStart(t), -1);
      return { from: monthStart(end), to: end };
    }
    case 'custom':
      return { from: custom.from || t, to: custom.to || custom.from || t };
    default:
      return { from: t, to: t };
  }
}

export const PeriodPicker = {
  props: { modelValue: Object, periods: { type: Array, default: () => PERIODS.map((p) => p.id) } },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const list = computed(() => PERIODS.filter((p) => props.periods.includes(p.id)));
    const pick = (id) => {
      const r = periodRange(id, props.modelValue);
      emit('update:modelValue', { id, ...r });
    };
    const setDate = (key, v) => emit('update:modelValue', { ...props.modelValue, id: 'custom', [key]: v });
    return { list, pick, setDate };
  },
  template: `
    <div class="period">
      <div class="chips">
        <button v-for="p in list" :key="p.id" type="button" class="chip" :class="{ on: modelValue.id === p.id }" @click="pick(p.id)">{{ p.label }}</button>
      </div>
      <template v-if="modelValue.id === 'custom'">
        <input type="date" class="input" :value="modelValue.from" @change="setDate('from', $event.target.value)" aria-label="Du" />
        <span class="muted small">au</span>
        <input type="date" class="input" :value="modelValue.to" @change="setDate('to', $event.target.value)" aria-label="Au" />
      </template>
    </div>`,
};

// ---- Saisie d'une quantité en colis + unités -------------------------------------------
export const PackQtyInput = {
  props: { product: Object, modelValue: Number },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const packs = ref('');
    const units = ref('');
    const sync = () => {
      const p = props.product;
      const v = Number(props.modelValue) || 0;
      if (p && hasPack(p)) {
        const size = Number(p.pack_size);
        const n = Math.floor(v / size + 1e-9);
        packs.value = n ? String(n) : '';
        const rest = round3(v - n * size);
        units.value = rest ? String(rest).replace('.', ',') : '';
      } else {
        packs.value = '';
        units.value = v ? String(v).replace('.', ',') : '';
      }
    };
    let lastEmitted = null;
    const update = () => {
      const p = props.product;
      const a = parseNum(packs.value) || 0;
      const b = parseNum(units.value) || 0;
      const total = round3((p && hasPack(p) ? a * Number(p.pack_size) : 0) + b);
      lastEmitted = total;
      emit('update:modelValue', total);
    };
    // Nouveau produit : on réaffiche ; valeur venant de l'extérieur : on réaffiche ;
    // contenance modifiée : on garde la saisie et on recalcule le total.
    watch(() => props.product?.id, sync, { immediate: true });
    watch(
      () => props.modelValue,
      (v) => {
        if (v !== lastEmitted) sync();
      },
    );
    watch(
      () => [props.product?.pack_size, props.product?.pack_unit],
      () => {
        if (packs.value !== '' || units.value !== '') update();
      },
    );
    const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
    return { packs, units, update, hasPack, plural, unitQty, stockText, cap };
  },
  template: `
    <div class="stack tight">
      <div class="row">
        <div class="field grow" v-if="product && hasPack(product)">
          <label>{{ cap(plural(product.pack_unit, 2)) }}</label>
          <input class="input num" inputmode="decimal" v-model="packs" @input="update" placeholder="0" />
        </div>
        <div class="field grow">
          <label>{{ product ? cap(plural(product.unit, 2)) : 'Unités' }}{{ product && hasPack(product) ? ' en plus' : '' }}</label>
          <input class="input num" inputmode="decimal" v-model="units" @input="update" placeholder="0" />
        </div>
      </div>
      <p class="xsmall faint" v-if="product && hasPack(product)">Total : {{ stockText(product, modelValue || 0) }} ({{ unitQty(modelValue || 0, product.unit) }})</p>
    </div>`,
};

// ---- Sélecteur de produit (recherche dans le catalogue en cache) ---------------------------
export const ProductSearch = {
  components: { Icon },
  props: { placeholder: { type: String, default: 'Rechercher un produit (nom ou code)…' } },
  emits: ['pick'],
  setup(props, { emit }) {
    const q = ref('');
    const results = computed(() => {
      const words = norm(q.value).split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      return store.products
        .filter((p) => {
          const hay = norm(`${p.name} ${p.barcode || ''} ${p.category_name || ''}`);
          return words.every((w) => hay.includes(w));
        })
        .slice(0, 30);
    });
    const pick = (p) => {
      emit('pick', p);
      q.value = '';
    };
    const enter = () => {
      const exact = store.products.find((p) => p.barcode && p.barcode === q.value.trim());
      if (exact) return pick(exact);
      if (results.value.length === 1) pick(results.value[0]);
    };
    return { q, results, pick, enter, stockText };
  },
  template: `
    <div class="stack tight">
      <div class="input-affix">
        <Icon name="search" />
        <input class="input" v-model="q" :placeholder="placeholder" @keydown.enter.prevent="enter" autocomplete="off" />
      </div>
      <div class="list result-box" v-if="q && results.length">
        <button type="button" class="list-row" v-for="p in results" :key="p.id" @click="pick(p)">
          <div class="main-col"><div class="title">{{ p.name }}</div><div class="sub">{{ p.category_name || 'Sans rayon' }} · stock {{ stockText(p) }}</div></div>
          <Icon name="plus" />
        </button>
      </div>
      <p class="small muted" v-else-if="q">Aucun produit ne correspond à « {{ q }} ».</p>
    </div>`,
};
