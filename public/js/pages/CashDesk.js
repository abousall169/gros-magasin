// Caisse du caissier : liste des ventes envoyées par les vendeurs. Il en choisit une et l'encaisse,
// sans pouvoir la modifier (articles, prix et client restent ceux du vendeur).
// Le total de sa caisse et « Terminer la journée » sont dans le menu (main.js) ; ses dépenses, dans la page « Dépenses ».
import { ref, computed, onMounted, onUnmounted } from '../vue.js';
import { api, enqueueSale, readQueue, requestQueuedPrint, sessionToken } from '../api.js';
import { store, can, toast, onChange, onSynced, CASH } from '../store.js';
import { t, pname, payLabel } from '../i18n.js';
import { money, qty as fmtQty, plural, parseNum, roundMoney, decimals, listPrice, unitLabel, timeFr, saleNo, MODE_LABEL, TYPE_LABEL, modeClass } from '../format.js';
import { Icon, Sheet, Empty, Skeleton } from '../components/ui.js';
import { printTicket, printInvoice, saleText, openWhatsApp, openSms } from '../print.js';

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const pad = (n) => String(n).padStart(2, '0');
const localNow = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

export default {
  components: { Icon, Sheet, Empty, Skeleton },
  setup() {
    const orders = ref(null);
    const pay = ref(null); // { order, lines, payments: [...], busy, error, clientId }
    const done = ref(null);
    const byId = computed(() => new Map(store.products.map((p) => [p.id, p])));

    const load = async (notify = false) => {
      try {
        const list = await api.get('/orders');
        if (notify && orders.value) {
          const known = new Set(orders.value.map((o) => o.id));
          const fresh = list.filter((o) => !known.has(o.id));
          if (fresh.length) {
            if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.([80, 60, 80]);
            toast(
              fresh.length > 1 ? t('{n} nouvelles ventes à encaisser.', { n: fresh.length }) : t('Nouvelle vente de {s} à encaisser.', { s: fresh[0].seller_name }),
              'info',
              6000,
            );
          }
        }
        orders.value = list;
        // Vente ouverte à l'écran mais encaissée ou annulée ailleurs entre-temps
        if (pay.value && !pay.value.busy && !list.some((o) => o.id === pay.value.order.id)) {
          pay.value.gone = true;
          pay.value.error = t('Cette vente vient d’être encaissée ou annulée sur un autre appareil.');
        }
      } catch {
        if (!orders.value) orders.value = [];
      }
    };

    /** Lignes lisibles d'une vente envoyée (prix du vendeur, ou prix du gérant s'il n'a rien changé). */
    const linesOf = (o) =>
      o.items.map((it) => {
        const p = byId.value.get(it.product_id);
        const price = it.unit_price ?? (p ? listPrice(p, it.sale_type) : 0);
        return {
          name: p ? pname(p) : t('Produit indisponible'),
          sale_type: it.sale_type,
          qty: it.qty,
          unit: p ? unitLabel(p, it.sale_type) : '',
          price,
          total: roundMoney(it.qty * price),
        };
      });
    const preview = (o) =>
      linesOf(o)
        .slice(0, 4)
        .map((l) => `${l.name} × ${fmtQty(l.qty)} ${plural(l.unit, l.qty)}`.trim())
        .join(', ') + (o.items.length > 4 ? ` ${t('+ {n} autre(s)', { n: o.items.length - 4 })}` : '');

    // ---- Encaissement ----
    const open = (o) => {
      pay.value = {
        order: o,
        lines: linesOf(o),
        payments: [{ method: CASH, amount: String(o.total), reference: '' }],
        busy: false,
        gone: false,
        error: '',
        clientId: newId(),
      };
    };
    const total = computed(() => pay.value?.order.total || 0);
    const nums = computed(() => {
      if (!pay.value) return null;
      const ls = pay.value.payments.map((l) => ({ method: l.method, amount: Math.max(0, parseNum(l.amount) || 0) }));
      const cash = ls.filter((l) => l.method === CASH).reduce((s, l) => s + l.amount, 0);
      const other = ls.filter((l) => l.method !== CASH).reduce((s, l) => s + l.amount, 0);
      const cashApplied = Math.max(0, Math.min(cash, total.value - other));
      return {
        cash,
        other,
        cashApplied: roundMoney(cashApplied),
        change: roundMoney(cash - cashApplied),
        paid: roundMoney(other + cashApplied),
        rest: roundMoney(total.value - other - cashApplied),
        overpaidOther: other > total.value + 0.004,
      };
    });
    const quickCash = computed(() => {
      const steps = decimals() === 2 ? [1, 5, 10, 20, 50, 100] : [500, 1000, 2000, 5000, 10000, 25000];
      const out = [];
      for (const s of steps) {
        const v = Math.ceil(total.value / s) * s;
        if (v > total.value && !out.includes(v)) out.push(v);
      }
      return out.slice(0, 4);
    });
    const canCredit = computed(() => !!pay.value?.order.customer_id && can('credit.sell'));
    const addPayLine = () => {
      const used = new Set(pay.value.payments.map((l) => l.method));
      const method = store.paymentMethods.find((m) => !used.has(m)) || CASH;
      pay.value.payments.push({ method, amount: nums.value.rest > 0 ? String(nums.value.rest) : '', reference: '' });
    };
    const fullCredit = () => {
      pay.value.payments = [{ method: CASH, amount: '0', reference: '' }];
    };

    /** Pas de réseau : la vente est gardée sur l'appareil et part toute seule au retour du réseau. */
    const saveOffline = (payload) => {
      const p = pay.value;
      const n = nums.value;
      enqueueSale({ payload, at: Date.now(), token: sessionToken.get(), user: store.me.name });
      store.pending = readQueue().length;
      store.online = false;
      const payments = p.payments
        .filter((l) => l.method !== CASH && parseNum(l.amount) > 0)
        .map((l) => ({ method: l.method, amount: parseNum(l.amount), reference: l.reference || null }));
      if (n.cashApplied > 0) payments.push({ method: CASH, amount: n.cashApplied });
      return {
        id: null,
        offline: true,
        client_id: payload.client_id,
        created_at: localNow(),
        user_name: store.me.name,
        seller_name: p.order.seller_name,
        customer_id: p.order.customer_id,
        customer_name: p.order.customer_name,
        customer_phone: p.order.customer_phone,
        mode: p.order.mode,
        subtotal: total.value,
        discount: 0,
        total: total.value,
        paid: n.paid,
        received: roundMoney(n.cash + n.other),
        change_given: n.change,
        credit: n.rest,
        payments,
        items: p.lines.map((l) => ({ name: l.name, sale_type: l.sale_type, qty: l.qty, unit_label: l.unit, unit_price: l.price, total: l.total })),
      };
    };

    const confirm = async () => {
      const p = pay.value;
      const n = nums.value;
      p.error = '';
      if (n.overpaidOther) return (p.error = t('Les paiements hors espèces dépassent le total.'));
      if (n.rest > 0) {
        if (!p.order.customer_id) return (p.error = t('Le montant reçu ne couvre pas le total. Sans client enregistré, la vente ne peut pas être mise à crédit.'));
        if (!can('credit.sell')) return (p.error = t('Vous n’êtes pas autorisé à vendre à crédit.'));
      }
      const payload = {
        client_id: p.clientId,
        order_id: p.order.id,
        customer_id: p.order.customer_id,
        items: p.order.items,
        payments: p.payments.map((l) => ({ method: l.method, amount: parseNum(l.amount) || 0, reference: l.method === CASH ? null : l.reference || null })),
      };
      p.busy = true;
      try {
        const sale = await api.post('/sales', payload);
        pay.value = null;
        done.value = sale;
        load();
        if (store.settings.auto_print && store.settings.printer) printTicket(sale);
      } catch (e) {
        if (e.status === 0) {
          const offlineSale = saveOffline(payload);
          orders.value = orders.value.filter((o) => o.id !== p.order.id);
          pay.value = null;
          done.value = offlineSale;
        } else {
          p.error = e.message;
          load();
        }
      } finally {
        if (pay.value) pay.value.busy = false;
      }
    };
    const next = () => {
      done.value = null;
    };
    const printLater = () => {
      requestQueuedPrint(done.value.client_id);
      done.value = { ...done.value, printQueued: true };
      toast(t('Le ticket sortira au retour du réseau.'));
    };
    const share = (s) => openWhatsApp(saleText(s), s.customer_phone);
    const sms = (s) => openSms(saleText(s), s.customer_phone);


    let off = null;
    let timer = null;
    // Vente hors ligne enfin enregistrée : impression demandée plus tôt
    const offSynced = onSynced((sale, entry) => {
      if (entry.print) printTicket(sale);
    });
    onMounted(() => {
      load();
      off = onChange('orders', () => load(true));
      // Filet de sécurité si la connexion en direct est coupée
      timer = setInterval(() => load(true), 20_000);
    });
    onUnmounted(() => {
      off?.();
      offSynced?.();
      clearInterval(timer);
    });

    return {
      store, orders, pay, done, total, nums, quickCash, canCredit, open, addPayLine, fullCredit, confirm, next, printLater, share, sms, preview,
      printTicket, printInvoice, money, fmtQty, plural, timeFr, saleNo, payLabel, MODE_LABEL, TYPE_LABEL, modeClass, CASH, can,
    };
  },
  template: `
    <div class="page">
      <div class="page-head keep-title">
        <h1>{{ t('Ventes à encaisser') }}<span v-if="orders && orders.length" class="count num">{{ orders.length }}</span></h1>
      </div>

      <Skeleton v-if="!orders" :rows="4" />
      <div v-else-if="orders.length" class="order-list">
        <button v-for="o in orders" :key="o.id" type="button" class="order-row" :class="modeClass(o.mode)" @click="open(o)">
          <span class="or-no"><b>{{ t('N° {n}', { n: o.id }) }}</b><small class="num">{{ timeFr(o.created_at) }}</small></span>
          <span class="or-main">
            <span class="or-who"><b>{{ o.seller_name }}</b> · {{ o.customer_name || t('Client comptoir') }} <span class="badge" :class="o.mode">{{ t(MODE_LABEL[o.mode]) }}</span></span>
            <span class="or-items">{{ preview(o) }}</span>
          </span>
          <strong class="or-total num">{{ money(o.total) }}</strong>
          <span class="or-go">{{ t('Encaisser') }}<Icon name="chevronRight" size="sm" class="flip-rtl" /></span>
        </button>
      </div>
      <Empty v-else icon="receipt" :title="t('Aucune vente à encaisser')" :text="t('Les ventes envoyées par les vendeurs apparaissent ici automatiquement.')" />
    </div>

    <!-- Encaissement (la vente ne peut pas être modifiée) -->
    <Sheet v-if="pay" :title="t('Encaissement') + ' · ' + t('N° {n}', { n: pay.order.id })" band full :cls="modeClass(pay.order.mode)" @close="pay = null">
      <template #head><strong class="num" style="font-size: 1.4375rem">{{ money(total) }}</strong></template>
      <div class="stack loose">
        <div v-if="!store.online" class="alert"><Icon name="wifi" /><span>{{ t('Hors ligne : la vente sera gardée sur cet appareil et envoyée au retour du réseau.') }}</span></div>
        <div class="kv">
          <div><span>{{ t('Vendeur') }}</span><span>{{ pay.order.seller_name }}</span></div>
          <div><span>{{ t('Client') }}</span><span>{{ pay.order.customer_name || t('Client comptoir') }}<template v-if="pay.order.customer_balance > 0"> · {{ t('Doit déjà') }} {{ money(pay.order.customer_balance) }}</template></span></div>
        </div>
        <div class="list" style="border:1px solid var(--line)">
          <div v-for="(l, i) in pay.lines" :key="i" class="list-row">
            <div class="main-col"><div class="title">{{ l.name }}</div><div class="sub">{{ fmtQty(l.qty) }} {{ plural(l.unit, l.qty) }} × {{ money(l.price, { bare: true }) }} · {{ t(TYPE_LABEL[l.sale_type] || 'Détail') }}</div></div>
            <span class="num strong">{{ money(l.total, { bare: true }) }}</span>
          </div>
        </div>

        <div class="stack" v-for="(l, i) in pay.payments" :key="i">
          <div class="methods" role="group" :aria-label="t('Moyen de paiement') + ' ' + (i + 1)">
            <button v-for="m in store.paymentMethods" :key="m" type="button" class="method" :class="{ on: l.method === m }" @click="l.method = m">{{ payLabel(m) }}</button>
          </div>
          <div class="pay-line">
            <label class="label" :for="'cd-pay-' + i">{{ l.method === CASH ? t('Montant reçu') : t('Montant payé') }}</label>
            <input :id="'cd-pay-' + i" class="input num" inputmode="decimal" v-model="l.amount" @focus="$event.target.select()" />
            <button v-if="pay.payments.length > 1" type="button" class="icon-btn" @click="pay.payments.splice(i, 1)" :aria-label="t('Retirer ce paiement')"><Icon name="x" /></button>
            <span v-else></span>
          </div>
          <input v-if="l.method !== CASH" class="input" v-model="l.reference" maxlength="60" dir="ltr" :placeholder="t('N° de transaction (facultatif)')" :aria-label="t('N° de transaction')" />
          <div class="quick-cash" v-if="l.method === CASH">
            <button type="button" @click="l.amount = String(total)">{{ t('Montant exact') }}</button>
            <button v-for="v in quickCash" :key="v" type="button" @click="l.amount = String(v)">{{ money(v, { bare: true }) }}</button>
          </div>
        </div>
        <div class="row wrap">
          <button type="button" class="btn sm" @click="addPayLine"><Icon name="plus" size="sm" />{{ t('Autre moyen de paiement') }}</button>
          <button v-if="canCredit" type="button" class="btn sm" @click="fullCredit"><Icon name="clock" size="sm" />{{ t('Tout à crédit') }}</button>
        </div>

        <div class="pay-summary">
          <div class="sum-row"><span>{{ t('Total à payer') }}</span><span>{{ money(total) }}</span></div>
          <div class="sum-row"><span>{{ t('Payé') }}</span><span>{{ money(nums.paid) }}</span></div>
          <div class="sum-row big change" v-if="nums.change > 0"><span>{{ t('Monnaie à rendre') }}</span><span>{{ money(nums.change) }}</span></div>
          <div class="sum-row big rest" v-if="nums.rest > 0"><span>{{ t('Reste (crédit)') }}</span><span>{{ money(nums.rest) }}</span></div>
          <p class="small" v-if="nums.rest > 0 && pay.order.customer_id">{{ t('Le reste sera ajouté au compte de {c}.', { c: pay.order.customer_name }) }}</p>
          <p class="small muted" v-if="pay.payments.some(l => l.method !== CASH)">{{ t('Vérifiez le message de confirmation du paiement mobile avant de valider.') }}</p>
        </div>
        <div v-if="pay.error" class="alert danger" role="alert"><Icon name="alert" /><span>{{ pay.error }}</span></div>
      </div>
      <template #foot>
        <button type="button" class="btn" @click="pay = null">{{ t('Retour') }}</button>
        <button type="button" class="btn mode lg" :class="{ loading: pay.busy }" :disabled="pay.busy || pay.gone" @click="confirm">
          {{ nums.rest > 0 ? t('Valider avec crédit') : t('Valider l’encaissement') }}
        </button>
      </template>
    </Sheet>

    <!-- Encaissement terminé -->
    <Sheet v-if="done" :title="done.id ? t('Vente') + ' ' + saleNo(done.id) : t('Vente hors ligne')" size="narrow" @close="next">
      <div class="done">
        <div class="tick" :class="{ offline: done.offline }"><Icon :name="done.offline ? 'clock' : 'check'" /></div>
        <h2>{{ done.offline ? t('Vente gardée sur l’appareil') : t('Vente encaissée') }}</h2>
        <p class="muted small">{{ money(done.total) }}{{ done.customer_name ? ' · ' + done.customer_name : '' }}{{ done.seller_name ? ' · ' + t('vendeur {s}', { s: done.seller_name }) : '' }}</p>
        <div v-if="done.offline" class="alert" style="text-align:start"><Icon name="wifi" /><span>{{ t('Pas de réseau : la vente partira toute seule au retour de la connexion, avec sa vraie date. Elle n’est jamais perdue.') }}</span></div>
        <div class="change-due" v-if="done.change_given > 0"><small>{{ t('Monnaie à rendre') }}</small><strong>{{ money(done.change_given) }}</strong></div>
        <div class="alert danger" v-if="done.credit > 0 && !done.offline"><Icon name="clock" /><span>{{ t('{a} mis à crédit. Nouveau solde de {c} :', { a: money(done.credit), c: done.customer_name }) }} <b>{{ money(done.customer_balance) }}</b></span></div>
        <div class="alert danger" v-else-if="done.credit > 0"><Icon name="clock" /><span>{{ t('{a} mis à crédit au compte de {c}.', { a: money(done.credit), c: done.customer_name }) }}</span></div>
      </div>
      <div class="done-actions">
        <button v-if="done.offline && store.settings.printer" type="button" class="btn" :disabled="done.printQueued" @click="printLater"><Icon name="printer" />{{ done.printQueued ? t('Ticket au retour du réseau') : t('Imprimer au retour du réseau') }}</button>
        <button v-else type="button" class="btn" @click="printTicket(done)"><Icon name="printer" />{{ t('Ticket') }}</button>
        <button v-if="!done.offline" type="button" class="btn" @click="printInvoice(done)"><Icon name="file" />{{ t('Facture A4') }}</button>
        <button type="button" class="btn" @click="share(done)"><Icon name="message" />WhatsApp</button>
        <button type="button" class="btn" @click="sms(done)"><Icon name="phone" />SMS</button>
      </div>
      <template #foot>
        <button type="button" class="btn primary lg block" @click="next" autofocus>{{ t('Vente suivante') }}</button>
      </template>
    </Sheet>
`,
};
