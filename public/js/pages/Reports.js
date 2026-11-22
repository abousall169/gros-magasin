// Rapports (chiffre d'affaires, bénéfice, gros / détail, produits) et clôture de caisse.
import { ref, computed, watch, onMounted, onUnmounted } from '../vue.js';
import { api } from '../api.js';
import { store, can, toast, toastError, onChange, CASH } from '../store.js';
import { t, payLabel } from '../i18n.js';
import { money, percent, parseNum, today, dayLong, dayShort, dateTimeFr, stockText, roundMoney } from '../format.js';
import { route, setQuery } from '../router.js';
import { Icon, Empty, Skeleton, PeriodPicker, periodRange } from '../components/ui.js';
import { BarChart, SplitBar } from '../components/charts.js';
import { printCashReport, printSession } from '../print.js';

// ---- Session de caisse : ouverture (fond de caisse) et clôture (espèces comptées) ----------------
const CashSession = {
  components: { Icon },
  props: { session: Object },
  emits: ['closed'],
  setup(props, { emit }) {
    const counted = ref('');
    const note = ref('');
    const busy = ref(false);
    const b = computed(() => props.session.breakdown);
    const gap = computed(() => (counted.value === '' ? null : roundMoney((parseNum(counted.value) || 0) - b.value.expected)));
    const close = async () => {
      const value = parseNum(counted.value);
      if (!(value >= 0)) return toast(t('Indiquez les espèces comptées.'), 'error');
      busy.value = true;
      try {
        const s = await api.post(`/cash/sessions/${props.session.id}/close`, { counted: value, note: note.value });
        toast(t('Caisse clôturée.'), 'success');
        emit('closed', s);
      } catch (e) {
        toastError(e);
      } finally {
        busy.value = false;
      }
    };
    return { counted, note, busy, b, gap, close, money, dateTimeFr };
  },
  template: `
    <section class="panel">
      <div class="panel-head"><h2><Icon name="unlock" size="sm" /> {{ session.user_name ? t('Caisse de {u}', { u: session.user_name }) : t('Caisse du magasin') }}</h2><span class="muted small">{{ t('ouverte le {d}', { d: dateTimeFr(session.opened_at) }) }}</span></div>
      <div class="stack">
        <div class="kv">
          <div><span>{{ t('Fond de caisse') }}</span><span>{{ money(b.opening_float) }}</span></div>
          <div><span>+ {{ t('Ventes en espèces') }}</span><span>{{ money(b.sales) }}</span></div>
          <div><span>+ {{ t('Versements des clients') }}</span><span>{{ money(b.payments) }}</span></div>
          <div v-if="b.refunds"><span>− {{ t('Retours remboursés') }}</span><span>{{ money(b.refunds) }}</span></div>
          <div><span>− {{ t('Dépenses') }}</span><span>{{ money(b.expenses) }}</span></div>
          <div v-if="b.suppliers"><span>− {{ t('Paiements fournisseurs') }}</span><span>{{ money(b.suppliers) }}</span></div>
        </div>
        <div class="pay-summary"><div class="sum-row big"><span>{{ t('Espèces attendues') }}</span><span>{{ money(b.expected) }}</span></div></div>
        <div class="field"><label :for="'cc-count-' + session.id">{{ t('Espèces comptées') }}</label><input :id="'cc-count-' + session.id" class="input num" v-model="counted" inputmode="decimal" :placeholder="t('Comptez les billets et pièces')" style="font-size:1.25rem;font-weight:700" /></div>
        <div v-if="gap !== null" class="alert" :class="gap === 0 ? 'ok' : 'danger'">
          <Icon :name="gap === 0 ? 'check' : 'alert'" />
          <span v-if="gap === 0"><b>{{ t('La caisse est juste.') }}</b></span>
          <span v-else-if="gap < 0"><b>{{ t('Il manque {a} dans la caisse.', { a: money(-gap) }) }}</b></span>
          <span v-else><b>{{ t('Il y a {a} en trop dans la caisse.', { a: money(gap) }) }}</b></span>
        </div>
        <div class="field"><label :for="'cc-note-' + session.id">{{ t('Remarque') }}</label><input :id="'cc-note-' + session.id" class="input" v-model="note" maxlength="300" :placeholder="t('Facultatif')" /></div>
        <button type="button" class="btn danger solid" :class="{ loading: busy }" :disabled="busy || counted === ''" @click="close"><Icon name="lock" />{{ t('Clôturer la caisse') }}</button>
      </div>
    </section>`,
};

const CashClosing = {
  components: { Icon, Skeleton, CashSession },
  setup() {
    const date = ref(today());
    const userId = ref(can('cash.all') ? '' : String(store.me.id));
    const r = ref(null);
    const sessions = ref(null);
    const opening = ref({ float: '', scope: 'me', busy: false });
    const users = computed(() => store.status?.users || []);
    const load = async () => {
      try {
        r.value = await api.get('/reports/cash', { date: date.value, user_id: userId.value });
      } catch (e) {
        toastError(e);
      }
    };
    const loadSessions = async () => {
      try {
        sessions.value = await api.get('/cash/sessions');
      } catch (e) {
        toastError(e);
      }
    };
    watch([date, userId], load);
    let off = null;
    onMounted(() => {
      load();
      loadSessions();
      off = onChange('cash', loadSessions);
    });
    onUnmounted(() => off?.());
    const mine = computed(() => sessions.value?.open.find((s) => s.user_id === store.me.id));
    const storeSession = computed(() => sessions.value?.open.find((s) => !s.user_id));
    const others = computed(() => (sessions.value?.open || []).filter((s) => s.user_id && s.user_id !== store.me.id));
    const canOpen = computed(() => sessions.value && (opening.value.scope === 'store' ? !storeSession.value : !mine.value));
    // Ma caisse déjà ouverte : le gestionnaire ne peut plus ouvrir que celle du magasin
    watch(mine, (m) => {
      if (m && opening.value.scope === 'me') opening.value.scope = 'store';
    });
    const open = async () => {
      opening.value.busy = true;
      try {
        await api.post('/cash/sessions', { opening_float: parseNum(opening.value.float) || 0, scope: opening.value.scope });
        opening.value.float = '';
        toast(t('Caisse ouverte.'), 'success');
        loadSessions();
      } catch (e) {
        toastError(e);
      } finally {
        opening.value.busy = false;
      }
    };
    const closed = (s) => {
      loadSessions();
      load();
      printSession(s);
    };
    const print = () => printCashReport(r.value);
    return { date, userId, r, sessions, opening, users, mine, storeSession, others, canOpen, open, closed, print, printSession, load, can, money, dayLong, dateTimeFr, payLabel, CASH, todayStr: today() };
  },
  template: `
    <div class="stack loose">
      <div class="cols">
        <CashSession v-if="mine" :session="mine" @closed="closed" />
        <CashSession v-if="storeSession && can('cash.all')" :session="storeSession" @closed="closed" />
        <section class="panel" v-if="sessions && (!mine || (can('cash.all') && !storeSession))">
          <div class="panel-head"><h2><Icon name="lock" size="sm" /> {{ t('Ouvrir la caisse') }}</h2></div>
          <form class="stack" @submit.prevent="open">
            <p class="small muted">{{ t('Au début de la journée, comptez l’argent déjà dans le tiroir (fond de caisse). À la clôture, le logiciel calcule les espèces attendues et l’écart.') }}</p>
            <div v-if="can('cash.all')" class="seg block">
              <button type="button" :class="{ on: opening.scope === 'me' }" :disabled="!!mine" @click="opening.scope = 'me'">{{ t('Ma caisse') }}</button>
              <button type="button" :class="{ on: opening.scope === 'store' }" :disabled="!!storeSession" @click="opening.scope = 'store'">{{ t('Tout le magasin') }}</button>
            </div>
            <div class="field"><label for="cs-float">{{ t('Fond de caisse') }}</label><input id="cs-float" class="input num" v-model="opening.float" inputmode="decimal" placeholder="0" /></div>
            <button class="btn primary" :class="{ loading: opening.busy }" :disabled="opening.busy || !canOpen"><Icon name="unlock" />{{ t('Ouvrir la caisse') }}</button>
          </form>
        </section>
      </div>
      <div v-if="others.length && can('cash.all')" class="cols">
        <CashSession v-for="s in others" :key="s.id" :session="s" @closed="closed" />
      </div>

      <div class="toolbar" style="margin-top:8px">
        <h2 class="grow" style="font-size:1.1875rem">{{ t('Résumé de la journée') }}</h2>
        <input type="date" class="input" style="width:auto" v-model="date" :max="todayStr" :aria-label="t('Jour')" />
        <select v-if="can('cash.all')" class="select" style="width:auto" v-model="userId" :aria-label="t('Vendeur')">
          <option value="">{{ t('Tout le magasin') }}</option>
          <option v-for="u in users" :key="u.id" :value="String(u.id)">{{ u.name }}</option>
        </select>
        <button type="button" class="btn" @click="print" :disabled="!r"><Icon name="printer" />{{ t('Imprimer') }}</button>
      </div>
      <Skeleton v-if="!r" />
      <div v-else class="cols">
        <section class="panel">
          <div class="panel-head"><h2>{{ dayLong(r.date) }}</h2><span class="muted small">{{ r.user ? r.user.name : t('Tout le magasin') }}</span></div>
          <div class="kv">
            <div><span>{{ t('Ventes') }} ({{ r.sales.count }})</span><span>{{ money(r.sales.total) }}</span></div>
            <div v-if="r.sales.credit > 0"><span>{{ t('dont vendu à crédit') }}</span><span style="color:var(--credit-ink)">{{ money(r.sales.credit) }}</span></div>
            <div v-if="r.sales.discount > 0"><span>{{ t('Remises accordées') }}</span><span>{{ money(r.sales.discount) }}</span></div>
            <div v-if="r.cancelled.count"><span>{{ t('Ventes annulées') }} ({{ r.cancelled.count }})</span><span>{{ money(r.cancelled.total) }}</span></div>
          </div>
          <h3 style="margin:20px 0 4px">{{ t('Encaissements des ventes') }}</h3>
          <div class="kv">
            <div v-for="p in r.salePayments" :key="p.method"><span>{{ payLabel(p.method) }}</span><span>{{ money(p.amount) }}</span></div>
            <div v-if="!r.salePayments.length"><span class="faint">{{ t('Aucun encaissement') }}</span><span></span></div>
          </div>
          <template v-if="r.customerPayments.length">
            <h3 style="margin:20px 0 4px">{{ t('Versements des clients') }}</h3>
            <div class="kv"><div v-for="p in r.customerPayments" :key="p.method"><span>{{ payLabel(p.method) }} ({{ p.count }})</span><span>{{ money(p.amount) }}</span></div></div>
          </template>
          <template v-if="r.refunds.length">
            <h3 style="margin:20px 0 4px">{{ t('Retours remboursés') }}</h3>
            <div class="kv"><div v-for="p in r.refunds" :key="p.method"><span>{{ p.method === 'Compte client' ? t('Déduit des dettes') : payLabel(p.method) }} ({{ p.count }})</span><span>{{ money(p.amount) }}</span></div></div>
          </template>
          <template v-if="r.expenses.length">
            <h3 style="margin:20px 0 4px">{{ t('Dépenses') }}</h3>
            <div class="kv"><div v-for="(e, i) in r.expenses" :key="i"><span>{{ e.category }}<span class="faint" v-if="e.note"> · {{ e.note }}</span><span class="faint" v-if="e.method !== CASH"> · {{ e.method }}</span></span><span>{{ money(e.amount) }}</span></div></div>
          </template>
          <template v-if="r.supplierPayments.length">
            <h3 style="margin:20px 0 4px">{{ t('Paiements fournisseurs') }}</h3>
            <div class="kv"><div v-for="p in r.supplierPayments" :key="p.method"><span>{{ payLabel(p.method) }} ({{ p.count }})</span><span>{{ money(p.amount) }}</span></div></div>
          </template>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>{{ t('Espèces de la journée') }}</h2></div>
          <div class="kv">
            <div><span>{{ t('Espèces des ventes') }}</span><span>{{ money(r.cash.sales) }}</span></div>
            <div><span>+ {{ t('Versements en espèces') }}</span><span>{{ money(r.cash.payments) }}</span></div>
            <div v-if="r.cash.refunds"><span>− {{ t('Retours en espèces') }}</span><span>{{ money(r.cash.refunds) }}</span></div>
            <div><span>− {{ t('Dépenses en espèces') }}</span><span>{{ money(r.cash.expenses) }}</span></div>
            <div v-if="r.cash.suppliers"><span>− {{ t('Fournisseurs payés en espèces') }}</span><span>{{ money(r.cash.suppliers) }}</span></div>
            <div class="total"><span>{{ t('Mouvement d’espèces de la journée') }}</span><span>{{ money(r.cash.expected) }}</span></div>
          </div>
          <p class="xsmall faint" style="margin-top:8px">{{ t('Sans le fond de caisse. Pour compter le tiroir, ouvrez puis clôturez une session de caisse ci-dessus.') }}</p>
        </section>
      </div>

      <section class="panel" v-if="sessions && sessions.history.length">
        <div class="panel-head"><h2>{{ t('Clôtures précédentes') }}</h2></div>
        <div class="list">
          <div v-for="s in sessions.history" :key="s.id" class="list-row">
            <div class="main-col"><div class="title">{{ dateTimeFr(s.closed_at) }} · {{ s.user_name || t('Tout le magasin') }}</div><div class="sub">{{ t('Attendu') }} {{ money(s.expected) }} · {{ s.counted === null ? t('non comptées') : t('compté') + ' ' + money(s.counted) }}<template v-if="s.closed_by_name"> · {{ s.closed_by_name }}</template><template v-if="s.note"> · {{ s.note }}</template></div></div>
            <span v-if="s.counted === null" class="badge">{{ t('Non compté') }}</span>
            <span v-else class="badge" :class="Math.abs(s.difference) < 0.005 ? 'paid' : 'danger'">{{ Math.abs(s.difference) < 0.005 ? t('Juste') : money(s.difference, { sign: true }) }}</span>
            <button type="button" class="icon-btn sm" @click="printSession(s)" :aria-label="t('Imprimer')"><Icon name="printer" size="sm" /></button>
          </div>
        </div>
      </section>
    </div>`,
};

export default {
  components: { Icon, Empty, Skeleton, PeriodPicker, BarChart, SplitBar, CashClosing },
  setup() {
    const cashierOnly = computed(() => !can('reports.view'));
    const tab = computed(() => (cashierOnly.value ? 'caisse' : route.query.onglet || 'resume'));
    const setTab = (t) => setQuery({ onglet: t });
    const period = ref({ id: '7d', ...periodRange('7d') });
    const d = ref(null);
    const loading = ref(false);
    const showTable = ref(false);
    const load = async () => {
      if (cashierOnly.value) return;
      loading.value = true;
      try {
        d.value = await api.get('/reports/summary', { from: period.value.from, to: period.value.to });
      } catch (e) {
        toastError(e);
      } finally {
        loading.value = false;
      }
    };
    watch(period, load, { deep: true });
    onMounted(load);
    const split = computed(() => {
      const by = Object.fromEntries((d.value?.byType || []).map((x) => [x.sale_type, x.revenue]));
      return { retail: by.retail || 0, semi: by.semi || 0, wholesale: by.wholesale || 0 };
    });
    const collected = computed(() => {
      const m = new Map();
      for (const p of d.value?.salePayments || []) m.set(p.method, (m.get(p.method) || 0) + p.amount);
      for (const p of d.value?.customerPayments || []) m.set(p.method, (m.get(p.method) || 0) + p.amount);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    });
    const exportUrl = (kind) => api.url(`/export/${kind}.csv`, { from: period.value.from, to: period.value.to });
    const productMax = computed(() => Math.max(1, ...(d.value?.products || []).map((p) => p.revenue)));
    return { cashierOnly, tab, setTab, period, d, loading, showTable, split, collected, exportUrl, productMax, can, money, percent, dayShort, stockText };
  },
  template: `
    <div class="page">
      <div class="page-head"><h1>{{ cashierOnly ? t('Ma caisse du jour') : t('Rapports') }}</h1></div>
      <nav class="tabs" v-if="!cashierOnly">
        <button type="button" :class="{ on: tab === 'resume' }" @click="setTab('resume')">Résumé</button>
        <button type="button" :class="{ on: tab === 'produits' }" @click="setTab('produits')">Produits vendus</button>
        <button type="button" :class="{ on: tab === 'caisse' }" @click="setTab('caisse')">Caisse : ouverture et clôture</button>
      </nav>

      <CashClosing v-if="tab === 'caisse'" />

      <template v-else>
        <div class="toolbar">
          <PeriodPicker v-model="period" />
          <a class="btn sm hide-phone" :href="exportUrl('sales')"><Icon name="download" size="sm" />Ventes (Excel)</a>
          <a class="btn sm hide-phone" :href="exportUrl('sale-items')"><Icon name="download" size="sm" />Détail des lignes</a>
        </div>
        <Skeleton v-if="!d" :rows="6" />
        <div v-else :style="{ opacity: loading ? 0.6 : 1 }">
          <template v-if="tab === 'resume'">
            <section class="day">
              <div class="day-main">
                <small>Chiffre d'affaires</small>
                <strong>{{ money(d.totals.revenue) }}</strong>
                <div class="vs">{{ d.totals.count }} vente{{ d.totals.count > 1 ? 's' : '' }} · panier moyen {{ money(d.totals.average) }}</div>
                <div class="vs" v-if="d.cancelled.count">{{ d.cancelled.count }} vente(s) annulée(s) : {{ money(d.cancelled.total) }}</div>
                <div class="vs" v-if="d.totals.refunds">{{ d.totals.refundCount }} retour(s) d'articles : −{{ money(d.totals.refunds) }}</div>
                <div class="vs" v-if="d.totals.tax">dont TVA collectée : {{ money(d.totals.tax) }}</div>
              </div>
              <div class="figures">
                <div class="figure ok"><small>Bénéfice brut</small><strong>{{ money(d.totals.margin) }}</strong><div class="sub">{{ percent(d.totals.marginRate) }} des ventes nettes{{ d.totals.tax ? ', hors TVA' : '' }}</div></div>
                <div class="figure"><small>Dépenses</small><strong>{{ money(d.totals.expenses) }}</strong><div class="sub">{{ d.expenses.length }} catégorie(s)</div></div>
                <div class="figure" :class="d.totals.net >= 0 ? 'ok' : 'danger'"><small>Bénéfice net</small><strong>{{ money(d.totals.net) }}</strong><div class="sub">bénéfice brut − dépenses</div></div>
                <div class="figure" :class="{ danger: d.totals.credit > 0 }"><small>Vendu à crédit</small><strong>{{ money(d.totals.credit) }}</strong><div class="sub">versements reçus : {{ money(d.totals.customerPayments) }}</div></div>
              </div>
              <div class="split">
                <span class="label">Gros et détail</span>
                <SplitBar v-if="split.retail + split.semi + split.wholesale > 0" :retail="split.retail" :semi="split.semi" :wholesale="split.wholesale" />
                <p v-else class="small faint">Aucune vente sur la période.</p>
              </div>
            </section>

            <section class="panel">
              <div class="panel-head"><h2>Chiffre d'affaires par jour</h2><button type="button" class="btn sm ghost" @click="showTable = !showTable">{{ showTable ? 'Graphique' : 'Tableau' }}</button></div>
              <BarChart v-if="!showTable && d.byDay.length <= 62" :data="d.byDay" :highlight-last="period.id === '7d' || period.id === 'month' || period.id === 'today'" label="Chiffre d'affaires par jour" />
              <div v-else class="table-wrap" style="max-height:420px;overflow:auto">
                <table class="table compact-table">
                  <thead><tr><th>Jour</th><th class="num">Ventes</th><th class="num">Chiffre d'affaires</th><th class="num">Bénéfice brut</th></tr></thead>
                  <tbody><tr v-for="s in d.byDay.slice().reverse()" :key="s.day"><td>{{ dayShort(s.day) }}</td><td class="num">{{ s.count }}</td><td class="num">{{ money(s.revenue) }}</td><td class="num">{{ money(s.margin) }}</td></tr></tbody>
                </table>
              </div>
            </section>

            <div class="cols" style="margin-top:16px">
              <section class="panel">
                <div class="panel-head"><h2>Argent encaissé</h2></div>
                <div class="kv">
                  <div v-for="[m, v] in collected" :key="m"><span>{{ m }}</span><span>{{ money(v) }}</span></div>
                  <div v-if="!collected.length"><span class="faint">Aucun encaissement</span><span></span></div>
                  <div class="total"><span>Total encaissé</span><span>{{ money(collected.reduce((s, x) => s + x[1], 0)) }}</span></div>
                  <div v-for="p in d.refundMethods" :key="'r' + p.method"><span class="faint">Retours remboursés · {{ p.method === 'Compte client' ? 'déduits des dettes' : p.method }}</span><span>−{{ money(p.amount) }}</span></div>
                </div>
                <p class="xsmall faint" style="margin-top:8px">Ventes payées comptant et versements des clients sur leurs dettes.</p>
              </section>
              <section class="panel">
                <div class="panel-head"><h2>Par vendeur</h2></div>
                <table class="table compact-table" v-if="d.users.length">
                  <thead><tr><th>Vendeur</th><th class="num">Ventes</th><th class="num">Montant</th><th class="num">À crédit</th></tr></thead>
                  <tbody><tr v-for="u in d.users" :key="u.id"><td class="cell-title">{{ u.name }}</td><td class="num">{{ u.count }}</td><td class="num">{{ money(u.revenue) }}</td><td class="num">{{ money(u.credit) }}</td></tr></tbody>
                </table>
                <p v-else class="small muted">Aucune vente.</p>
              </section>
              <section class="panel">
                <div class="panel-head"><h2>Par rayon</h2></div>
                <table class="table compact-table" v-if="d.categories.length">
                  <thead><tr><th>Rayon</th><th class="num">Chiffre d'affaires</th><th class="num">Bénéfice</th></tr></thead>
                  <tbody><tr v-for="c in d.categories" :key="c.name"><td class="cell-title">{{ c.name }}</td><td class="num">{{ money(c.revenue) }}</td><td class="num">{{ money(c.revenue - c.cost) }}</td></tr></tbody>
                </table>
                <p v-else class="small muted">Aucune vente.</p>
              </section>
              <section class="panel">
                <div class="panel-head"><h2>Dépenses par catégorie</h2></div>
                <div class="kv" v-if="d.expenses.length">
                  <div v-for="e in d.expenses" :key="e.category"><span>{{ e.category }} <span class="faint">({{ e.count }})</span></span><span>{{ money(e.amount) }}</span></div>
                </div>
                <p v-else class="small muted">Aucune dépense.</p>
                <div class="kv" style="margin-top:12px">
                  <div><span>Achats de marchandises ({{ d.purchases.count }})</span><span>{{ money(d.purchases.total) }}</span></div>
                  <div v-for="p in d.supplierPaid" :key="p.method"><span class="faint">Payé aux fournisseurs · {{ p.method }}</span><span>{{ money(p.amount) }}</span></div>
                  <div><span>Dettes clients à ce jour</span><span style="color:var(--credit-ink)">{{ money(d.receivables.total) }}</span></div>
                  <div><span>Dû aux fournisseurs à ce jour</span><span :style="d.payables > 0 ? 'color:var(--credit-ink)' : ''"><a href="#/stock?onglet=fournisseurs">{{ money(d.payables) }}</a></span></div>
                </div>
              </section>
            </div>
          </template>

          <section v-else-if="tab === 'produits'" class="table-wrap">
            <table class="table" v-if="d.products.length">
              <thead><tr><th>Produit</th><th class="num">Quantité vendue</th><th class="num">Chiffre d'affaires</th><th class="num">Bénéfice</th><th class="num hide-phone">Part en gros</th></tr></thead>
              <tbody>
                <tr v-for="p in d.products" :key="p.product_id + p.name">
                  <td><div class="cell-title">{{ p.name }}</div><div class="meter hide-phone" style="max-width:220px"><i :style="{ width: (p.revenue / productMax * 100) + '%' }"></i></div></td>
                  <td class="num">{{ p.unit ? stockText(p, p.qty) : p.qty }}</td>
                  <td class="num">{{ money(p.revenue) }}</td>
                  <td class="num">{{ money(p.revenue - p.cost) }}<div class="cell-sub">{{ p.revenue ? percent((p.revenue - p.cost) / p.revenue * 100) : '' }}</div></td>
                  <td class="num hide-phone">{{ p.revenue ? percent(p.wholesale / p.revenue * 100) : '—' }}</td>
                </tr>
              </tbody>
            </table>
            <Empty v-else icon="chart" title="Aucune vente sur cette période" />
          </section>
        </div>
      </template>
    </div>`,
};
