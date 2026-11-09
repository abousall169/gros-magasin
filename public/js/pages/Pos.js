// Caisse : recherche produit, panier gros / détail, encaissement.
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from '../vue.js';
import { api } from '../api.js';
import { store, can, toast, toastError, ask, local, CASH } from '../store.js';
import {
  money,
  qty as fmtQty,
  plural,
  norm,
  parseNum,
  round3,
  roundMoney,
  decimals,
  listPrice,
  unitsPer,
  unitLabel,
  sellsWholesale,
  hasPack,
  stockText,
  stockLevel,
  saleNo,
  MODE_LABEL,
} from '../format.js';
import { Icon, Sheet, Empty } from '../components/ui.js';
import CustomerPicker from '../components/CustomerPicker.js';
import { printTicket, printInvoice, saleText, openWhatsApp } from '../print.js';

const MODE_NAME = { retail: 'Vente au détail', wholesale: 'Vente en gros' };

// ---- Panier (partagé entre l'ordinateur et la feuille du téléphone) -------------------
const CartView = {
  components: { Icon },
  props: { c: Object, closable: Boolean },
  emits: ['close'],
  template: `
    <div class="cart" :class="{ 'in-sheet': closable }">
      <div class="cart-band">
        <div class="band-top">
          <h2 class="grow">{{ c.modeName }}<span class="band-count num" v-if="c.lines.length"> · {{ c.lines.length }} {{ c.lines.length > 1 ? 'articles' : 'article' }}</span></h2>
          <button v-if="c.held.length" type="button" class="band-btn" @click="c.showHeld = true"><Icon name="clock" size="sm" />{{ c.held.length }} en attente</button>
          <button v-if="closable" type="button" class="icon-btn" @click="$emit('close')" aria-label="Fermer le panier"><Icon name="x" /></button>
        </div>
        <div class="mode-switch" role="group" aria-label="Mode de vente">
          <button type="button" class="retail" :class="{ on: c.mode === 'retail' }" @click="c.setMode('retail')">Détail</button>
          <button type="button" class="wholesale" :class="{ on: c.mode === 'wholesale' }" @click="c.setMode('wholesale')">Gros</button>
        </div>
        <button type="button" class="customer-btn" @click="c.picking = true">
          <Icon name="user" />
          <span class="grow">
            <small>Client</small>
            <strong>{{ c.cart.customer ? c.cart.customer.name : 'Client comptoir' }}</strong>
          </span>
          <span v-if="c.cart.customer && c.cart.customer.balance > 0" class="debt small num">Doit {{ c.money(c.cart.customer.balance) }}</span>
          <Icon name="chevronRight" size="sm" />
        </button>
      </div>

      <div class="cart-lines">
        <div v-if="!c.lines.length" class="cart-empty">
          <Icon name="cart" />
          <p>Touchez un produit pour l'ajouter.<br>Le mode <b>{{ c.mode === 'wholesale' ? 'Gros' : 'Détail' }}</b> s'applique aux nouveaux articles.</p>
        </div>
        <div v-for="l in c.lines" :key="l.key" class="line">
          <div class="l-name">
            {{ l.name }}
            <span class="unit-price">
              <template v-if="c.editingPrice === l.key">
                <input class="input price-input num" inputmode="decimal" :value="l.price" @change="c.setPrice(l, $event.target.value)" @blur="c.editingPrice = null" @keydown.enter="$event.target.blur()" autofocus :aria-label="'Prix de ' + l.name" />
              </template>
              <button v-else-if="c.canEditPrice" type="button" :class="{ changed: l.custom }" @click="c.editPrice(l)" title="Modifier le prix">{{ c.money(l.price, { bare: true }) }}</button>
              <span v-else :class="{ changed: l.custom }">{{ c.money(l.price, { bare: true }) }}</span>
              / {{ l.unit }}
            </span>
          </div>
          <div class="l-total">{{ c.money(l.total, { bare: true }) }}</div>
          <div class="l-controls">
            <button type="button" class="line-type" :class="l.sale_type" :disabled="!l.canToggle" @click="c.toggleLine(l)" :title="l.canToggle ? 'Changer gros / détail' : ''">{{ l.sale_type === 'wholesale' ? 'Gros' : 'Détail' }}</button>
            <div class="qty">
              <button type="button" @click="c.step(l, -1)" aria-label="Diminuer"><Icon name="minus" size="sm" /></button>
              <input :value="c.fmtQty(l.qty)" inputmode="decimal" @focus="$event.target.select()" @change="c.setQty(l, $event.target.value, $event)" @keydown.enter="$event.target.blur()" :aria-label="'Quantité ' + l.name" />
              <button type="button" @click="c.step(l, 1)" aria-label="Augmenter"><Icon name="plus" size="sm" /></button>
            </div>
            <span class="qty-unit">{{ c.plural(l.unit, l.qty) }}</span>
            <button type="button" class="icon-btn sm remove" @click="c.remove(l)" :aria-label="'Retirer ' + l.name"><Icon name="trash" size="sm" /></button>
          </div>
          <div v-if="l.warn" class="l-warn">{{ l.warn }}</div>
        </div>
      </div>

      <div class="cart-foot">
        <div class="sum-row" v-if="c.cart.discount > 0 || c.canEditPrice">
          <span>Sous-total</span><span>{{ c.money(c.subtotal) }}</span>
        </div>
        <div class="sum-row" v-if="c.canEditPrice">
          <label for="discount">Remise</label>
          <input id="discount" class="input discount-input num" inputmode="decimal" :value="c.cart.discount || ''" placeholder="0" @change="c.setDiscount($event.target.value, $event)" />
        </div>
        <div class="sum-row total"><span>Total</span><span class="amount">{{ c.money(c.total) }}</span></div>
        <div class="cart-actions">
          <button type="button" class="btn icon-only" :disabled="!c.lines.length" @click="c.hold()" title="Mettre en attente" aria-label="Mettre en attente"><Icon name="pause" /></button>
          <button type="button" class="btn" :disabled="!c.lines.length" @click="c.proforma()" title="Facture proforma" aria-label="Facture proforma"><Icon name="file" /></button>
          <button type="button" class="btn" :disabled="!c.lines.length" @click="c.clear()" title="Vider le panier" aria-label="Vider le panier"><Icon name="trash" /></button>
          <button type="button" class="btn mode lg" :disabled="!c.lines.length" @click="c.openPay()">Encaisser</button>
        </div>
      </div>
    </div>`,
};

export default {
  components: { Icon, Sheet, Empty, CartView, CustomerPicker },
  setup() {
    const mode = ref(local.get('mode', 'retail') === 'wholesale' ? 'wholesale' : 'retail');
    const saved = local.get('cart', null);
    const cart = reactive({
      items: Array.isArray(saved?.items) ? saved.items : [],
      customer: saved?.customer || null,
      discount: Number(saved?.discount) || 0,
      note: saved?.note || '',
    });
    const held = ref(local.get('held', []));
    const search = ref('');
    const category = ref(0);
    const showCart = ref(false);
    const showHeld = ref(false);
    const picking = ref(false);
    const editingPrice = ref(null);
    const flashId = ref(0);
    const pay = ref(null);
    const done = ref(null);
    const searchEl = ref(null);

    watch(cart, () => local.set('cart', cart), { deep: true });
    watch(mode, (m) => local.set('mode', m));

    const allowNegative = computed(() => !!store.settings.allow_negative_stock);
    const canEditPrice = computed(() => can('price.edit'));
    const byId = computed(() => new Map(store.products.map((p) => [p.id, p])));

    // ---- Catalogue filtré ----
    const filtered = computed(() => {
      const words = norm(search.value).split(/\s+/).filter(Boolean);
      return store.products.filter((p) => {
        if (category.value && p.category_id !== category.value) return false;
        if (!words.length) return true;
        const hay = norm(`${p.name} ${p.barcode || ''}`);
        return words.every((w) => hay.includes(w));
      });
    });
    const visible = computed(() => filtered.value.slice(0, 160));
    const categories = computed(() => store.categories.filter((c) => c.products > 0));

    // ---- Lignes du panier ----
    const needOf = (productId, exceptKey = null) => {
      let n = 0;
      for (const it of cart.items) {
        if (it.product_id !== productId || it.key === exceptKey) continue;
        const p = byId.value.get(productId);
        if (p) n += Number(it.qty) * unitsPer(p, it.sale_type);
      }
      return round3(n);
    };
    const inCart = computed(() => {
      const m = new Map();
      for (const it of cart.items) m.set(it.product_id, round3((m.get(it.product_id) || 0) + Number(it.qty)));
      return m;
    });
    const lines = computed(() =>
      cart.items.map((it) => {
        const p = byId.value.get(it.product_id);
        if (!p) {
          return { ...it, name: 'Produit indisponible', unit: '', price: 0, total: 0, canToggle: false, warn: 'Ce produit a été retiré de la vente : supprimez la ligne.' };
        }
        const price = it.unit_price ?? listPrice(p, it.sale_type);
        let warn = '';
        if (!allowNegative.value) {
          const need = needOf(p.id);
          if (need > Number(p.stock) + 1e-9) warn = `Stock insuffisant : il reste ${stockText(p)}.`;
        }
        return {
          ...it,
          name: p.name,
          unit: unitLabel(p, it.sale_type),
          price,
          custom: it.unit_price !== null && it.unit_price !== undefined,
          total: roundMoney(Number(it.qty) * price),
          canToggle: sellsWholesale(p),
          warn,
        };
      }),
    );
    const subtotal = computed(() => roundMoney(lines.value.reduce((s, l) => s + l.total, 0)));
    const total = computed(() => roundMoney(Math.max(0, subtotal.value - (Number(cart.discount) || 0))));
    const itemCount = computed(() => cart.items.length);

    const flash = (id) => {
      flashId.value = 0;
      requestAnimationFrame(() => (flashId.value = id));
      setTimeout(() => {
        if (flashId.value === id) flashId.value = 0;
      }, 500);
    };

    const add = (p, amount = 1) => {
      const type = mode.value;
      if (!allowNegative.value) {
        const after = needOf(p.id) + amount * unitsPer(p, type);
        if (after > Number(p.stock) + 1e-9) {
          toast(`Stock insuffisant pour « ${p.name} » : il reste ${stockText(p)}.`, 'error');
          return;
        }
      }
      const line = cart.items.find((i) => i.product_id === p.id && i.sale_type === type && (i.unit_price === null || i.unit_price === undefined));
      if (line) line.qty = round3(Number(line.qty) + amount);
      else cart.items.push({ key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, product_id: p.id, sale_type: type, qty: amount, unit_price: null });
      flash(p.id);
    };

    const onSearchEnter = () => {
      const term = search.value.trim();
      if (!term) return;
      const exact = store.products.find((p) => p.barcode && p.barcode === term);
      const pick = exact || (filtered.value.length === 1 ? filtered.value[0] : null);
      if (pick) {
        add(pick);
        search.value = '';
      } else if (!filtered.value.length) toast(`Aucun produit pour « ${term} ».`, 'error');
    };

    const step = (l, delta) => {
      const it = cart.items.find((i) => i.key === l.key);
      if (!it) return;
      const next = round3(Number(it.qty) + delta);
      if (next <= 0) return remove(l);
      const p = byId.value.get(it.product_id);
      if (delta > 0 && p && !allowNegative.value) {
        const after = needOf(p.id) + delta * unitsPer(p, it.sale_type);
        if (after > Number(p.stock) + 1e-9) return toast(`Stock insuffisant : il reste ${stockText(p)}.`, 'error');
      }
      it.qty = next;
    };
    const setQty = (l, value, ev) => {
      const it = cart.items.find((i) => i.key === l.key);
      const n = round3(parseNum(value));
      if (!it) return;
      if (!(n > 0)) {
        ev.target.value = fmtQty(it.qty);
        return;
      }
      it.qty = n;
    };
    const remove = (l) => {
      const i = cart.items.findIndex((x) => x.key === l.key);
      if (i >= 0) cart.items.splice(i, 1);
    };
    const toggleLine = (l) => {
      const it = cart.items.find((i) => i.key === l.key);
      if (!it) return;
      it.sale_type = it.sale_type === 'wholesale' ? 'retail' : 'wholesale';
      it.unit_price = null;
    };
    const editPrice = (l) => {
      editingPrice.value = l.key;
    };
    const setPrice = (l, value) => {
      const it = cart.items.find((i) => i.key === l.key);
      editingPrice.value = null;
      if (!it) return;
      const n = parseNum(value);
      if (!(n >= 0)) return;
      const p = byId.value.get(it.product_id);
      const list = p ? listPrice(p, it.sale_type) : n;
      it.unit_price = Math.abs(n - list) < 0.005 ? null : n;
    };
    const setDiscount = (value, ev) => {
      const n = value === '' ? 0 : parseNum(value);
      if (!(n >= 0) || n > subtotal.value) {
        toast('Remise invalide.', 'error');
        ev.target.value = cart.discount || '';
        return;
      }
      cart.discount = roundMoney(n);
    };

    const setMode = (m) => {
      if (m === mode.value) return;
      mode.value = m;
      if (cart.items.length) {
        for (const it of cart.items) {
          it.sale_type = m;
          it.unit_price = null;
        }
        toast(m === 'wholesale' ? 'Tout le panier passe au prix de gros.' : 'Tout le panier passe au prix de détail.');
      }
    };

    const pickCustomer = (c) => {
      picking.value = false;
      cart.customer = c ? { id: c.id, name: c.name, phone: c.phone, type: c.type, balance: c.balance || 0, credit_limit: c.credit_limit || 0 } : null;
      if (c && !cart.items.length) setMode(c.type === 'wholesale' ? 'wholesale' : 'retail');
      if (pay.value) pay.value.error = '';
    };

    const resetCart = () => {
      cart.items = [];
      cart.customer = null;
      cart.discount = 0;
      cart.note = '';
    };
    const clear = async () => {
      if (await ask({ title: 'Vider le panier ?', message: 'Tous les articles seront retirés.', confirm: 'Vider', danger: true })) resetCart();
    };
    const hold = () => {
      if (!cart.items.length) return;
      held.value.unshift({ id: Date.now(), at: new Date().toISOString(), mode: mode.value, items: JSON.parse(JSON.stringify(cart.items)), customer: cart.customer, discount: cart.discount, note: cart.note });
      local.set('held', held.value);
      resetCart();
      showCart.value = false;
      toast('Panier mis en attente.');
    };
    const restore = (h) => {
      if (cart.items.length) hold();
      cart.items = h.items;
      cart.customer = h.customer;
      cart.discount = h.discount || 0;
      cart.note = h.note || '';
      mode.value = h.mode === 'wholesale' ? 'wholesale' : 'retail';
      held.value = held.value.filter((x) => x.id !== h.id);
      local.set('held', held.value);
      showHeld.value = false;
    };
    const dropHeld = (h) => {
      held.value = held.value.filter((x) => x.id !== h.id);
      local.set('held', held.value);
    };

    const draftSale = () => ({
      id: 0,
      created_at: new Date().toISOString().replace('T', ' '),
      customer_name: cart.customer?.name,
      customer_phone: cart.customer?.phone,
      subtotal: subtotal.value,
      discount: Number(cart.discount) || 0,
      total: total.value,
      items: lines.value.map((l) => ({ name: l.name, sale_type: l.sale_type, qty: l.qty, unit_label: l.unit, unit_price: l.price, total: l.total })),
    });
    const proforma = () => printInvoice(draftSale(), { proforma: true });

    // ---- Encaissement ----
    const quickSteps = computed(() => (decimals() === 2 ? [1, 5, 10, 20, 50, 100] : [500, 1000, 2000, 5000, 10000, 25000]));
    const openPay = () => {
      if (!cart.items.length) return;
      const bad = lines.value.find((l) => l.warn);
      if (bad) return toast(`${bad.name} : ${bad.warn}`, 'error');
      pay.value = { lines: [{ method: CASH, amount: String(total.value) }], busy: false, error: '' };
      showCart.value = false;
    };
    const payNums = computed(() => {
      if (!pay.value) return null;
      const ls = pay.value.lines.map((l) => ({ method: l.method, amount: Math.max(0, parseNum(l.amount) || 0) }));
      const cash = ls.filter((l) => l.method === CASH).reduce((s, l) => s + l.amount, 0);
      const other = ls.filter((l) => l.method !== CASH).reduce((s, l) => s + l.amount, 0);
      const cashApplied = Math.max(0, Math.min(cash, total.value - other));
      const change = roundMoney(cash - cashApplied);
      const paid = roundMoney(other + cashApplied);
      const rest = roundMoney(total.value - paid);
      return { cash, other, change, paid, rest, overpaidOther: other > total.value + 0.004 };
    });
    const quickCash = computed(() => {
      const t = total.value;
      const out = [];
      for (const s of quickSteps.value) {
        const v = Math.ceil(t / s) * s;
        if (v > t && !out.includes(v)) out.push(v);
      }
      return out.slice(0, 4);
    });
    const setPayAmount = (i, v) => {
      pay.value.lines[i].amount = String(v);
    };
    const addPayLine = () => {
      const used = new Set(pay.value.lines.map((l) => l.method));
      const method = store.paymentMethods.find((m) => !used.has(m)) || CASH;
      const rest = payNums.value.rest;
      pay.value.lines.push({ method, amount: rest > 0 ? String(rest) : '' });
    };
    const fullCredit = () => {
      pay.value.lines = [{ method: CASH, amount: '0' }];
    };
    const confirmSale = async () => {
      const p = pay.value;
      const n = payNums.value;
      p.error = '';
      if (n.overpaidOther) return (p.error = 'Les paiements hors espèces dépassent le total.');
      if (n.rest > 0) {
        if (!cart.customer) return (p.error = 'Il reste un montant à payer : choisissez le client pour le mettre à crédit.');
        if (!can('credit.sell')) return (p.error = "Vous n'êtes pas autorisé à vendre à crédit.");
      }
      p.busy = true;
      try {
        const sale = await api.post('/sales', {
          customer_id: cart.customer?.id || null,
          items: cart.items.map((it) => ({ product_id: it.product_id, sale_type: it.sale_type, qty: it.qty, unit_price: it.unit_price })),
          discount: Number(cart.discount) || 0,
          payments: p.lines.map((l) => ({ method: l.method, amount: parseNum(l.amount) || 0 })),
          note: cart.note,
        });
        // Mise à jour immédiate du stock affiché (les autres appareils reçoivent l'événement)
        for (const it of sale.items) {
          const prod = byId.value.get(it.product_id);
          if (prod) prod.stock = round3(Number(prod.stock) - Number(it.base_qty));
        }
        resetCart();
        pay.value = null;
        done.value = sale;
      } catch (e) {
        p.error = e.message;
      } finally {
        if (pay.value) pay.value.busy = false;
      }
    };
    const newSale = () => {
      done.value = null;
      nextTick(() => {
        if (window.matchMedia('(pointer: fine)').matches) searchEl.value?.focus();
      });
    };
    const shareSale = (s) => openWhatsApp(saleText(s), s.customer_phone);

    // ---- Clavier : taper n'importe où pour chercher (lecteur de codes-barres) ----
    const onKey = (e) => {
      if (document.querySelector('.sheet')) return;
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = ['input', 'textarea', 'select'].includes(tag);
      if (e.key === 'F2' || (e.key === '/' && !typing)) {
        e.preventDefault();
        searchEl.value?.focus();
        return;
      }
      if (e.key === 'F4') {
        e.preventDefault();
        openPay();
        return;
      }
      if (!typing && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && window.matchMedia('(pointer: fine)').matches) {
        searchEl.value?.focus();
      }
    };
    onMounted(() => {
      document.addEventListener('keydown', onKey);
      if (window.matchMedia('(pointer: fine)').matches) searchEl.value?.focus();
    });
    onUnmounted(() => document.removeEventListener('keydown', onKey));

    const ctx = reactive({
      cart,
      mode,
      modeName: computed(() => MODE_NAME[mode.value]),
      lines,
      subtotal,
      total,
      held,
      showHeld,
      picking,
      editingPrice,
      canEditPrice,
      setMode,
      step,
      setQty,
      remove,
      toggleLine,
      editPrice,
      setPrice,
      setDiscount,
      hold,
      clear,
      proforma,
      openPay,
      money,
      fmtQty,
      plural,
    });

    return {
      store,
      ctx,
      mode,
      cart,
      search,
      category,
      categories,
      filtered,
      visible,
      inCart,
      showCart,
      showHeld,
      picking,
      held,
      flashId,
      pay,
      payNums,
      quickCash,
      done,
      searchEl,
      itemCount,
      total,
      allowNegative,
      add,
      onSearchEnter,
      setMode,
      pickCustomer,
      restore,
      dropHeld,
      setPayAmount,
      addPayLine,
      fullCredit,
      confirmSale,
      newSale,
      shareSale,
      printTicket,
      printInvoice,
      money,
      fmtQty,
      plural,
      listPrice,
      hasPack,
      sellsWholesale,
      stockText,
      stockLevel,
      saleNo,
      MODE_LABEL,
      can,
      CASH,
    };
  },
  template: `
    <div class="pos" :class="'mode-' + mode">
      <section class="pos-products" aria-label="Produits">
        <div class="pos-head">
          <div class="search-row">
            <div class="input-affix">
              <Icon name="search" />
              <input ref="searchEl" class="input" type="search" v-model="search" @keydown.enter.prevent="onSearchEnter"
                     placeholder="Produit ou code-barres…" autocomplete="off" enterkeyhint="search" aria-label="Rechercher un produit" />
            </div>
            <div class="mode-switch hide-desktop-cart" role="group" aria-label="Mode de vente">
              <button type="button" class="retail" :class="{ on: mode === 'retail' }" @click="setMode('retail')">Détail</button>
              <button type="button" class="wholesale" :class="{ on: mode === 'wholesale' }" @click="setMode('wholesale')">Gros</button>
            </div>
          </div>
          <div class="chips" v-if="categories.length">
            <button type="button" class="chip" :class="{ on: !category }" @click="category = 0">Tous</button>
            <button v-for="c in categories" :key="c.id" type="button" class="chip" :class="{ on: category === c.id }" @click="category = category === c.id ? 0 : c.id">{{ c.name }}</button>
          </div>
        </div>

        <div class="pos-grid">
          <button v-for="p in visible" :key="p.id" type="button" class="tile" :class="{ flash: flashId === p.id }"
                  :disabled="!allowNegative && p.stock <= 0" @click="add(p)">
            <span class="t-name" :class="{ 'has-qty': inCart.get(p.id) }">{{ p.name }}</span>
            <span class="t-qty" v-if="inCart.get(p.id)">{{ fmtQty(inCart.get(p.id)) }}</span>
            <span class="t-prices">
              <span class="price-line retail" :class="{ active: mode === 'retail' }"><i class="k"></i><b>{{ money(p.retail_price, { bare: true }) }}</b>/ {{ p.unit }}</span>
              <span v-if="sellsWholesale(p)" class="price-line wholesale" :class="{ active: mode === 'wholesale' }"><i class="k"></i><b>{{ money(listPrice(p, 'wholesale'), { bare: true }) }}</b>/ {{ hasPack(p) ? p.pack_unit : p.unit }}</span>
            </span>
            <span class="t-stock" :class="{ low: stockLevel(p) !== 'ok' }">
              {{ stockLevel(p) === 'out' ? 'Rupture de stock' : stockText(p) }}
            </span>
          </button>
          <Empty v-if="store.productsLoaded && !filtered.length" icon="search" :title="search ? 'Aucun produit trouvé' : 'Aucun produit'"
                 :text="search ? 'Vérifiez l\\'orthographe ou cherchez une partie du nom.' : (can('products.manage') ? 'Ajoutez vos produits dans la page Produits.' : 'Demandez au gérant d\\'ajouter les produits.')" style="grid-column: 1 / -1" />
          <p v-if="filtered.length > visible.length" class="small muted" style="grid-column: 1 / -1; padding: 8px 4px">
            {{ filtered.length - visible.length }} autres produits : précisez la recherche.
          </p>
        </div>
      </section>

      <CartView class="cart-desktop" :c="ctx" />

      <button v-if="itemCount" type="button" class="cartbar" @click="showCart = true">
        <span class="count">{{ itemCount }}</span>
        <span>Voir le panier</span>
        <span class="amount">{{ money(total) }}</span>
      </button>
    </div>

    <!-- Panier en plein écran (téléphone) -->
    <teleport to="body" v-if="showCart">
      <div class="sheet-backdrop" :class="'mode-' + mode" @mousedown.self="showCart = false">
        <section class="sheet full" role="dialog" aria-modal="true" aria-label="Panier">
          <CartView :c="ctx" closable @close="showCart = false" />
        </section>
      </div>
    </teleport>

    <CustomerPicker v-if="ctx.picking" :current="cart.customer" @pick="pickCustomer" @close="ctx.picking = false" />

    <!-- Paniers en attente -->
    <Sheet v-if="ctx.showHeld" title="Paniers en attente" @close="ctx.showHeld = false">
      <div class="list">
        <div v-for="h in held" :key="h.id" class="list-row">
          <div class="main-col">
            <div class="title">{{ h.customer ? h.customer.name : 'Client comptoir' }}</div>
            <div class="sub">{{ h.items.length }} article(s) · {{ MODE_LABEL[h.mode] }} · mis en attente à {{ new Date(h.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }}</div>
          </div>
          <button type="button" class="btn sm" @click="dropHeld(h)" aria-label="Supprimer"><Icon name="trash" size="sm" /></button>
          <button type="button" class="btn sm primary" @click="restore(h)">Reprendre</button>
        </div>
      </div>
    </Sheet>

    <!-- Encaissement -->
    <Sheet v-if="pay" title="Encaissement" band full :cls="'mode-' + mode" @close="pay = null">
      <template #head><strong class="num" style="font-size: 1.4375rem">{{ money(total) }}</strong></template>
      <div class="stack loose">
        <button type="button" class="customer-btn" style="background: var(--ground)" @click="ctx.picking = true">
          <Icon name="user" />
          <span class="grow"><small>Client</small><strong>{{ cart.customer ? cart.customer.name : 'Client comptoir' }}</strong></span>
          <span v-if="cart.customer && cart.customer.balance > 0" class="debt small num">Doit déjà {{ money(cart.customer.balance) }}</span>
          <Icon name="chevronRight" size="sm" />
        </button>

        <div class="stack" v-for="(l, i) in pay.lines" :key="i">
          <div class="methods" role="group" :aria-label="'Moyen de paiement ' + (i + 1)">
            <button v-for="m in store.paymentMethods" :key="m" type="button" class="method" :class="{ on: l.method === m }" @click="l.method = m">{{ m }}</button>
          </div>
          <div class="pay-line">
            <label class="label" :for="'pay-' + i">{{ l.method === CASH ? 'Montant reçu' : 'Montant payé' }}</label>
            <input :id="'pay-' + i" class="input num" inputmode="decimal" v-model="l.amount" @focus="$event.target.select()" />
            <button v-if="pay.lines.length > 1" type="button" class="icon-btn" @click="pay.lines.splice(i, 1)" aria-label="Retirer ce paiement"><Icon name="x" /></button>
            <span v-else></span>
          </div>
          <div class="quick-cash" v-if="l.method === CASH">
            <button type="button" @click="setPayAmount(i, total)">Montant exact</button>
            <button v-for="v in quickCash" :key="v" type="button" @click="setPayAmount(i, v)">{{ money(v, { bare: true }) }}</button>
          </div>
        </div>
        <div class="row wrap">
          <button type="button" class="btn sm" @click="addPayLine"><Icon name="plus" size="sm" />Autre moyen de paiement</button>
          <button v-if="can('credit.sell')" type="button" class="btn sm" @click="fullCredit"><Icon name="clock" size="sm" />Tout à crédit</button>
        </div>

        <div class="pay-summary">
          <div class="sum-row"><span>Total à payer</span><span>{{ money(total) }}</span></div>
          <div class="sum-row"><span>Payé</span><span>{{ money(payNums.paid) }}</span></div>
          <div class="sum-row big change" v-if="payNums.change > 0"><span>Monnaie à rendre</span><span>{{ money(payNums.change) }}</span></div>
          <div class="sum-row big rest" v-if="payNums.rest > 0"><span>Reste (crédit)</span><span>{{ money(payNums.rest) }}</span></div>
          <p class="small" v-if="payNums.rest > 0 && cart.customer">Le reste sera ajouté au compte de <b>{{ cart.customer.name }}</b>.</p>
        </div>
        <div v-if="pay.error" class="alert danger" role="alert"><Icon name="alert" /><span>{{ pay.error }}</span></div>
      </div>
      <template #foot>
        <button type="button" class="btn" @click="pay = null">Retour</button>
        <button type="button" class="btn mode lg" :class="{ loading: pay.busy }" :disabled="pay.busy" @click="confirmSale">
          {{ payNums.rest > 0 ? 'Valider avec crédit' : 'Valider la vente' }}
        </button>
      </template>
    </Sheet>

    <!-- Vente terminée -->
    <Sheet v-if="done" :title="'Vente ' + saleNo(done.id)" size="narrow" @close="newSale">
      <div class="done">
        <div class="tick"><Icon name="check" /></div>
        <h2>Vente enregistrée</h2>
        <p class="muted small">{{ MODE_LABEL[done.mode] }} · {{ money(done.total) }}{{ done.customer_name ? ' · ' + done.customer_name : '' }}</p>
        <div class="change-due" v-if="done.change_given > 0"><small>Monnaie à rendre</small><strong>{{ money(done.change_given) }}</strong></div>
        <div class="alert danger" v-if="done.credit > 0"><Icon name="clock" /><span>{{ money(done.credit) }} mis à crédit. Nouveau solde de {{ done.customer_name }} : <b>{{ money(done.customer_balance) }}</b></span></div>
      </div>
      <div class="done-actions">
        <button type="button" class="btn" @click="printTicket(done)"><Icon name="printer" />Ticket</button>
        <button type="button" class="btn" @click="printInvoice(done)"><Icon name="file" />Facture A4</button>
        <button type="button" class="btn" @click="shareSale(done)"><Icon name="message" />WhatsApp</button>
      </div>
      <template #foot>
        <button type="button" class="btn primary lg block" @click="newSale" autofocus>Nouvelle vente</button>
      </template>
    </Sheet>`,
};
