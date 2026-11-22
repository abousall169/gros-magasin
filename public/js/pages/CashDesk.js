// Caisse du caissier : liste des ventes envoyées par les vendeurs. Il en choisit une et l'encaisse,
// sans pouvoir la modifier (articles, prix et client restent ceux du vendeur).
// Il gère aussi son tiroir : ouverture (fond de caisse), sorties d'argent, clôture imprimée en fin de journée.
import { ref, computed, onMounted, onUnmounted } from '../vue.js';
import { api, enqueueSale, readQueue, requestQueuedPrint, sessionToken } from '../api.js';
import { store, can, toast, toastError, ask, onChange, onSynced, CASH } from '../store.js';
import { t, pname, payLabel } from '../i18n.js';
import { money, qty as fmtQty, plural, parseNum, roundMoney, decimals, listPrice, unitLabel, timeFr, dateTimeFr, saleNo, MODE_LABEL } from '../format.js';
import { Icon, Sheet, Empty, Skeleton } from '../components/ui.js';
import { printTicket, printInvoice, printSession, printCashReport, saleText, openWhatsApp, openSms } from '../print.js';

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
        loadSession();
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

    // ---- Ma caisse : ouverture (fond de caisse), sorties d'argent, clôture ----
    const session = ref(undefined); // undefined : pas encore chargé ; null : caisse pas ouverte
    const lastClosed = ref(null);
    const till = ref(null); // feuille « Ma caisse » : { float, counted, note, busy }
    const closedNow = ref(null); // clôture qui vient d'être faite
    const expense = ref(null); // feuille « Sortie d'argent »
    const categories = ref([]);
    const loadSession = async () => {
      try {
        const r = await api.get('/cash/sessions');
        session.value = r.open.find((x) => x.user_id === store.me.id) || null;
        lastClosed.value = r.history.find((x) => x.user_id === store.me.id) || null;
      } catch {
        /* hors ligne : on garde l'état connu */
      }
    };
    const b = computed(() => session.value?.breakdown || null);
    const gap = computed(() => (!till.value || till.value.counted === '' || !b.value ? null : roundMoney((parseNum(till.value.counted) || 0) - b.value.expected)));
    const openTill = () => {
      till.value = { float: '', counted: '', note: '', busy: false };
      loadSession();
    };
    const startTill = async () => {
      const f = till.value;
      const float = f.float === '' ? 0 : parseNum(f.float);
      if (!(float >= 0)) return toast(t('Fond de caisse invalide.'), 'error');
      f.busy = true;
      try {
        await api.post('/cash/sessions', { opening_float: float });
        till.value = null;
        toast(t('Caisse ouverte.'), 'success');
        await loadSession();
      } catch (e) {
        toastError(e);
        f.busy = false;
      }
    };
    const closeTill = async () => {
      const f = till.value;
      const counted = parseNum(f.counted);
      if (f.counted === '' || !(counted >= 0)) return toast(t('Indiquez les espèces comptées.'), 'error');
      const sure = await ask({
        title: t('Fermer la caisse ?'),
        message: t('Espèces comptées : {a}. Une fois fermée, la caisse ne peut plus être modifiée.', { a: money(counted) }),
        confirm: t('Fermer la caisse'),
        danger: true,
      });
      if (!sure) return;
      f.busy = true;
      try {
        const s = await api.post(`/cash/sessions/${session.value.id}/close`, { counted, note: f.note });
        till.value = null;
        session.value = null;
        lastClosed.value = s;
        closedNow.value = s;
        printSession(s);
      } catch (e) {
        toastError(e);
        f.busy = false;
      }
    };
    const printDay = async () => {
      try {
        printCashReport(await api.get('/reports/cash'));
      } catch (e) {
        toastError(e);
      }
    };

    const startExpense = async () => {
      expense.value = { amount: '', category: '', method: CASH, note: '', busy: false };
      if (!categories.value.length) {
        try {
          categories.value = await api.get('/expenses/categories');
        } catch {
          /* suggestions facultatives */
        }
      }
    };
    const saveExpense = async () => {
      const f = expense.value;
      const amount = parseNum(f.amount);
      if (!(amount > 0)) return toast(t('Montant invalide.'), 'error');
      if (!f.category.trim()) return toast(t('Choisissez le motif de la sortie d’argent.'), 'error');
      f.busy = true;
      try {
        await api.post('/expenses', { amount, category: f.category.trim(), method: f.method, note: f.note });
        expense.value = null;
        toast(t('Sortie d’argent enregistrée.'), 'success');
        loadSession();
      } catch (e) {
        toastError(e);
        f.busy = false;
      }
    };
    const removeExpense = async (e) => {
      const sure = await ask({ title: t('Supprimer cette dépense ?'), message: `${e.category} — ${money(e.amount)}`, confirm: t('Supprimer'), danger: true });
      if (!sure) return;
      try {
        await api.del(`/expenses/${e.id}`);
        loadSession();
      } catch (err) {
        toastError(err);
      }
    };

    let off = null;
    let offCash = null;
    let timer = null;
    // Vente hors ligne enfin enregistrée : impression demandée plus tôt
    const offSynced = onSynced((sale, entry) => {
      if (entry.print) printTicket(sale);
    });
    onMounted(() => {
      load();
      loadSession();
      off = onChange('orders', () => load(true));
      offCash = onChange('cash', loadSession);
      // Filet de sécurité si la connexion en direct est coupée
      timer = setInterval(() => load(true), 20_000);
    });
    onUnmounted(() => {
      off?.();
      offCash?.();
      offSynced?.();
      clearInterval(timer);
    });

    return {
      store, orders, pay, done, total, nums, quickCash, canCredit, open, addPayLine, fullCredit, confirm, next, printLater, share, sms, preview,
      session, lastClosed, till, closedNow, expense, categories, b, gap, openTill, startTill, closeTill, printDay, startExpense, saveExpense, removeExpense,
      printTicket, printInvoice, printSession, money, fmtQty, plural, timeFr, dateTimeFr, saleNo, payLabel, MODE_LABEL, CASH, can,
    };
  },
  template: `
    <div class="page">
      <div class="page-head keep-title">
        <h1>{{ t('Ventes à encaisser') }}<span v-if="orders && orders.length" class="count num">{{ orders.length }}</span></h1>
        <div class="desk-actions">
          <button type="button" class="btn" @click="startExpense"><Icon name="wallet" />{{ t('Sortie d’argent') }}</button>
          <button type="button" class="btn" :class="{ primary: session === null }" :disabled="session === undefined" @click="openTill">
            <Icon :name="session ? 'lock' : 'unlock'" />{{ session ? t('Fermer ma caisse') : t('Ouvrir ma caisse') }}
          </button>
        </div>
      </div>

      <div v-if="session === null" class="alert till-alert">
        <Icon name="lock" />
        <span class="grow">{{ t('Votre caisse n’est pas ouverte. Ouvrez-la avec le fond de caisse pour pouvoir la fermer juste ce soir.') }}</span>
        <button type="button" class="btn sm primary" @click="openTill">{{ t('Ouvrir ma caisse') }}</button>
      </div>
      <p v-else-if="session" class="till-strip small">
        <i></i>{{ t('Caisse ouverte depuis {h}', { h: timeFr(session.opened_at) }) }}
        · {{ t('fond de caisse') }} {{ money(session.breakdown.opening_float) }}
        <template v-if="session.breakdown.expense_items.length"> · {{ t('{n} sortie(s) d’argent : {a}', { n: session.breakdown.expense_items.length, a: money(session.breakdown.expenses) }) }}</template>
      </p>

      <Skeleton v-if="!orders" :rows="4" />
      <div v-else-if="orders.length" class="order-list">
        <button v-for="o in orders" :key="o.id" type="button" class="order-row" :class="'mode-' + (o.mode === 'wholesale' ? 'wholesale' : 'retail')" @click="open(o)">
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
    <Sheet v-if="pay" :title="t('Encaissement') + ' · ' + t('N° {n}', { n: pay.order.id })" band full :cls="'mode-' + (pay.order.mode === 'wholesale' ? 'wholesale' : 'retail')" @close="pay = null">
      <template #head><strong class="num" style="font-size: 1.4375rem">{{ money(total) }}</strong></template>
      <div class="stack loose">
        <div v-if="!store.online" class="alert"><Icon name="wifi" /><span>{{ t('Hors ligne : la vente sera gardée sur cet appareil et envoyée au retour du réseau.') }}</span></div>
        <div class="kv">
          <div><span>{{ t('Vendeur') }}</span><span>{{ pay.order.seller_name }}</span></div>
          <div><span>{{ t('Client') }}</span><span>{{ pay.order.customer_name || t('Client comptoir') }}<template v-if="pay.order.customer_balance > 0"> · {{ t('Doit déjà') }} {{ money(pay.order.customer_balance) }}</template></span></div>
        </div>
        <div class="list" style="border:1px solid var(--line)">
          <div v-for="(l, i) in pay.lines" :key="i" class="list-row">
            <div class="main-col"><div class="title">{{ l.name }}</div><div class="sub">{{ fmtQty(l.qty) }} {{ plural(l.unit, l.qty) }} × {{ money(l.price, { bare: true }) }} · {{ l.sale_type === 'wholesale' ? t('Gros') : t('Détail') }}</div></div>
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

    <!-- Ma caisse : ouverture le matin, clôture le soir -->
    <Sheet v-if="till" :title="session ? t('Fermer ma caisse') : t('Ouvrir ma caisse')" @close="till = null">
      <form v-if="!session" id="till-open" class="stack loose" @submit.prevent="startTill">
        <p class="small muted">{{ t('Au début de la journée, comptez l’argent déjà dans le tiroir (fond de caisse). À la clôture, le logiciel calcule les espèces attendues et l’écart.') }}</p>
        <div class="field"><label for="till-float">{{ t('Fond de caisse') }}</label><input id="till-float" class="input num" v-model="till.float" inputmode="decimal" placeholder="0" autofocus style="font-size:1.25rem;font-weight:700" /></div>
        <div v-if="lastClosed" class="row wrap small muted">
          <span class="grow">{{ t('Dernière clôture : {d}', { d: dateTimeFr(lastClosed.closed_at) }) }}</span>
          <button type="button" class="btn sm" @click="printSession(lastClosed)"><Icon name="printer" size="sm" />{{ t('Réimprimer') }}</button>
        </div>
      </form>
      <div v-else-if="b" class="stack loose">
        <p class="small muted">{{ t('Caisse ouverte le {d}', { d: dateTimeFr(session.opened_at) }) }}</p>
        <div v-if="store.pending" class="alert danger"><Icon name="wifi" /><span>{{ t('{n} vente(s) encore gardée(s) sur cet appareil : attendez le retour du réseau avant de fermer la caisse.', { n: store.pending }) }}</span></div>
        <div v-if="orders && orders.length" class="alert"><Icon name="alert" /><span>{{ t('Il reste {n} vente(s) à encaisser.', { n: orders.length }) }}</span></div>

        <div class="kv">
          <div><span>{{ t('Fond de caisse') }}</span><span>{{ money(b.opening_float) }}</span></div>
          <div><span>+ {{ t('Ventes en espèces') }}</span><span>{{ money(b.sales) }}</span></div>
          <div v-if="b.payments"><span>+ {{ t('Versements des clients') }}</span><span>{{ money(b.payments) }}</span></div>
          <div v-if="b.refunds"><span>− {{ t('Retours remboursés') }}</span><span>{{ money(b.refunds) }}</span></div>
          <div><span>− {{ t('Sorties d’argent') }}</span><span>{{ money(b.expenses) }}</span></div>
          <div v-if="b.suppliers"><span>− {{ t('Paiements fournisseurs') }}</span><span>{{ money(b.suppliers) }}</span></div>
        </div>
        <div class="pay-summary"><div class="sum-row big"><span>{{ t('Espèces attendues dans le tiroir') }}</span><span>{{ money(b.expected) }}</span></div></div>

        <section>
          <div class="till-h"><h3>{{ t('Ventes encaissées') }} ({{ b.count }})</h3><span class="num strong">{{ money(b.sales_total) }}</span></div>
          <div v-if="b.credit > 0" class="kv"><div><span>{{ t('dont à crédit') }}</span><span>{{ money(b.credit) }}</span></div></div>
          <template v-if="b.methods.length">
            <div class="kv"><div v-for="m in b.methods" :key="m.method"><span>{{ payLabel(m.method) }}</span><span>{{ money(m.amount) }}</span></div></div>
            <p class="xsmall faint" style="margin-top:4px">{{ t('Hors espèces : à vérifier sur le téléphone ou le relevé, pas dans le tiroir.') }}</p>
          </template>
        </section>

        <section>
          <div class="till-h">
            <h3>{{ t('Sorties d’argent') }}</h3>
            <button type="button" class="btn sm" @click="startExpense"><Icon name="plus" size="sm" />{{ t('Ajouter') }}</button>
          </div>
          <div v-if="b.expense_items.length" class="list" style="border:1px solid var(--line)">
            <div v-for="e in b.expense_items" :key="e.id" class="list-row">
              <div class="main-col"><div class="title">{{ e.category }}<span v-if="e.note" class="faint"> · {{ e.note }}</span></div><div class="sub">{{ timeFr(e.created_at) }} · {{ payLabel(e.method) }}</div></div>
              <span class="num strong">{{ money(e.amount, { bare: true }) }}</span>
              <button type="button" class="icon-btn sm" @click="removeExpense(e)" :aria-label="t('Supprimer')" :title="t('Supprimer')"><Icon name="trash" size="sm" /></button>
            </div>
          </div>
          <p v-else class="small muted">{{ t('Aucune sortie d’argent.') }}</p>
        </section>

        <div class="field"><label for="till-count">{{ t('Espèces comptées') }}</label><input id="till-count" class="input num" v-model="till.counted" inputmode="decimal" :placeholder="t('Comptez les billets et pièces')" style="font-size:1.25rem;font-weight:700" /></div>
        <div v-if="gap !== null" class="alert" :class="gap === 0 ? 'ok' : 'danger'">
          <Icon :name="gap === 0 ? 'check' : 'alert'" />
          <span v-if="gap === 0"><b>{{ t('La caisse est juste.') }}</b></span>
          <span v-else-if="gap < 0"><b>{{ t('Il manque {a} dans la caisse.', { a: money(-gap) }) }}</b></span>
          <span v-else><b>{{ t('Il y a {a} en trop dans la caisse.', { a: money(gap) }) }}</b></span>
        </div>
        <div class="field"><label for="till-note">{{ t('Remarque') }}</label><input id="till-note" class="input" v-model="till.note" maxlength="300" :placeholder="t('Facultatif')" /></div>
      </div>
      <template #foot>
        <button type="button" class="btn" @click="till = null">{{ t('Retour') }}</button>
        <button v-if="!session" type="submit" form="till-open" class="btn primary" :class="{ loading: till.busy }" :disabled="till.busy"><Icon name="unlock" />{{ t('Ouvrir la caisse') }}</button>
        <button v-else type="button" class="btn danger solid" :class="{ loading: till.busy }" :disabled="till.busy || till.counted === ''" @click="closeTill"><Icon name="lock" />{{ t('Fermer la caisse et imprimer') }}</button>
      </template>
    </Sheet>

    <!-- Caisse fermée -->
    <Sheet v-if="closedNow" :title="t('Caisse fermée')" size="narrow" @close="closedNow = null">
      <div class="done">
        <div class="tick" :class="{ offline: Math.abs(closedNow.difference) >= 0.005 }"><Icon :name="Math.abs(closedNow.difference) < 0.005 ? 'check' : 'alert'" /></div>
        <h2 v-if="Math.abs(closedNow.difference) < 0.005">{{ t('La caisse est juste.') }}</h2>
        <h2 v-else-if="closedNow.difference < 0">{{ t('Il manque {a} dans la caisse.', { a: money(-closedNow.difference) }) }}</h2>
        <h2 v-else>{{ t('Il y a {a} en trop dans la caisse.', { a: money(closedNow.difference) }) }}</h2>
        <div class="kv" style="text-align:start">
          <div><span>{{ t('Espèces attendues') }}</span><span>{{ money(closedNow.expected) }}</span></div>
          <div><span>{{ t('Espèces comptées') }}</span><span>{{ money(closedNow.counted) }}</span></div>
          <div><span>{{ t('Sorties d’argent') }}</span><span>{{ money(closedNow.breakdown.expenses) }}</span></div>
        </div>
      </div>
      <div class="done-actions">
        <button type="button" class="btn" @click="printSession(closedNow)"><Icon name="printer" />{{ t('Réimprimer la clôture') }}</button>
        <button type="button" class="btn" @click="printDay"><Icon name="file" />{{ t('Résumé de la journée') }}</button>
      </div>
      <template #foot>
        <button type="button" class="btn primary lg block" @click="closedNow = null" autofocus>{{ t('Terminé') }}</button>
      </template>
    </Sheet>

    <!-- Sortie d'argent (dépense payée depuis la caisse) -->
    <Sheet v-if="expense" :title="t('Sortie d’argent')" size="narrow" @close="expense = null">
      <form id="cd-exp" class="stack" @submit.prevent="saveExpense">
        <div class="field"><label for="cd-ex-amount">{{ t('Montant') }}</label><input id="cd-ex-amount" class="input num" v-model="expense.amount" inputmode="decimal" autofocus style="font-size:1.25rem;font-weight:700" /></div>
        <div class="field"><span class="label">{{ t('Motif') }}</span>
          <div class="chips wrap" v-if="categories.length">
            <button v-for="c in categories" :key="c" type="button" class="chip" :class="{ on: expense.category === c }" @click="expense.category = c">{{ c }}</button>
          </div>
          <input class="input" v-model="expense.category" maxlength="60" :placeholder="t('Autre motif…')" :aria-label="t('Motif')" />
        </div>
        <div class="field"><label for="cd-ex-note">{{ t('Détail') }}</label><input id="cd-ex-note" class="input" v-model="expense.note" maxlength="300" :placeholder="t('Ex. : taxi livraison Boutique Awa')" /></div>
        <div class="field"><span class="label">{{ t('Payé par') }}</span>
          <div class="methods"><button v-for="m in store.paymentMethods" :key="m" type="button" class="method" :class="{ on: expense.method === m }" @click="expense.method = m">{{ payLabel(m) }}</button></div>
          <span class="hint">{{ t('« Espèces » = argent pris dans la caisse : il sera déduit de la caisse du jour.') }}</span>
        </div>
      </form>
      <template #foot>
        <button type="button" class="btn" @click="expense = null">{{ t('Annuler') }}</button>
        <button type="submit" form="cd-exp" class="btn primary" :class="{ loading: expense.busy }" :disabled="expense.busy">{{ t('Enregistrer') }}</button>
      </template>
    </Sheet>`,
};
