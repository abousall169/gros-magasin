// Caisse : recherche produit (nom, code-barres, caméra, photo), panier gros / détail, encaissement,
// vente hors ligne (gardée sur l'appareil puis envoyée au retour du réseau).
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from '../vue.js';
import { api, enqueueSale, readQueue, requestQueuedPrint, sessionToken } from '../api.js';
import { store, can, toast, toastError, ask, local, CASH, onSynced, onChange } from '../store.js';
import { t, pname, payLabel } from '../i18n.js';
import {
  money,
  qty as fmtQty,
  plural,
  norm,
  parseNum,
  round2,
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
  timeFr,
  MODE_LABEL,
} from '../format.js';
import { Icon, Sheet, Empty } from '../components/ui.js';
import { Scanner, Recognize, PhotoButton } from '../components/camera.js';
import CustomerPicker from '../components/CustomerPicker.js';
import { printTicket, printInvoice, saleText, openWhatsApp, openSms } from '../print.js';
import { sameCode } from '../barcode.js';

const MODE_NAME = { retail: 'Vente au détail', wholesale: 'Vente en gros' };
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const pad = (n) => String(n).padStart(2, '0');
const localNow = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

// ---- Panier (partagé entre l'ordinateur et la feuille du téléphone) -------------------
const CartView = {
  components: { Icon },
  props: { c: Object, closable: Boolean },
  emits: ['close'],
  template: `
    <div class="cart" :class="{ 'in-sheet': closable }">
      <div class="cart-band">
        <div class="band-top">
          <h2 class="grow">{{ t(c.modeName) }}<span class="band-count num" v-if="c.lines.length"> · {{ c.lines.length }} {{ c.lines.length > 1 ? t('articles') : t('article') }}</span></h2>
          <button v-if="c.held.length" type="button" class="band-btn" @click="c.showHeld = true"><Icon name="clock" size="sm" />{{ t('{n} en attente', { n: c.held.length }) }}</button>
          <button v-if="closable" type="button" class="icon-btn" @click="$emit('close')" :aria-label="t('Fermer le panier')"><Icon name="x" /></button>
        </div>
        <div v-if="c.cart.order" class="order-tag"><Icon name="receipt" size="sm" />{{ t('Commande n° {n} · vendeur {s}', { n: c.cart.order.id, s: c.cart.order.seller_name }) }}</div>
        <div class="mode-switch" role="group" :aria-label="t('Mode de vente')">
          <button type="button" class="retail" :class="{ on: c.mode === 'retail' }" @click="c.setMode('retail')">{{ t('Détail') }}</button>
          <button type="button" class="wholesale" :class="{ on: c.mode === 'wholesale' }" @click="c.setMode('wholesale')">{{ t('Gros') }}</button>
        </div>
        <button type="button" class="customer-btn" @click="c.picking = true">
          <Icon name="user" />
          <span class="grow">
            <small>{{ t('Client') }}</small>
            <strong>{{ c.cart.customer ? c.cart.customer.name : t('Client comptoir') }}</strong>
          </span>
          <span v-if="c.cart.customer && c.cart.customer.balance > 0" class="debt small num">{{ t('Doit') }} {{ c.money(c.cart.customer.balance) }}</span>
          <Icon name="chevronRight" size="sm" class="flip-rtl" />
        </button>
      </div>

      <div class="cart-lines">
        <div v-if="!c.lines.length" class="cart-empty">
          <Icon name="cart" />
          <p>{{ t('Touchez un produit pour l’ajouter.') }}<br>{{ t('Le mode {m} s’applique aux nouveaux articles.', { m: c.mode === 'wholesale' ? t('Gros') : t('Détail') }) }}</p>
        </div>
        <div v-for="l in c.lines" :key="l.key" class="line">
          <div class="l-name">
            {{ l.name }}
            <span class="unit-price">
              <template v-if="c.editingPrice === l.key">
                <input class="input price-input num" inputmode="decimal" :value="l.price" @change="c.setPrice(l, $event.target.value)" @blur="c.editingPrice = null" @keydown.enter="$event.target.blur()" autofocus :aria-label="t('Prix') + ' ' + l.name" />
              </template>
              <button v-else-if="c.canEditPrice" type="button" :class="{ changed: l.custom }" @click="c.editPrice(l)" :title="t('Modifier le prix')">{{ c.money(l.price, { bare: true }) }}</button>
              <span v-else :class="{ changed: l.custom }">{{ c.money(l.price, { bare: true }) }}</span>
              / {{ l.unit }}
            </span>
          </div>
          <div class="l-total">{{ c.money(l.total, { bare: true }) }}</div>
          <div class="l-controls">
            <button type="button" class="line-type" :class="l.sale_type" :disabled="!l.canToggle" @click="c.toggleLine(l)" :title="l.canToggle ? t('Changer gros / détail') : ''">{{ l.sale_type === 'wholesale' ? t('Gros') : t('Détail') }}</button>
            <div class="qty">
              <button type="button" @click="c.step(l, -1)" :aria-label="t('Diminuer')"><Icon name="minus" size="sm" /></button>
              <input :value="c.fmtQty(l.qty)" inputmode="decimal" @focus="$event.target.select()" @change="c.setQty(l, $event.target.value, $event)" @keydown.enter="$event.target.blur()" :aria-label="t('Quantité') + ' ' + l.name" />
              <button type="button" @click="c.step(l, 1)" :aria-label="t('Augmenter')"><Icon name="plus" size="sm" /></button>
            </div>
            <span class="qty-unit">{{ c.plural(l.unit, l.qty) }}</span>
            <button type="button" class="icon-btn sm remove" @click="c.remove(l)" :aria-label="t('Retirer') + ' ' + l.name"><Icon name="trash" size="sm" /></button>
          </div>
          <div v-if="l.warn" class="l-warn">{{ l.warn }}</div>
        </div>
      </div>

      <div class="cart-foot">
        <div class="sum-row" v-if="c.cart.discount > 0 || c.canDiscount">
          <span>{{ t('Sous-total') }}</span><span>{{ c.money(c.subtotal) }}</span>
        </div>
        <div class="sum-row" v-if="c.canDiscount">
          <label for="discount">{{ t('Remise') }}</label>
          <input id="discount" class="input discount-input num" inputmode="decimal" :value="c.cart.discount || ''" placeholder="0" @change="c.setDiscount($event.target.value, $event)" />
        </div>
        <div class="sum-row total"><span>{{ t('Total') }}</span><span class="amount">{{ c.money(c.total) }}</span></div>
        <div class="sum-row small muted" v-if="c.taxTotal > 0"><span>{{ t('dont TVA') }}</span><span>{{ c.money(c.taxTotal) }}</span></div>
        <div class="cart-actions">
          <button type="button" class="btn icon-only" :disabled="!c.lines.length" @click="c.hold()" :title="t('Mettre en attente')" :aria-label="t('Mettre en attente')"><Icon name="pause" /></button>
          <button type="button" class="btn" :disabled="!c.lines.length" @click="c.proforma()" :title="t('Facture proforma')" :aria-label="t('Facture proforma')"><Icon name="file" /></button>
          <button type="button" class="btn" :disabled="!c.lines.length" @click="c.clear()" :title="t('Vider le panier')" :aria-label="t('Vider le panier')"><Icon name="trash" /></button>
          <button v-if="c.canCash" type="button" class="btn mode lg" :disabled="!c.lines.length" @click="c.openPay()">{{ t('Encaisser') }}</button>
          <button v-else type="button" class="btn mode lg" :class="{ loading: c.sending }" :disabled="!c.lines.length || c.sending" @click="c.sendOrder()"><Icon name="swap" />{{ t('Envoyer à la caisse') }}</button>
        </div>
      </div>
    </div>`,
};

export default {
  components: { Icon, Sheet, Empty, CartView, CustomerPicker, Scanner, Recognize, PhotoButton },
  setup() {
    const mode = ref(local.get('mode', 'retail') === 'wholesale' ? 'wholesale' : 'retail');
    const saved = local.get('cart', null);
    const cart = reactive({
      client_id: saved?.client_id || newId(),
      items: Array.isArray(saved?.items) ? saved.items : [],
      customer: saved?.customer || null,
      discount: Number(saved?.discount) || 0,
      note: saved?.note || '',
      order: saved?.order || null, // commande d'un vendeur chargée à la caisse : { id, seller_name }
    });
    const held = ref(local.get('held', []));
    const search = ref('');
    const category = ref(0);
    const showCart = ref(false);
    const showHeld = ref(false);
    const picking = ref(false);
    const scanning = ref(false);
    const photo = ref(null);
    const editingPrice = ref(null);
    const flashId = ref(0);
    const pay = ref(null);
    const done = ref(null);
    const sent = ref(null); // commande envoyée à la caisse (vendeur)
    const sending = ref(false);
    const orders = ref([]); // commandes en attente : toutes (caisse) ou les siennes (vendeur)
    const showOrders = ref(false);
    const searchEl = ref(null);

    watch(cart, () => local.set('cart', cart), { deep: true });
    watch(mode, (m) => local.set('mode', m));

    const allowNegative = computed(() => !!store.settings.allow_negative_stock);
    // Vendeurs et caissiers peuvent changer un prix, mais seul le gérant peut descendre sous le prix fixé ou faire une remise
    const canEditPrice = computed(() => can('pos') || can('orders.send'));
    const canDiscount = computed(() => can('price.edit'));
    // Le caissier (et le gérant) encaisse ; le vendeur envoie le panier à la caisse
    const canCash = computed(() => can('pos'));
    const canSeeOrders = computed(() => can('orders.cash') || can('orders.send'));
    const byId = computed(() => new Map(store.products.map((p) => [p.id, p])));

    // ---- Catalogue filtré ----
    const filtered = computed(() => {
      const words = norm(search.value).split(/\s+/).filter(Boolean);
      return store.products.filter((p) => {
        if (category.value && p.category_id !== category.value) return false;
        if (!words.length) return true;
        const hay = norm(`${p.name} ${p.name_ar || ''} ${p.barcode || ''}`);
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
          return { ...it, name: t('Produit indisponible'), unit: '', price: 0, total: 0, canToggle: false, warn: t('Ce produit a été retiré de la vente : supprimez la ligne.') };
        }
        const price = it.unit_price ?? listPrice(p, it.sale_type);
        let warn = '';
        if (!allowNegative.value) {
          const need = needOf(p.id);
          if (need > Number(p.stock) + 1e-9) warn = t('Stock insuffisant : il reste {s}.', { s: stockText(p) });
        }
        return {
          ...it,
          p,
          name: pname(p),
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
    // TVA comprise dans les prix (affichage ; le serveur fait le calcul officiel)
    const taxTotal = computed(() => {
      const s = store.settings;
      if (!s.tax_enabled || !subtotal.value) return 0;
      const ratio = total.value / subtotal.value;
      return round2(
        lines.value.reduce((acc, l) => {
          const rate = Number(l.p?.tax_rate ?? s.tax_rate) || 0;
          const net = l.total * ratio;
          return acc + (rate > 0 ? net - net / (1 + rate / 100) : 0);
        }, 0),
      );
    });

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
          toast(t('Stock insuffisant pour « {p} » : il reste {s}.', { p: pname(p), s: stockText(p) }), 'error');
          return;
        }
      }
      navigator.vibrate?.(15);
      const line = cart.items.find((i) => i.product_id === p.id && i.sale_type === type && (i.unit_price === null || i.unit_price === undefined));
      if (line) line.qty = round3(Number(line.qty) + amount);
      else cart.items.push({ key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, product_id: p.id, sale_type: type, qty: amount, unit_price: null });
      flash(p.id);
    };

    const findByCode = (code) => store.products.find((p) => sameCode(p.barcode, code));
    const onSearchEnter = () => {
      const term = search.value.trim();
      if (!term) return;
      const exact = findByCode(term);
      const pick = exact || (filtered.value.length === 1 ? filtered.value[0] : null);
      if (pick) {
        add(pick);
        search.value = '';
      } else if (!filtered.value.length) toast(t('Aucun produit pour « {q} ».', { q: term }), 'error');
    };
    const onScan = (code) => {
      scanning.value = false;
      const p = findByCode(code);
      if (p) add(p);
      else toast(t('Aucun produit avec le code {c}.', { c: code }), 'error');
    };
    const onRecognized = (p) => {
      photo.value = null;
      add(p);
    };

    const step = (l, delta) => {
      const it = cart.items.find((i) => i.key === l.key);
      if (!it) return;
      const next = round3(Number(it.qty) + delta);
      if (next <= 0) return remove(l);
      const p = byId.value.get(it.product_id);
      if (delta > 0 && p && !allowNegative.value) {
        const after = needOf(p.id) + delta * unitsPer(p, it.sale_type);
        if (after > Number(p.stock) + 1e-9) return toast(t('Stock insuffisant : il reste {s}.', { s: stockText(p) }), 'error');
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
      if (n < list - 0.004 && !canDiscount.value) {
        toast(t('Le prix ne peut pas être inférieur au prix fixé par le gérant ({p}).', { p: money(list) }), 'error', 4500);
        return;
      }
      it.unit_price = Math.abs(n - list) < 0.005 ? null : n;
    };
    const setDiscount = (value, ev) => {
      const n = value === '' ? 0 : parseNum(value);
      if (!(n >= 0) || n > subtotal.value) {
        toast(t('Remise invalide.'), 'error');
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
        toast(m === 'wholesale' ? t('Tout le panier passe au prix de gros.') : t('Tout le panier passe au prix de détail.'));
      }
    };

    const pickCustomer = (c) => {
      picking.value = false;
      cart.customer = c ? { id: c.id, name: c.name, phone: c.phone, type: c.type, balance: c.balance || 0, credit_limit: c.credit_limit || 0 } : null;
      if (c && !cart.items.length) setMode(c.type === 'wholesale' ? 'wholesale' : 'retail');
      if (pay.value) pay.value.error = '';
    };

    const resetCart = () => {
      cart.client_id = newId();
      cart.items = [];
      cart.customer = null;
      cart.discount = 0;
      cart.note = '';
      cart.order = null;
    };
    const clear = async () => {
      if (await ask({ title: t('Vider le panier ?'), message: t('Tous les articles seront retirés.'), confirm: t('Vider'), danger: true })) resetCart();
    };
    const hold = () => {
      if (!cart.items.length) return;
      held.value.unshift({ id: Date.now(), at: new Date().toISOString(), mode: mode.value, client_id: cart.client_id, items: JSON.parse(JSON.stringify(cart.items)), customer: cart.customer, discount: cart.discount, note: cart.note, order: cart.order });
      local.set('held', held.value);
      resetCart();
      showCart.value = false;
      toast(t('Panier mis en attente.'));
    };
    const restore = (h) => {
      if (cart.items.length) hold();
      cart.client_id = h.client_id || newId();
      cart.items = h.items;
      cart.customer = h.customer;
      cart.discount = h.discount || 0;
      cart.note = h.note || '';
      cart.order = h.order || null;
      mode.value = h.mode === 'wholesale' ? 'wholesale' : 'retail';
      held.value = held.value.filter((x) => x.id !== h.id);
      local.set('held', held.value);
      showHeld.value = false;
    };
    const dropHeld = (h) => {
      held.value = held.value.filter((x) => x.id !== h.id);
      local.set('held', held.value);
    };

    // ---- Commandes : le vendeur envoie le panier à la caisse, le caissier l'encaisse ----
    const loadOrders = async (notify = false) => {
      if (!canSeeOrders.value) return;
      try {
        const list = await api.get('/orders');
        if (notify && canCash.value) {
          const known = new Set(orders.value.map((o) => o.id));
          const fresh = list.filter((o) => !known.has(o.id));
          if (fresh.length) {
            navigator.vibrate?.([80, 60, 80]);
            toast(
              fresh.length > 1 ? t('{n} nouvelles commandes à encaisser.', { n: fresh.length }) : t('Nouvelle commande de {s} à encaisser.', { s: fresh[0].seller_name }),
              'info',
              6000,
            );
          }
        }
        orders.value = list;
      } catch {
        /* hors ligne : la liste revient avec le réseau */
      }
    };
    const cartFromOrder = (o) => {
      if (cart.items.length) hold();
      cart.client_id = newId();
      cart.items = o.items.map((it, i) => {
        // Prix figé à l'envoi : on le garde seulement s'il diffère du prix actuel du gérant
        const p = byId.value.get(it.product_id);
        const same = p && it.unit_price != null && Math.abs(it.unit_price - listPrice(p, it.sale_type)) < 0.005;
        return { key: `${o.id}-${i}`, product_id: it.product_id, sale_type: it.sale_type, qty: it.qty, unit_price: same ? null : it.unit_price };
      });
      cart.customer = o.customer_id
        ? { id: o.customer_id, name: o.customer_name, phone: o.customer_phone, type: o.customer_type, balance: o.customer_balance || 0, credit_limit: o.customer_credit_limit || 0 }
        : null;
      cart.discount = 0;
      cart.note = o.note || '';
      cart.order = null;
      mode.value = o.mode === 'wholesale' ? 'wholesale' : 'retail';
    };
    const sendOrder = async () => {
      if (!cart.items.length || sending.value) return;
      const bad = lines.value.find((l) => l.warn);
      if (bad) return toast(`${bad.name} : ${bad.warn}`, 'error');
      sending.value = true;
      try {
        const o = await api.post('/orders', {
          customer_id: cart.customer?.id || null,
          items: cart.items.map((it) => ({ product_id: it.product_id, sale_type: it.sale_type, qty: it.qty, unit_price: it.unit_price ?? null })),
          note: cart.note,
        });
        resetCart();
        showCart.value = false;
        sent.value = o;
        loadOrders();
      } catch (e) {
        toast(e.status === 0 ? t('Pas de réseau : la commande n’a pas pu être envoyée à la caisse. Réessayez quand la connexion revient.') : e.message, 'error', 6000);
      } finally {
        sending.value = false;
      }
    };
    const cashOrder = (o) => {
      cartFromOrder(o);
      cart.order = { id: o.id, seller_name: o.seller_name };
      showOrders.value = false;
      nextTick(() => openPay());
    };
    const takeBack = async (o) => {
      try {
        await api.post(`/orders/${o.id}/cancel`);
        cartFromOrder(o);
        showOrders.value = false;
        loadOrders();
        toast(t('Commande reprise : modifiez-la puis renvoyez-la.'));
      } catch (e) {
        toastError(e);
      }
    };
    const cancelOrder = async (o) => {
      const yes = await ask({
        title: t('Annuler la commande n° {n} ?', { n: o.id }),
        message: t('Elle disparaît de la liste à encaisser. Rien n’est vendu ni retiré du stock.'),
        confirm: t('Annuler la commande'),
        danger: true,
      });
      if (!yes) return;
      try {
        await api.post(`/orders/${o.id}/cancel`);
        if (cart.order?.id === o.id) cart.order = null;
        loadOrders();
      } catch (e) {
        toastError(e);
      }
    };
    const closeSent = () => {
      sent.value = null;
      nextTick(() => {
        if (window.matchMedia('(pointer: fine)').matches) searchEl.value?.focus();
      });
    };

    const draftSale = () => ({
      id: 0,
      created_at: localNow(),
      customer_name: cart.customer?.name,
      customer_phone: cart.customer?.phone,
      subtotal: subtotal.value,
      discount: Number(cart.discount) || 0,
      total: total.value,
      tax_total: taxTotal.value,
      items: lines.value.map((l) => ({ name: l.p?.name || l.name, sale_type: l.sale_type, qty: l.qty, unit_label: l.unit, unit_price: l.price, total: l.total })),
    });
    const proforma = () => printInvoice(draftSale(), { proforma: true });

    // ---- Encaissement ----
    const quickSteps = computed(() => (decimals() === 2 ? [1, 5, 10, 20, 50, 100] : [500, 1000, 2000, 5000, 10000, 25000]));
    const openPay = () => {
      if (!cart.items.length) return;
      const bad = lines.value.find((l) => l.warn);
      if (bad) return toast(`${bad.name} : ${bad.warn}`, 'error');
      pay.value = { lines: [{ method: CASH, amount: String(total.value), reference: '' }], busy: false, error: '' };
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
      return { cash, other, cashApplied: roundMoney(cashApplied), change, paid, rest, overpaidOther: other > total.value + 0.004 };
    });
    const quickCash = computed(() => {
      const tt = total.value;
      const out = [];
      for (const s of quickSteps.value) {
        const v = Math.ceil(tt / s) * s;
        if (v > tt && !out.includes(v)) out.push(v);
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
      pay.value.lines.push({ method, amount: rest > 0 ? String(rest) : '', reference: '' });
    };
    const fullCredit = () => {
      pay.value.lines = [{ method: CASH, amount: '0', reference: '' }];
    };

    /** Vente gardée sur l'appareil (pas de réseau) : ticket local, stock local, envoi plus tard. */
    const saveOffline = (payload) => {
      const n = payNums.value;
      enqueueSale({ payload, at: Date.now(), token: sessionToken.get(), user: store.me.name });
      store.pending = readQueue().length;
      store.online = false;
      for (const l of lines.value) {
        if (l.p) l.p.stock = round3(Number(l.p.stock) - Number(l.qty) * unitsPer(l.p, l.sale_type));
      }
      local.set('products', store.products);
      const payments = pay.value.lines
        .filter((l) => l.method !== CASH && parseNum(l.amount) > 0)
        .map((l) => ({ method: l.method, amount: parseNum(l.amount), reference: l.reference || null }));
      if (n.cashApplied > 0) payments.push({ method: CASH, amount: n.cashApplied });
      const types = new Set(lines.value.map((l) => l.sale_type));
      return {
        id: null,
        offline: true,
        client_id: payload.client_id,
        created_at: localNow(),
        user_name: store.me.name,
        customer_id: cart.customer?.id || null,
        customer_name: cart.customer?.name,
        customer_phone: cart.customer?.phone,
        mode: types.size > 1 ? 'mixed' : [...types][0],
        subtotal: subtotal.value,
        discount: Number(cart.discount) || 0,
        total: total.value,
        paid: n.paid,
        received: roundMoney(n.cash + n.other),
        change_given: n.change,
        credit: n.rest,
        tax_total: taxTotal.value,
        payments,
        items: lines.value.map((l) => ({ name: l.p?.name || l.name, name_ar: l.p?.name_ar, sale_type: l.sale_type, qty: l.qty, unit_label: l.unit, unit_price: l.price, total: l.total })),
      };
    };

    const confirmSale = async () => {
      const p = pay.value;
      const n = payNums.value;
      p.error = '';
      if (n.overpaidOther) return (p.error = t('Les paiements hors espèces dépassent le total.'));
      if (n.rest > 0) {
        if (!cart.customer) return (p.error = t('Il reste un montant à payer : choisissez le client pour le mettre à crédit.'));
        if (!can('credit.sell')) return (p.error = t('Vous n’êtes pas autorisé à vendre à crédit.'));
      }
      const payload = {
        client_id: cart.client_id,
        customer_id: cart.customer?.id || null,
        order_id: cart.order?.id || null,
        items: cart.items.map((it) => {
          const prod = byId.value.get(it.product_id);
          // Prix fixé au moment de la vente : une vente faite hors ligne garde le prix affiché
          const unit = it.unit_price ?? (prod ? listPrice(prod, it.sale_type) : null);
          return { product_id: it.product_id, sale_type: it.sale_type, qty: it.qty, unit_price: it.unit_price ?? null, offline_price: unit };
        }),
        discount: Number(cart.discount) || 0,
        payments: p.lines.map((l) => ({ method: l.method, amount: parseNum(l.amount) || 0, reference: l.method === CASH ? null : l.reference || null })),
        note: cart.note,
      };
      p.busy = true;
      try {
        const sale = await api.post('/sales', payload);
        // Mise à jour immédiate du stock affiché (les autres appareils reçoivent l'événement)
        for (const it of sale.items) {
          const prod = byId.value.get(it.product_id);
          if (prod) prod.stock = round3(Number(prod.stock) - Number(it.base_qty));
        }
        resetCart();
        pay.value = null;
        done.value = sale;
        if (payload.order_id) loadOrders();
        if (store.settings.auto_print && store.settings.printer) printTicket(sale);
      } catch (e) {
        if (e.status === 0) {
          // Pas de réseau : la vente est gardée sur l'appareil et partira toute seule au retour du réseau
          const offlinePayload = { ...payload, items: payload.items.map(({ offline_price, ...it }) => ({ ...it, unit_price: it.unit_price ?? offline_price })) };
          const offlineSale = saveOffline(offlinePayload);
          resetCart();
          pay.value = null;
          done.value = offlineSale;
        } else p.error = e.message;
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
    const smsSale = (s) => openSms(saleText(s), s.customer_phone);
    const printLater = () => {
      requestQueuedPrint(done.value.client_id);
      done.value = { ...done.value, printQueued: true };
      toast(t('Le ticket sortira au retour du réseau.'));
    };

    // Vente hors ligne enfin enregistrée : impression demandée plus tôt
    const offSynced = onSynced((sale, entry) => {
      if (entry.print) printTicket(sale);
    });

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
        if (canCash.value) openPay();
        else sendOrder();
        return;
      }
      if (!typing && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && window.matchMedia('(pointer: fine)').matches) {
        searchEl.value?.focus();
      }
    };
    let offOrders = null;
    onMounted(() => {
      document.addEventListener('keydown', onKey);
      if (window.matchMedia('(pointer: fine)').matches) searchEl.value?.focus();
      loadOrders();
      offOrders = onChange('orders', () => loadOrders(true));
    });
    onUnmounted(() => {
      document.removeEventListener('keydown', onKey);
      offSynced();
      offOrders?.();
    });

    const ctx = reactive({
      cart,
      mode,
      modeName: computed(() => MODE_NAME[mode.value]),
      lines,
      subtotal,
      total,
      taxTotal,
      canDiscount,
      canCash,
      sending,
      sendOrder,
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
      scanning,
      photo,
      held,
      flashId,
      pay,
      payNums,
      quickCash,
      done,
      sent,
      orders,
      showOrders,
      canCash,
      cashOrder,
      takeBack,
      cancelOrder,
      closeSent,
      timeFr,
      searchEl,
      itemCount,
      total,
      allowNegative,
      add,
      onSearchEnter,
      onScan,
      onRecognized,
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
      smsSale,
      printLater,
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
      pname,
      payLabel,
      MODE_LABEL,
      can,
      CASH,
    };
  },
  template: `
    <div class="pos" :class="'mode-' + mode">
      <section class="pos-products" :aria-label="t('Produits')">
        <div class="pos-head">
          <div class="search-row">
            <div class="input-affix">
              <Icon name="search" />
              <input ref="searchEl" class="input" type="search" v-model="search" @keydown.enter.prevent="onSearchEnter"
                     :placeholder="t('Produit ou code-barres…')" autocomplete="off" enterkeyhint="search" :aria-label="t('Rechercher un produit')" />
            </div>
            <button type="button" class="btn icon-only cam-btn" @click="scanning = true" :title="t('Scanner un code-barres')" :aria-label="t('Scanner un code-barres')"><Icon name="scan" /></button>
            <PhotoButton cls="btn icon-only cam-btn" icon="camera" :title="t('Reconnaître par photo')" @file="photo = $event" />
            <div class="mode-switch hide-desktop-cart" role="group" :aria-label="t('Mode de vente')">
              <button type="button" class="retail" :class="{ on: mode === 'retail' }" @click="setMode('retail')">{{ t('Détail') }}</button>
              <button type="button" class="wholesale" :class="{ on: mode === 'wholesale' }" @click="setMode('wholesale')">{{ t('Gros') }}</button>
            </div>
          </div>
          <button v-if="orders.length" type="button" class="orders-bar" @click="showOrders = true">
            <Icon name="receipt" />
            <span class="grow">{{ canCash ? t('{n} commande(s) de vendeurs à encaisser', { n: orders.length }) : t('{n} commande(s) envoyée(s), en attente à la caisse', { n: orders.length }) }}</span>
            <strong>{{ t('Voir') }}</strong>
          </button>
          <div class="chips" v-if="categories.length">
            <button type="button" class="chip" :class="{ on: !category }" @click="category = 0">{{ t('Tous') }}</button>
            <button v-for="c in categories" :key="c.id" type="button" class="chip" :class="{ on: category === c.id }" @click="category = category === c.id ? 0 : c.id">{{ c.name }}</button>
          </div>
        </div>

        <div class="pos-grid">
          <button v-for="p in visible" :key="p.id" type="button" class="tile" :class="{ flash: flashId === p.id }"
                  :disabled="!allowNegative && p.stock <= 0" @click="add(p)">
            <span class="t-name" :class="{ 'has-qty': inCart.get(p.id) }">{{ pname(p) }}</span>
            <span class="t-qty" v-if="inCart.get(p.id)">{{ fmtQty(inCart.get(p.id)) }}</span>
            <span class="t-prices">
              <span class="price-line retail" :class="{ active: mode === 'retail' }"><i class="k"></i><b>{{ money(p.retail_price, { bare: true }) }}</b>/ {{ p.unit }}</span>
              <span v-if="sellsWholesale(p)" class="price-line wholesale" :class="{ active: mode === 'wholesale' }"><i class="k"></i><b>{{ money(listPrice(p, 'wholesale'), { bare: true }) }}</b>/ {{ hasPack(p) ? p.pack_unit : p.unit }}</span>
            </span>
            <span class="t-stock" :class="{ low: stockLevel(p) !== 'ok' }">
              {{ stockLevel(p) === 'out' ? t('Rupture de stock') : stockText(p) }}
            </span>
          </button>
          <Empty v-if="store.productsLoaded && !filtered.length" icon="search" :title="search ? t('Aucun produit trouvé') : t('Aucun produit')"
                 :text="search ? t('Vérifiez l’orthographe ou cherchez une partie du nom.') : (can('products.manage') ? t('Ajoutez vos produits dans la page Produits.') : t('Demandez au gérant d’ajouter les produits.'))" style="grid-column: 1 / -1" />
          <p v-if="filtered.length > visible.length" class="small muted" style="grid-column: 1 / -1; padding: 8px 4px">
            {{ t('{n} autres produits : précisez la recherche.', { n: filtered.length - visible.length }) }}
          </p>
        </div>
      </section>

      <CartView class="cart-desktop" :c="ctx" />

      <button v-if="itemCount" type="button" class="cartbar" @click="showCart = true">
        <span class="count">{{ itemCount }}</span>
        <span>{{ t('Voir le panier') }}</span>
        <span class="amount">{{ money(total) }}</span>
      </button>
    </div>

    <!-- Panier en plein écran (téléphone) -->
    <teleport to="body" v-if="showCart">
      <div class="sheet-backdrop" :class="'mode-' + mode" @mousedown.self="showCart = false">
        <section class="sheet full" role="dialog" aria-modal="true" :aria-label="t('Panier')">
          <CartView :c="ctx" closable @close="showCart = false" />
        </section>
      </div>
    </teleport>

    <CustomerPicker v-if="ctx.picking" :current="cart.customer" @pick="pickCustomer" @close="ctx.picking = false" />
    <Scanner v-if="scanning" @detect="onScan" @close="scanning = false" />
    <Recognize v-if="photo" :file="photo" @pick="onRecognized" @close="photo = null" />

    <!-- Paniers en attente -->
    <Sheet v-if="ctx.showHeld" :title="t('Paniers en attente')" @close="ctx.showHeld = false">
      <div class="list">
        <div v-for="h in held" :key="h.id" class="list-row">
          <div class="main-col">
            <div class="title">{{ h.customer ? h.customer.name : t('Client comptoir') }}</div>
            <div class="sub">{{ t('{n} article(s)', { n: h.items.length }) }} · {{ t(MODE_LABEL[h.mode]) }} · {{ t('mis en attente à {h}', { h: new Date(h.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }) }}</div>
          </div>
          <button type="button" class="btn sm" @click="dropHeld(h)" :aria-label="t('Supprimer')"><Icon name="trash" size="sm" /></button>
          <button type="button" class="btn sm primary" @click="restore(h)">{{ t('Reprendre') }}</button>
        </div>
      </div>
    </Sheet>

    <!-- Encaissement -->
    <Sheet v-if="pay" :title="t('Encaissement')" band full :cls="'mode-' + mode" @close="pay = null">
      <template #head><strong class="num" style="font-size: 1.4375rem">{{ money(total) }}</strong></template>
      <div class="stack loose">
        <div v-if="!store.online" class="alert"><Icon name="wifi" /><span>{{ t('Hors ligne : la vente sera gardée sur cet appareil et envoyée au retour du réseau.') }}</span></div>
        <button type="button" class="customer-btn" style="background: var(--ground)" @click="ctx.picking = true">
          <Icon name="user" />
          <span class="grow"><small>{{ t('Client') }}</small><strong>{{ cart.customer ? cart.customer.name : t('Client comptoir') }}</strong></span>
          <span v-if="cart.customer && cart.customer.balance > 0" class="debt small num">{{ t('Doit déjà') }} {{ money(cart.customer.balance) }}</span>
          <Icon name="chevronRight" size="sm" class="flip-rtl" />
        </button>

        <div class="stack" v-for="(l, i) in pay.lines" :key="i">
          <div class="methods" role="group" :aria-label="t('Moyen de paiement') + ' ' + (i + 1)">
            <button v-for="m in store.paymentMethods" :key="m" type="button" class="method" :class="{ on: l.method === m }" @click="l.method = m">{{ payLabel(m) }}</button>
          </div>
          <div class="pay-line">
            <label class="label" :for="'pay-' + i">{{ l.method === CASH ? t('Montant reçu') : t('Montant payé') }}</label>
            <input :id="'pay-' + i" class="input num" inputmode="decimal" v-model="l.amount" @focus="$event.target.select()" />
            <button v-if="pay.lines.length > 1" type="button" class="icon-btn" @click="pay.lines.splice(i, 1)" :aria-label="t('Retirer ce paiement')"><Icon name="x" /></button>
            <span v-else></span>
          </div>
          <input v-if="l.method !== CASH" class="input" v-model="l.reference" maxlength="60" dir="ltr" :placeholder="t('N° de transaction (facultatif)')" :aria-label="t('N° de transaction')" />
          <div class="quick-cash" v-if="l.method === CASH">
            <button type="button" @click="setPayAmount(i, total)">{{ t('Montant exact') }}</button>
            <button v-for="v in quickCash" :key="v" type="button" @click="setPayAmount(i, v)">{{ money(v, { bare: true }) }}</button>
          </div>
        </div>
        <div class="row wrap">
          <button type="button" class="btn sm" @click="addPayLine"><Icon name="plus" size="sm" />{{ t('Autre moyen de paiement') }}</button>
          <button v-if="can('credit.sell')" type="button" class="btn sm" @click="fullCredit"><Icon name="clock" size="sm" />{{ t('Tout à crédit') }}</button>
        </div>

        <div class="pay-summary">
          <div class="sum-row"><span>{{ t('Total à payer') }}</span><span>{{ money(total) }}</span></div>
          <div class="sum-row"><span>{{ t('Payé') }}</span><span>{{ money(payNums.paid) }}</span></div>
          <div class="sum-row big change" v-if="payNums.change > 0"><span>{{ t('Monnaie à rendre') }}</span><span>{{ money(payNums.change) }}</span></div>
          <div class="sum-row big rest" v-if="payNums.rest > 0"><span>{{ t('Reste (crédit)') }}</span><span>{{ money(payNums.rest) }}</span></div>
          <p class="small" v-if="payNums.rest > 0 && cart.customer">{{ t('Le reste sera ajouté au compte de {c}.', { c: cart.customer.name }) }}</p>
          <p class="small muted" v-if="pay.lines.some(l => l.method !== CASH)">{{ t('Vérifiez le message de confirmation du paiement mobile avant de valider.') }}</p>
        </div>
        <div v-if="pay.error" class="alert danger" role="alert"><Icon name="alert" /><span>{{ pay.error }}</span></div>
      </div>
      <template #foot>
        <button type="button" class="btn" @click="pay = null">{{ t('Retour') }}</button>
        <button type="button" class="btn mode lg" :class="{ loading: pay.busy }" :disabled="pay.busy" @click="confirmSale">
          {{ payNums.rest > 0 ? t('Valider avec crédit') : t('Valider la vente') }}
        </button>
      </template>
    </Sheet>

    <!-- Commandes en attente : à encaisser (caisse) ou envoyées (vendeur) -->
    <Sheet v-if="showOrders" :title="canCash ? t('Commandes à encaisser') : t('Mes commandes envoyées')" @close="showOrders = false">
      <div v-if="orders.length" class="list">
        <div v-for="o in orders" :key="o.id" class="list-row">
          <div class="main-col">
            <div class="title">{{ t('Commande n° {n}', { n: o.id }) }} · {{ money(o.total) }}</div>
            <div class="sub">{{ o.customer_name || t('Client comptoir') }} · {{ t('{n} article(s)', { n: o.items.length }) }}<template v-if="canCash"> · {{ t('vendeur {s}', { s: o.seller_name }) }}</template> · {{ timeFr(o.created_at) }}</div>
          </div>
          <button type="button" class="icon-btn sm" @click="cancelOrder(o)" :aria-label="t('Annuler la commande')" :title="t('Annuler la commande')"><Icon name="trash" size="sm" /></button>
          <button v-if="canCash" type="button" class="btn sm primary" @click="cashOrder(o)">{{ t('Encaisser') }}</button>
          <button v-else type="button" class="btn sm" @click="takeBack(o)">{{ t('Reprendre') }}</button>
        </div>
      </div>
      <p v-else class="small muted">{{ t('Aucune commande en attente.') }}</p>
    </Sheet>

    <!-- Commande envoyée à la caisse (vendeur) -->
    <Sheet v-if="sent" :title="t('Commande envoyée')" size="narrow" @close="closeSent">
      <div class="done">
        <div class="tick"><Icon name="check" /></div>
        <h2>{{ t('Envoyée à la caisse') }}</h2>
        <div class="change-due"><small>{{ t('Numéro de commande') }}</small><strong>{{ sent.id }}</strong></div>
        <p class="muted small">{{ money(sent.total) }}{{ sent.customer_name ? ' · ' + sent.customer_name : '' }}</p>
        <p class="small">{{ t('Le client va payer à la caisse en donnant ce numéro.') }}</p>
      </div>
      <template #foot>
        <button type="button" class="btn primary lg block" @click="closeSent" autofocus>{{ t('Nouvelle vente') }}</button>
      </template>
    </Sheet>

    <!-- Vente terminée -->
    <Sheet v-if="done" :title="done.id ? t('Vente') + ' ' + saleNo(done.id) : t('Vente hors ligne')" size="narrow" @close="newSale">
      <div class="done">
        <div class="tick" :class="{ offline: done.offline }"><Icon :name="done.offline ? 'clock' : 'check'" /></div>
        <h2>{{ done.offline ? t('Vente gardée sur l’appareil') : t('Vente enregistrée') }}</h2>
        <p class="muted small">{{ t(MODE_LABEL[done.mode]) }} · {{ money(done.total) }}{{ done.customer_name ? ' · ' + done.customer_name : '' }}{{ done.seller_name ? ' · ' + t('vendeur {s}', { s: done.seller_name }) : '' }}</p>
        <div v-if="done.offline" class="alert" style="text-align:start"><Icon name="wifi" /><span>{{ t('Pas de réseau : la vente partira toute seule au retour de la connexion, avec sa vraie date. Elle n’est jamais perdue.') }}</span></div>
        <div class="change-due" v-if="done.change_given > 0"><small>{{ t('Monnaie à rendre') }}</small><strong>{{ money(done.change_given) }}</strong></div>
        <div class="alert danger" v-if="done.credit > 0 && !done.offline"><Icon name="clock" /><span>{{ t('{a} mis à crédit. Nouveau solde de {c} :', { a: money(done.credit), c: done.customer_name }) }} <b>{{ money(done.customer_balance) }}</b></span></div>
        <div class="alert danger" v-else-if="done.credit > 0"><Icon name="clock" /><span>{{ t('{a} mis à crédit au compte de {c}.', { a: money(done.credit), c: done.customer_name }) }}</span></div>
      </div>
      <div class="done-actions">
        <button v-if="done.offline && store.settings.printer" type="button" class="btn" :disabled="done.printQueued" @click="printLater"><Icon name="printer" />{{ done.printQueued ? t('Ticket au retour du réseau') : t('Imprimer au retour du réseau') }}</button>
        <button v-else type="button" class="btn" @click="printTicket(done)"><Icon name="printer" />{{ t('Ticket') }}</button>
        <button type="button" class="btn" @click="printInvoice(done)" v-if="!done.offline"><Icon name="file" />{{ t('Facture A4') }}</button>
        <button type="button" class="btn" @click="shareSale(done)"><Icon name="message" />WhatsApp</button>
        <button type="button" class="btn" @click="smsSale(done)"><Icon name="phone" />SMS</button>
      </div>
      <template #foot>
        <button type="button" class="btn primary lg block" @click="newSale" autofocus>{{ t('Nouvelle vente') }}</button>
      </template>
    </Sheet>`,
};
