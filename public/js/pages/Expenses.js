// Dépenses du magasin (transport, loyer, électricité…), payées depuis la caisse ou non.
// Pour le caissier : ses dépenses, celles du jour par défaut ; il peut supprimer une erreur pendant sa journée.
import { ref, computed, watch, onMounted, onUnmounted } from '../vue.js';
import { api } from '../api.js';
import { store, can, onChange, toast, toastError, ask, CASH } from '../store.js';
import { money, parseNum, when } from '../format.js';
import { t, payLabel } from '../i18n.js';
import { Icon, Sheet, Empty, Skeleton, PeriodPicker, periodRange } from '../components/ui.js';
import { useDay, ExpenseSheet } from '../components/till.js';

export default {
  components: { Icon, Sheet, Empty, Skeleton, PeriodPicker, ExpenseSheet },
  setup() {
    // Caissier (sans « expenses.manage ») : journée en cours par défaut
    const desk = !can('expenses.manage');
    const period = ref(desk ? { id: 'today', ...periodRange('today') } : { id: 'month', ...periodRange('month') });
    const { day, loadDay } = desk && can('cash.own') ? useDay() : { day: ref(null), loadDay: () => {} };
    /** Le caissier peut supprimer une de ses dépenses saisie par erreur, tant que sa journée n'est pas terminée. */
    const canRemove = (e) => can('expenses.manage') || (e.user_id === store.me.id && day.value && e.created_at >= day.value.from);
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
      form.value = true;
    };
    const saved = () => {
      load();
      loadDay();
    };
    const remove = async (e) => {
      if (!(await ask({ title: t('Supprimer cette dépense ?'), message: `${e.category} — ${money(e.amount)}`, confirm: t('Supprimer'), danger: true }))) return;
      try {
        await api.del(`/expenses/${e.id}`);
        saved();
      } catch (err) {
        toastError(err);
      }
    };
    return { store, desk, period, rows, categories, form, total, byCat, start, saved, remove, canRemove, can, money, when, payLabel };
  },
  template: `
    <div class="page">
      <div class="page-head">
        <h1>{{ t('Dépenses') }}</h1>
        <button type="button" class="btn primary" @click="start"><Icon name="plus" />{{ t('Nouvelle dépense') }}</button>
      </div>
      <div class="toolbar"><PeriodPicker v-model="period" /></div>
      <div class="summary-strip" v-if="rows">
        <span>{{ t('Total') }} <b>{{ money(total) }}</b></span>
        <span v-for="[c, v] in byCat.slice(0, 4)" :key="c">{{ c }} <b>{{ money(v) }}</b></span>
      </div>
      <Skeleton v-if="!rows" />
      <div v-else-if="rows.length" class="list">
        <div v-for="e in rows" :key="e.id" class="list-row">
          <div class="main-col">
            <div class="title">{{ e.category }}<span v-if="e.note" class="faint"> · {{ e.note }}</span></div>
            <div class="sub">{{ when(e.created_at) }} · {{ payLabel(e.method) }} · {{ e.user_name }}</div>
          </div>
          <div class="end num strong">{{ money(e.amount) }}</div>
          <button v-if="canRemove(e)" type="button" class="icon-btn sm" @click="remove(e)" :aria-label="t('Supprimer')"><Icon name="trash" size="sm" /></button>
        </div>
      </div>
      <Empty v-else icon="wallet" :title="t('Aucune dépense sur cette période')" :text="t('Notez ici l’argent sorti de la caisse (transport, manutention, repas…) pour que la caisse du soir tombe juste.')" />

      <ExpenseSheet v-if="form" @close="form = null" @saved="saved" />
    </div>`,
};
