// Dépenses du magasin (transport, loyer, électricité…), payées depuis la caisse ou non.
import { ref, computed, watch, onMounted, onUnmounted } from '../vue.js';
import { api } from '../api.js';
import { store, can, onChange, toast, toastError, ask, CASH } from '../store.js';
import { money, parseNum, when } from '../format.js';
import { Icon, Sheet, Empty, Skeleton, PeriodPicker, periodRange } from '../components/ui.js';

export default {
  components: { Icon, Sheet, Empty, Skeleton, PeriodPicker },
  setup() {
    const period = ref({ id: 'month', ...periodRange('month') });
    const rows = ref(null);
    const categories = ref([]);
    const form = ref(null);
    const load = async () => {
      try {
        rows.value = await api.get('/expenses', { from: period.value.from, to: period.value.to });
      } catch (e) {
        toastError(e);
      }
    };
    watch(period, load, { deep: true });
    let off = null;
    onMounted(async () => {
      load();
      off = onChange('expenses', load);
      try {
        categories.value = await api.get('/expenses/categories');
      } catch {
        /* suggestions facultatives */
      }
    });
    onUnmounted(() => off?.());
    const total = computed(() => (rows.value || []).reduce((s, e) => s + e.amount, 0));
    const byCat = computed(() => {
      const m = new Map();
      for (const e of rows.value || []) m.set(e.category, (m.get(e.category) || 0) + e.amount);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    });
    const start = () => {
      form.value = { amount: '', category: categories.value[0] || 'Transport', method: CASH, note: '', busy: false };
    };
    const save = async () => {
      const f = form.value;
      const amount = parseNum(f.amount);
      if (!(amount > 0)) return toast('Montant invalide.', 'error');
      f.busy = true;
      try {
        await api.post('/expenses', { amount, category: f.category, method: f.method, note: f.note });
        form.value = null;
        toast('Dépense enregistrée.', 'success');
        load();
      } catch (e) {
        toastError(e);
        f.busy = false;
      }
    };
    const remove = async (e) => {
      if (!(await ask({ title: 'Supprimer cette dépense ?', message: `${e.category} — ${money(e.amount)}`, confirm: 'Supprimer', danger: true }))) return;
      try {
        await api.del(`/expenses/${e.id}`);
        load();
      } catch (err) {
        toastError(err);
      }
    };
    return { store, period, rows, categories, form, total, byCat, start, save, remove, can, money, when };
  },
  template: `
    <div class="page">
      <div class="page-head">
        <h1>Dépenses</h1>
        <button type="button" class="btn primary" @click="start"><Icon name="plus" />Nouvelle dépense</button>
      </div>
      <div class="toolbar"><PeriodPicker v-model="period" /></div>
      <div class="summary-strip" v-if="rows">
        <span>Total <b>{{ money(total) }}</b></span>
        <span v-for="[c, v] in byCat.slice(0, 4)" :key="c">{{ c }} <b>{{ money(v) }}</b></span>
      </div>
      <Skeleton v-if="!rows" />
      <div v-else-if="rows.length" class="list">
        <div v-for="e in rows" :key="e.id" class="list-row">
          <div class="main-col">
            <div class="title">{{ e.category }}<span v-if="e.note" class="faint"> · {{ e.note }}</span></div>
            <div class="sub">{{ when(e.created_at) }} · {{ e.method }} · {{ e.user_name }}</div>
          </div>
          <div class="end num strong">{{ money(e.amount) }}</div>
          <button v-if="can('expenses.manage')" type="button" class="icon-btn sm" @click="remove(e)" aria-label="Supprimer"><Icon name="trash" size="sm" /></button>
        </div>
      </div>
      <Empty v-else icon="wallet" title="Aucune dépense sur cette période" text="Notez ici l'argent sorti de la caisse (transport, manutention, repas…) pour que la caisse du soir tombe juste." />

      <Sheet v-if="form" title="Nouvelle dépense" size="narrow" @close="form = null">
        <form id="exp-form" class="stack" @submit.prevent="save">
          <div class="field"><label for="ex-amount">Montant</label><input id="ex-amount" class="input num" v-model="form.amount" inputmode="decimal" required autofocus style="font-size:1.25rem;font-weight:700" /></div>
          <div class="field"><label for="ex-cat">Catégorie</label><input id="ex-cat" class="input" v-model="form.category" list="exp-cats" maxlength="60" required /><datalist id="exp-cats"><option v-for="c in categories" :key="c" :value="c"></option></datalist></div>
          <div class="field"><span class="label">Payé par</span>
            <div class="methods"><button v-for="m in store.paymentMethods" :key="m" type="button" class="method" :class="{ on: form.method === m }" @click="form.method = m">{{ m }}</button></div>
            <span class="hint">« Espèces » = argent pris dans la caisse : il sera déduit de la caisse du jour.</span>
          </div>
          <div class="field"><label for="ex-note">Détail</label><input id="ex-note" class="input" v-model="form.note" maxlength="300" placeholder="Ex. : taxi livraison Boutique Awa" /></div>
        </form>
        <template #foot><button type="button" class="btn" @click="form = null">Annuler</button><button type="submit" form="exp-form" class="btn primary" :class="{ loading: form.busy }" :disabled="form.busy">Enregistrer</button></template>
      </Sheet>
    </div>`,
};
