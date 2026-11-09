// Clients : comptes, dettes (crédit), versements, relevés.
import { ref, computed, watch, onMounted, onUnmounted } from '../vue.js';
import { api } from '../api.js';
import { store, can, onChange, toast, toastError, ask, CASH } from '../store.js';
import { money, parseNum, norm, when, saleNo, MODE_LABEL } from '../format.js';
import { route, setQuery, go } from '../router.js';
import { Icon, Sheet, Empty, Skeleton } from '../components/ui.js';
import { printPaymentReceipt, printStatement, openWhatsApp } from '../print.js';

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
        toast('Client enregistré.', 'success');
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
    <Sheet :title="f.id ? 'Modifier le client' : 'Nouveau client'" @close="$emit('close')">
      <form id="cust-form" class="stack" @submit.prevent="save">
        <div class="field"><label for="cf-name">Nom du client ou de la boutique</label><input id="cf-name" class="input" v-model="f.name" required maxlength="100" /></div>
        <div class="form-grid">
          <div class="field"><label for="cf-phone">Téléphone</label><input id="cf-phone" class="input" v-model="f.phone" inputmode="tel" /></div>
          <div class="field"><span class="label">Type de client</span>
            <div class="seg block"><button type="button" :class="{ on: f.type === 'retail' }" @click="f.type = 'retail'">Particulier</button><button type="button" :class="{ on: f.type === 'wholesale' }" @click="f.type = 'wholesale'">Revendeur</button></div>
          </div>
          <div class="field span-2"><label for="cf-addr">Adresse</label><input id="cf-addr" class="input" v-model="f.address" maxlength="200" /></div>
          <template v-if="can('customers.delete')">
            <div class="field"><label for="cf-limit">Plafond de crédit</label><input id="cf-limit" class="input num" v-model="f.credit_limit" inputmode="decimal" placeholder="0 = sans limite" /><span class="hint">Montant maximum que le client peut devoir.</span></div>
            <div class="field"><label for="cf-open">Dette antérieure</label><input id="cf-open" class="input num" v-model="f.opening_balance" inputmode="decimal" placeholder="0" /><span class="hint">Ce que le client devait déjà avant le logiciel (cahier).</span></div>
          </template>
          <div class="field span-2"><label for="cf-notes">Notes</label><textarea id="cf-notes" class="textarea" v-model="f.notes" maxlength="500"></textarea></div>
        </div>
      </form>
      <template #foot><button type="button" class="btn" @click="$emit('close')">Annuler</button><button type="submit" form="cust-form" class="btn primary" :class="{ loading: busy }" :disabled="busy">Enregistrer</button></template>
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
    // Historique du compte : achats à crédit (+) et versements (−), solde après chaque opération
    const ledger = computed(() => {
      if (!c.value) return [];
      const rows = [
        ...c.value.sales.map((s) => ({
          key: `s${s.id}`,
          date: s.created_at,
          label: `Achat ${saleNo(s.id)} (${MODE_LABEL[s.mode]})${s.status === 'cancelled' ? ' — annulé' : ''}`,
          total: s.total,
          debit: s.status === 'completed' ? Math.max(0, s.total - s.paid) : 0,
          credit: 0,
          sale: s,
        })),
        ...c.value.payments.map((p) => ({ key: `p${p.id}`, date: p.created_at, label: `Versement (${p.method})${p.note ? ' — ' + p.note : ''}`, debit: 0, credit: p.amount, payment: p })),
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
      if (!(amount > 0)) return toast('Montant invalide.', 'error');
      paying.value.busy = true;
      try {
        const r = await api.post(`/customers/${c.value.id}/payments`, { amount, method: paying.value.method, note: paying.value.note });
        const receipt = { amount, method: paying.value.method, note: paying.value.note, balance: r.balance, created_at: new Date().toISOString().replace('T', ' ') };
        paying.value = null;
        await load();
        emit('changed');
        const print = await ask({ title: 'Versement enregistré', message: `Nouveau solde de ${c.value.name} : ${money(r.balance)}.`, confirm: 'Imprimer le reçu', cancel: 'Fermer' });
        if (print) printPaymentReceipt(receipt, c.value);
      } catch (e) {
        toastError(e);
        if (paying.value) paying.value.busy = false;
      }
    };
    const removePayment = async (p) => {
      if (!(await ask({ title: 'Supprimer ce versement ?', message: `${money(p.amount)} du ${when(p.created_at)}. La dette du client augmentera d’autant.`, confirm: 'Supprimer', danger: true }))) return;
      try {
        await api.del(`/customer-payments/${p.id}`);
        await load();
        emit('changed');
      } catch (e) {
        toastError(e);
      }
    };
    const remove = async () => {
      if (!(await ask({ title: `Supprimer ${c.value.name} ?`, message: 'Le client disparaît de la liste ; ses ventes restent dans l’historique.', confirm: 'Supprimer', danger: true }))) return;
      try {
        await api.del(`/customers/${c.value.id}`);
        emit('changed');
        emit('close');
      } catch (e) {
        toastError(e);
      }
    };
    const remind = () => {
      const s = store.settings;
      const text = `Bonjour ${c.value.name},\nVotre solde chez ${s.store_name} est de ${money(c.value.balance)}.\nMerci de passer régler à votre convenance.\n${s.store_phone ? 'Tél : ' + s.store_phone : ''}`;
      openWhatsApp(text.trim(), c.value.phone);
    };
    const saved = async () => {
      editing.value = false;
      await load();
      emit('changed');
    };
    return { c, ledger, paying, editing, startPay, pay, removePayment, remove, remind, saved, printStatement, store, can, money, when, go };
  },
  template: `
    <Sheet :title="c ? c.name : 'Client'" size="wide" @close="$emit('close')">
      <Skeleton v-if="!c" :rows="4" />
      <div v-else class="stack loose">
        <div class="row wrap top">
          <div class="grow">
            <div class="xsmall faint">{{ c.balance > 0 ? 'Le client doit' : c.balance < 0 ? 'Avance du client' : 'Compte soldé' }}</div>
            <div class="balance-big" :class="c.balance > 0 ? 'debt' : 'clear'">{{ money(Math.abs(c.balance)) }}</div>
            <div class="small muted" v-if="c.credit_limit > 0">Plafond de crédit : {{ money(c.credit_limit) }}</div>
          </div>
          <div class="stack tight small muted" style="min-width:200px">
            <span>{{ c.type === 'wholesale' ? 'Revendeur (gros)' : 'Particulier' }}</span>
            <span v-if="c.phone"><a :href="'tel:' + c.phone">{{ c.phone }}</a></span>
            <span v-if="c.address">{{ c.address }}</span>
            <span>{{ c.totals.count }} achat(s) · {{ money(c.totals.total) }}</span>
          </div>
        </div>
        <div class="row wrap">
          <button v-if="can('payments.receive')" type="button" class="btn primary" @click="startPay"><Icon name="coins" />Encaisser un versement</button>
          <button type="button" class="btn" @click="printStatement(c, ledger)"><Icon name="printer" />Relevé de compte</button>
          <button v-if="c.balance > 0" type="button" class="btn" @click="remind"><Icon name="message" />Rappel WhatsApp</button>
          <button type="button" class="btn" @click="editing = true"><Icon name="edit" />Modifier</button>
        </div>
        <p v-if="c.notes" class="small muted">{{ c.notes }}</p>

        <div>
          <h3 style="margin-bottom:8px">Historique du compte</h3>
          <div class="table-wrap" style="border:1px solid var(--line)" v-if="ledger.length || c.opening_balance">
            <table class="table compact-table">
              <thead><tr><th>Date</th><th>Opération</th><th class="num">Dette +</th><th class="num">Versé −</th><th class="num">Solde</th><th></th></tr></thead>
              <tbody>
                <tr v-for="r in ledger" :key="r.key" :class="{ click: r.sale }" @click="r.sale && go('/ventes', { vente: r.sale.id })">
                  <td class="nowrap">{{ when(r.date) }}</td>
                  <td>{{ r.label }}<div class="cell-sub" v-if="r.sale">Total {{ money(r.total) }}<template v-if="r.debit === 0 && r.sale.status === 'completed'"> · payé comptant</template></div></td>
                  <td class="num ledger-amount plus">{{ r.debit ? money(r.debit, { bare: true }) : '' }}</td>
                  <td class="num ledger-amount minus">{{ r.credit ? money(r.credit, { bare: true }) : '' }}</td>
                  <td class="num strong">{{ money(r.balance, { bare: true }) }}</td>
                  <td><button v-if="r.payment && can('payments.delete')" type="button" class="icon-btn sm" @click.stop="removePayment(r.payment)" aria-label="Supprimer le versement"><Icon name="trash" size="sm" /></button></td>
                </tr>
                <tr v-if="c.opening_balance"><td></td><td>Dette antérieure (avant le logiciel)</td><td class="num ledger-amount plus">{{ money(c.opening_balance, { bare: true }) }}</td><td></td><td></td><td></td></tr>
              </tbody>
            </table>
          </div>
          <p v-else class="small muted">Aucune opération pour ce client.</p>
        </div>
      </div>
      <template #foot v-if="c && can('customers.delete')">
        <button type="button" class="btn danger" @click="remove" style="margin-right:auto">Supprimer le client</button>
      </template>
    </Sheet>

    <Sheet v-if="paying" title="Versement du client" size="narrow" @close="paying = null">
      <form id="pay-form" class="stack" @submit.prevent="pay">
        <p class="small muted">{{ c.name }} doit actuellement <b>{{ money(c.balance) }}</b>.</p>
        <div class="field"><label for="vp-amount">Montant versé</label><input id="vp-amount" class="input num" v-model="paying.amount" inputmode="decimal" required style="font-size:1.25rem;font-weight:700" autofocus /></div>
        <div class="field"><span class="label">Moyen de paiement</span>
          <div class="methods"><button v-for="m in store.paymentMethods" :key="m" type="button" class="method" :class="{ on: paying.method === m }" @click="paying.method = m">{{ m }}</button></div>
        </div>
        <div class="field"><label for="vp-note">Remarque</label><input id="vp-note" class="input" v-model="paying.note" maxlength="200" placeholder="Facultatif" /></div>
      </form>
      <template #foot><button type="button" class="btn" @click="paying = null">Annuler</button><button type="submit" form="pay-form" class="btn success" :class="{ loading: paying.busy }" :disabled="paying.busy">Enregistrer le versement</button></template>
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
        <h1>Clients & crédits</h1>
        <a v-if="can('reports.view')" class="btn hide-phone" :href="exportUrl"><Icon name="download" />Exporter</a>
        <button type="button" class="btn primary" @click="creating = true"><Icon name="plus" />Nouveau client</button>
      </div>
      <div class="summary-strip" v-if="rows">
        <span>Les clients vous doivent <b style="color:var(--credit-ink)">{{ money(debt.total) }}</b></span>
        <span><b>{{ debt.count }}</b> client{{ debt.count > 1 ? 's' : '' }} avec une dette</span>
        <span><b>{{ rows.length }}</b> clients au total</span>
      </div>
      <div class="toolbar">
        <div class="input-affix search"><Icon name="search" /><input class="input" v-model="q" placeholder="Nom ou téléphone" /></div>
        <div class="chips">
          <button type="button" class="chip" :class="{ on: filter === 'all' }" @click="filter = 'all'">Tous</button>
          <button type="button" class="chip" :class="{ on: filter === 'debt' }" @click="filter = 'debt'">Avec une dette</button>
          <button type="button" class="chip" :class="{ on: filter === 'wholesale' }" @click="filter = 'wholesale'">Revendeurs</button>
        </div>
      </div>
      <Skeleton v-if="!rows" />
      <div v-else-if="list.length" class="list">
        <button v-for="c in list" :key="c.id" type="button" class="list-row" @click="open(c.id)">
          <div class="main-col">
            <div class="title">{{ c.name }}</div>
            <div class="sub">{{ c.phone || 'Sans téléphone' }} · {{ c.type === 'wholesale' ? 'Revendeur' : 'Particulier' }}<template v-if="c.last_sale"> · dernier achat {{ when(c.last_sale) }}</template></div>
          </div>
          <div class="end">
            <span v-if="c.balance > 0.004" class="badge credit">Doit {{ money(c.balance) }}</span>
            <span v-else-if="c.balance < -0.004" class="badge paid">Avance {{ money(-c.balance) }}</span>
            <span v-else class="badge">Soldé</span>
          </div>
        </button>
      </div>
      <Empty v-else icon="users" :title="q || filter !== 'all' ? 'Aucun client trouvé' : 'Aucun client'" text="Créez un compte client pour vendre à crédit et suivre ses versements." />

      <CustomerDetail v-if="openId" :id="openId" :key="openId" @close="close" @changed="load" />
      <CustomerForm v-if="creating" @close="creating = false" @saved="created" />
    </div>`,
};
