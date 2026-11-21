// Clients : comptes, dettes (crédit), versements, retours déduits, relevés, rappels WhatsApp / SMS.
import { ref, computed, onMounted, onUnmounted } from '../vue.js';
import { api } from '../api.js';
import { store, can, onChange, toast, toastError, ask, CASH } from '../store.js';
import { t, payLabel } from '../i18n.js';
import { money, parseNum, norm, when, saleNo, MODE_LABEL } from '../format.js';
import { route, setQuery, go } from '../router.js';
import { Icon, Sheet, Empty, Skeleton } from '../components/ui.js';
import { printPaymentReceipt, printStatement, openWhatsApp, openSms } from '../print.js';

const CustomerForm = {
  components: { Sheet },
  props: { customer: Object },
  emits: ['close', 'saved'],
  setup(props, { emit }) {
    const f = ref({ name: '', phone: '', address: '', type: 'retail', credit_limit: '', opening_balance: '', notes: '', ...(props.customer || {}) });
    const busy = ref(false);
    const save = async () => {
      busy.value = true;
      const body = { ...f.value, credit_limit: parseNum(f.value.credit_limit) || 0, opening_balance: parseNum(f.value.opening_balance) || 0 };
      try {
        const r = f.value.id ? await api.put(`/customers/${f.value.id}`, body) : await api.post('/customers', body);
        toast(t('Client enregistré.'), 'success');
        emit('saved', r.id || f.value.id);
      } catch (e) {
        toastError(e);
      } finally {
        busy.value = false;
      }
    };
    return { f, busy, save, can, store };
  },
  template: `
    <Sheet :title="f.id ? t('Modifier le client') : t('Nouveau client')" @close="$emit('close')">
      <form id="cust-form" class="stack" @submit.prevent="save">
        <div class="field"><label for="cf-name">{{ t('Nom du client ou de la boutique') }}</label><input id="cf-name" class="input" v-model="f.name" required maxlength="100" /></div>
        <div class="form-grid">
          <div class="field"><label for="cf-phone">{{ t('Téléphone') }}</label><input id="cf-phone" class="input" v-model="f.phone" inputmode="tel" dir="ltr" /></div>
          <div class="field"><span class="label">{{ t('Type de client') }}</span>
            <div class="seg block"><button type="button" :class="{ on: f.type === 'retail' }" @click="f.type = 'retail'">{{ t('Particulier') }}</button><button type="button" :class="{ on: f.type === 'wholesale' }" @click="f.type = 'wholesale'">{{ t('Revendeur') }}</button></div>
          </div>
          <div class="field span-2"><label for="cf-addr">{{ t('Adresse') }}</label><input id="cf-addr" class="input" v-model="f.address" maxlength="200" /></div>
          <template v-if="can('customers.delete')">
            <div class="field"><label for="cf-limit">{{ t('Plafond de crédit') }}</label><input id="cf-limit" class="input num" v-model="f.credit_limit" inputmode="decimal" :placeholder="t('0 = sans limite')" /><span class="hint">{{ t('Montant maximum que le client peut devoir.') }}</span></div>
            <div class="field"><label for="cf-open">{{ t('Dette antérieure') }}</label><input id="cf-open" class="input num" v-model="f.opening_balance" inputmode="decimal" placeholder="0" /><span class="hint">{{ t('Ce que le client devait déjà avant le logiciel (cahier).') }}</span></div>
          </template>
          <div class="field span-2"><label for="cf-notes">{{ t('Notes') }}</label><textarea id="cf-notes" class="textarea" v-model="f.notes" maxlength="500"></textarea></div>
        </div>
      </form>
      <template #foot><button type="button" class="btn" @click="$emit('close')">{{ t('Annuler') }}</button><button type="submit" form="cust-form" class="btn primary" :class="{ loading: busy }" :disabled="busy">{{ t('Enregistrer') }}</button></template>
    </Sheet>`,
};

const CustomerDetail = {
  components: { Icon, Sheet, Skeleton, CustomerForm },
  props: { id: [Number, String] },
  emits: ['close', 'changed'],
  setup(props, { emit }) {
    const c = ref(null);
    const paying = ref(null);
    const editing = ref(false);
    const load = async () => {
      try {
        c.value = await api.get(`/customers/${props.id}`);
      } catch (e) {
        toastError(e);
        emit('close');
      }
    };
    onMounted(load);
    // Historique du compte : achats à crédit (+), versements et retours (−), solde après chaque opération
    const ledger = computed(() => {
      if (!c.value) return [];
      const rows = [
        ...c.value.sales.map((s) => ({
          key: `s${s.id}`,
          date: s.created_at,
          label: `${t('Achat')} ${saleNo(s.id)} (${t(MODE_LABEL[s.mode])})${s.status === 'cancelled' ? ` — ${t('annulé')}` : ''}`,
          total: s.total,
          debit: s.status === 'completed' ? Math.max(0, s.total - s.paid) : 0,
          credit: 0,
          sale: s,
        })),
        ...c.value.payments.map((p) => ({ key: `p${p.id}`, date: p.created_at, label: `${t('Versement')} (${payLabel(p.method)})${p.note ? ` — ${p.note}` : ''}`, debit: 0, credit: p.amount, payment: p })),
        ...(c.value.refunds || []).map((r) => ({ key: `r${r.id}`, date: r.created_at, label: `${t('Retour d’articles')} (${saleNo(r.sale_id)}) — ${r.reason}`, debit: 0, credit: r.amount })),
      ].sort((a, b) => b.date.localeCompare(a.date));
      let running = c.value.balance;
      for (const r of rows) {
        r.balance = running;
        running = running - r.debit + r.credit;
      }
      return rows;
    });
    const startPay = () => {
      paying.value = { amount: c.value.balance > 0 ? String(c.value.balance) : '', method: CASH, note: '', busy: false };
    };
    const pay = async () => {
      const amount = parseNum(paying.value.amount);
      if (!(amount > 0)) return toast(t('Montant invalide.'), 'error');
      paying.value.busy = true;
      try {
        const r = await api.post(`/customers/${c.value.id}/payments`, { amount, method: paying.value.method, note: paying.value.note });
        const receipt = { amount, method: paying.value.method, note: paying.value.note, balance: r.balance, created_at: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().replace('T', ' ') };
        paying.value = null;
        await load();
        emit('changed');
        const print = await ask({ title: t('Versement enregistré'), message: t('Nouveau solde de {c} : {b}.', { c: c.value.name, b: money(r.balance) }), confirm: t('Imprimer le reçu'), cancel: t('Fermer') });
        if (print) printPaymentReceipt(receipt, c.value);
      } catch (e) {
        toastError(e);
        if (paying.value) paying.value.busy = false;
      }
    };
    const removePayment = async (p) => {
      if (!(await ask({ title: t('Supprimer ce versement ?'), message: t('{a} du {d}. La dette du client augmentera d’autant.', { a: money(p.amount), d: when(p.created_at) }), confirm: t('Supprimer'), danger: true }))) return;
      try {
        await api.del(`/customer-payments/${p.id}`);
        await load();
        emit('changed');
      } catch (e) {
        toastError(e);
      }
    };
    const remove = async () => {
      if (!(await ask({ title: t('Supprimer {c} ?', { c: c.value.name }), message: t('Le client disparaît de la liste ; ses ventes restent dans l’historique.'), confirm: t('Supprimer'), danger: true }))) return;
      try {
        await api.del(`/customers/${c.value.id}`);
        emit('changed');
        emit('close');
      } catch (e) {
        toastError(e);
      }
    };
    const reminder = () => {
      const s = store.settings;
      return t('Bonjour {c},\nVotre solde chez {m} est de {b}.\nMerci de passer régler à votre convenance.', { c: c.value.name, m: s.store_name, b: money(c.value.balance) }) + (s.store_phone ? `\n${t('Tél.')} ${s.store_phone}` : '');
    };
    const remind = () => openWhatsApp(reminder(), c.value.phone);
    const remindSms = () => openSms(reminder(), c.value.phone);
    const saved = async () => {
      editing.value = false;
      await load();
      emit('changed');
    };
    return { c, ledger, paying, editing, startPay, pay, removePayment, remove, remind, remindSms, saved, printStatement, store, can, money, when, go, payLabel };
  },
  template: `
    <Sheet :title="c ? c.name : t('Client')" size="wide" @close="$emit('close')">
      <Skeleton v-if="!c" :rows="4" />
      <div v-else class="stack loose">
        <div class="row wrap top">
          <div class="grow">
            <div class="xsmall faint">{{ c.balance > 0 ? t('Le client doit') : c.balance < 0 ? t('Avance du client') : t('Compte soldé') }}</div>
            <div class="balance-big" :class="c.balance > 0 ? 'debt' : 'clear'">{{ money(Math.abs(c.balance)) }}</div>
            <div class="small muted" v-if="c.credit_limit > 0">{{ t('Plafond de crédit') }} : {{ money(c.credit_limit) }}</div>
          </div>
          <div class="stack tight small muted" style="min-width:200px">
            <span>{{ c.type === 'wholesale' ? t('Revendeur (gros)') : t('Particulier') }}</span>
            <span v-if="c.phone"><a :href="'tel:' + c.phone" dir="ltr">{{ c.phone }}</a></span>
            <span v-if="c.address">{{ c.address }}</span>
            <span>{{ t('{n} achat(s)', { n: c.totals.count }) }} · {{ money(c.totals.total) }}</span>
          </div>
        </div>
        <div class="row wrap">
          <button v-if="can('payments.receive')" type="button" class="btn primary" @click="startPay"><Icon name="coins" />{{ t('Encaisser un versement') }}</button>
          <button type="button" class="btn" @click="printStatement(c, ledger)"><Icon name="printer" />{{ t('Relevé de compte') }}</button>
          <button v-if="c.balance > 0" type="button" class="btn" @click="remind"><Icon name="message" />{{ t('Rappel WhatsApp') }}</button>
          <button v-if="c.balance > 0 && c.phone" type="button" class="btn" @click="remindSms"><Icon name="phone" />{{ t('Rappel SMS') }}</button>
          <button type="button" class="btn" @click="editing = true"><Icon name="edit" />{{ t('Modifier') }}</button>
        </div>
        <p v-if="c.notes" class="small muted">{{ c.notes }}</p>

        <div>
          <h3 style="margin-bottom:8px">{{ t('Historique du compte') }}</h3>
          <div class="table-wrap" style="border:1px solid var(--line)" v-if="ledger.length || c.opening_balance">
            <table class="table compact-table">
              <thead><tr><th>{{ t('Date') }}</th><th>{{ t('Opération') }}</th><th class="num">{{ t('Dette +') }}</th><th class="num">{{ t('Versé −') }}</th><th class="num">{{ t('Solde') }}</th><th></th></tr></thead>
              <tbody>
                <tr v-for="r in ledger" :key="r.key" :class="{ click: r.sale }" @click="r.sale && go('/ventes', { vente: r.sale.id })">
                  <td class="nowrap">{{ when(r.date) }}</td>
                  <td>{{ r.label }}<div class="cell-sub" v-if="r.sale">{{ t('Total') }} {{ money(r.total) }}<template v-if="r.debit === 0 && r.sale.status === 'completed'"> · {{ t('payé comptant') }}</template></div></td>
                  <td class="num ledger-amount plus">{{ r.debit ? money(r.debit, { bare: true }) : '' }}</td>
                  <td class="num ledger-amount minus">{{ r.credit ? money(r.credit, { bare: true }) : '' }}</td>
                  <td class="num strong">{{ money(r.balance, { bare: true }) }}</td>
                  <td><button v-if="r.payment && can('payments.delete')" type="button" class="icon-btn sm" @click.stop="removePayment(r.payment)" :aria-label="t('Supprimer le versement')"><Icon name="trash" size="sm" /></button></td>
                </tr>
                <tr v-if="c.opening_balance"><td></td><td>{{ t('Dette antérieure (avant le logiciel)') }}</td><td class="num ledger-amount plus">{{ money(c.opening_balance, { bare: true }) }}</td><td></td><td></td><td></td></tr>
              </tbody>
            </table>
          </div>
          <p v-else class="small muted">{{ t('Aucune opération pour ce client.') }}</p>
        </div>
      </div>
      <template #foot v-if="c && can('customers.delete')">
        <button type="button" class="btn danger push-start" @click="remove">{{ t('Supprimer le client') }}</button>
      </template>
    </Sheet>

    <Sheet v-if="paying" :title="t('Versement du client')" size="narrow" @close="paying = null">
      <form id="pay-form" class="stack" @submit.prevent="pay">
        <p class="small muted">{{ t('{c} doit actuellement {b}.', { c: c.name, b: money(c.balance) }) }}</p>
        <div class="field"><label for="vp-amount">{{ t('Montant versé') }}</label><input id="vp-amount" class="input num" v-model="paying.amount" inputmode="decimal" required style="font-size:1.25rem;font-weight:700" autofocus /></div>
        <div class="field"><span class="label">{{ t('Moyen de paiement') }}</span>
          <div class="methods"><button v-for="m in store.paymentMethods" :key="m" type="button" class="method" :class="{ on: paying.method === m }" @click="paying.method = m">{{ payLabel(m) }}</button></div>
        </div>
        <div class="field"><label for="vp-note">{{ t('Remarque') }}</label><input id="vp-note" class="input" v-model="paying.note" maxlength="200" :placeholder="t('Facultatif')" /></div>
      </form>
      <template #foot><button type="button" class="btn" @click="paying = null">{{ t('Annuler') }}</button><button type="submit" form="pay-form" class="btn success" :class="{ loading: paying.busy }" :disabled="paying.busy">{{ t('Enregistrer le versement') }}</button></template>
    </Sheet>

    <CustomerForm v-if="editing" :customer="c" @close="editing = false" @saved="saved" />`,
};

export default {
  components: { Icon, Empty, Skeleton, CustomerDetail, CustomerForm },
  setup() {
    const rows = ref(null);
    const q = ref('');
    const filter = ref(route.query.filtre === 'dette' ? 'debt' : 'all');
    const creating = ref(false);
    const load = async () => {
      try {
        rows.value = await api.get('/customers');
      } catch (e) {
        toastError(e);
      }
    };
    let off = null;
    onMounted(() => {
      load();
      off = onChange('customers', load);
    });
    onUnmounted(() => off?.());
    const list = computed(() => {
      const words = norm(q.value).split(/\s+/).filter(Boolean);
      return (rows.value || []).filter((c) => {
        if (filter.value === 'debt' && !(c.balance > 0.004)) return false;
        if (filter.value === 'wholesale' && c.type !== 'wholesale') return false;
        const hay = norm(`${c.name} ${c.phone || ''}`);
        return words.every((w) => hay.includes(w));
      });
    });
    const debt = computed(() => {
      const d = (rows.value || []).filter((c) => c.balance > 0.004);
      return { count: d.length, total: d.reduce((s, c) => s + c.balance, 0) };
    });
    const openId = computed(() => route.query.client);
    const open = (id) => setQuery({ client: id });
    const close = () => setQuery({ client: undefined });
    const created = (id) => {
      creating.value = false;
      load();
      if (id) open(id);
    };
    return { rows, q, filter, list, debt, creating, openId, open, close, created, load, can, money, when, exportUrl: api.url('/export/customers.csv') };
  },
  template: `
    <div class="page">
      <div class="page-head">
        <h1>{{ t('Clients & crédits') }}</h1>
        <a v-if="can('reports.view')" class="btn hide-phone" :href="exportUrl"><Icon name="download" />{{ t('Exporter') }}</a>
        <button type="button" class="btn primary" @click="creating = true"><Icon name="plus" />{{ t('Nouveau client') }}</button>
      </div>
      <div class="summary-strip" v-if="rows">
        <span>{{ t('Les clients vous doivent') }} <b style="color:var(--credit-ink)">{{ money(debt.total) }}</b></span>
        <span>{{ t('{n} client(s) avec une dette', { n: debt.count }) }}</span>
        <span>{{ t('{n} client(s) au total', { n: rows.length }) }}</span>
      </div>
      <div class="toolbar">
        <div class="input-affix search"><Icon name="search" /><input class="input" v-model="q" :placeholder="t('Nom ou téléphone')" /></div>
        <div class="chips">
          <button type="button" class="chip" :class="{ on: filter === 'all' }" @click="filter = 'all'">{{ t('Tous') }}</button>
          <button type="button" class="chip" :class="{ on: filter === 'debt' }" @click="filter = 'debt'">{{ t('Avec une dette') }}</button>
          <button type="button" class="chip" :class="{ on: filter === 'wholesale' }" @click="filter = 'wholesale'">{{ t('Revendeurs') }}</button>
        </div>
      </div>
      <Skeleton v-if="!rows" />
      <div v-else-if="list.length" class="list">
        <button v-for="c in list" :key="c.id" type="button" class="list-row" @click="open(c.id)">
          <div class="main-col">
            <div class="title">{{ c.name }}</div>
            <div class="sub">{{ c.phone || t('Sans téléphone') }} · {{ c.type === 'wholesale' ? t('Revendeur') : t('Particulier') }}<template v-if="c.last_sale"> · {{ t('dernier achat {d}', { d: when(c.last_sale) }) }}</template></div>
          </div>
          <div class="end">
            <span v-if="c.balance > 0.004" class="badge credit">{{ t('Doit') }} {{ money(c.balance) }}</span>
            <span v-else-if="c.balance < -0.004" class="badge paid">{{ t('Avance') }} {{ money(-c.balance) }}</span>
            <span v-else class="badge">{{ t('Soldé') }}</span>
          </div>
        </button>
      </div>
      <Empty v-else icon="users" :title="q || filter !== 'all' ? t('Aucun client trouvé') : t('Aucun client')" :text="t('Créez un compte client pour vendre à crédit et suivre ses versements.')" />

      <CustomerDetail v-if="openId" :id="openId" :key="openId" @close="close" @changed="load" />
      <CustomerForm v-if="creating" @close="creating = false" @saved="created" />
    </div>`,
};
