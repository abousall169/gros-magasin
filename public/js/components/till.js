// Journée du caissier : totaux depuis sa dernière fin de journée (ventes, espèces en caisse, autres paiements,
// dépenses), fenêtre « Nouvelle dépense » et fenêtre « Terminer la journée » (totaux remis à zéro, ticket imprimé).
// Il n'y a rien à ouvrir : la journée suivante commence dès que la précédente est terminée.
import { ref, computed, onMounted, onUnmounted } from '../vue.js';
import { api } from '../api.js';
import { store, toast, toastError, ask, onChange, CASH } from '../store.js';
import { t, payLabel } from '../i18n.js';
import { money, parseNum, roundMoney, timeFr, when } from '../format.js';
import { Icon, Sheet } from './ui.js';
import { printSession } from '../print.js';

/** Journée en cours de l'employé : { from, opening_float, breakdown, last_closed } (undefined tant que pas chargée). */
export function useDay() {
  const day = ref(undefined);
  const loadDay = async () => {
    try {
      day.value = await api.get('/cash/current');
    } catch {
      /* hors ligne : on garde les derniers totaux connus */
    }
  };
  const offs = [];
  onMounted(() => {
    loadDay();
    // Les totaux suivent les encaissements et les dépenses, sur tous les appareils
    offs.push(onChange('cash', loadDay), onChange('sales', loadDay), onChange('expenses', loadDay));
  });
  onUnmounted(() => offs.forEach((off) => off?.()));
  return { day, loadDay };
}

/** Fenêtre de saisie d'une dépense payée depuis la caisse : montant, motif, détail, moyen de paiement. */
export const ExpenseSheet = {
  components: { Icon, Sheet },
  props: { title: String },
  emits: ['close', 'saved'],
  setup(_, { emit }) {
    const f = ref({ amount: '', category: '', method: CASH, note: '', busy: false });
    const categories = ref([]);
    onMounted(async () => {
      try {
        categories.value = await api.get('/expenses/categories');
      } catch {
        /* suggestions facultatives */
      }
    });
    const save = async () => {
      const v = f.value;
      const amount = parseNum(v.amount);
      if (!(amount > 0)) return toast(t('Montant invalide.'), 'error');
      if (!v.category.trim()) return toast(t('Choisissez le motif de la dépense.'), 'error');
      v.busy = true;
      try {
        await api.post('/expenses', { amount, category: v.category.trim(), method: v.method, note: v.note });
        toast(t('Dépense enregistrée.'), 'success');
        emit('saved');
        emit('close');
      } catch (e) {
        toastError(e);
        v.busy = false;
      }
    };
    return { store, f, categories, save, payLabel, CASH };
  },
  template: `
    <Sheet :title="title || t('Nouvelle dépense')" size="narrow" @close="$emit('close')">
      <form id="exp-sheet" class="stack" @submit.prevent="save">
        <div class="field"><label for="exp-amount">{{ t('Montant') }}</label><input id="exp-amount" class="input num" v-model="f.amount" inputmode="decimal" autofocus style="font-size:1.25rem;font-weight:700" /></div>
        <div class="field"><span class="label">{{ t('Motif') }}</span>
          <div class="chips wrap" v-if="categories.length">
            <button v-for="c in categories" :key="c" type="button" class="chip" :class="{ on: f.category === c }" @click="f.category = c">{{ c }}</button>
          </div>
          <input class="input" v-model="f.category" maxlength="60" :placeholder="t('Autre motif…')" :aria-label="t('Motif')" />
        </div>
        <div class="field"><label for="exp-note">{{ t('Détail') }}</label><input id="exp-note" class="input" v-model="f.note" maxlength="300" :placeholder="t('Ex. : taxi livraison Boutique Awa')" /></div>
        <div class="field"><span class="label">{{ t('Payé par') }}</span>
          <div class="methods"><button v-for="m in store.paymentMethods" :key="m" type="button" class="method" :class="{ on: f.method === m }" @click="f.method = m">{{ payLabel(m) }}</button></div>
          <span class="hint">{{ t('« Espèces » = argent pris dans la caisse : il sera déduit de la caisse du jour.') }}</span>
        </div>
      </form>
      <template #foot>
        <button type="button" class="btn" @click="$emit('close')">{{ t('Annuler') }}</button>
        <button type="submit" form="exp-sheet" class="btn primary" :class="{ loading: f.busy }" :disabled="f.busy">{{ t('Enregistrer') }}</button>
      </template>
    </Sheet>`,
};

/** Fenêtre « Terminer la journée » : total caisse (ventes − dépenses), détail, ticket imprimé, totaux remis à zéro. */
export const EndDaySheet = {
  components: { Icon, Sheet },
  props: { day: Object },
  emits: ['close', 'ended'],
  setup(props, { emit }) {
    const counted = ref('');
    const note = ref('');
    const busy = ref(false);
    const ended = ref(null);
    const waiting = ref(0); // ventes envoyées par les vendeurs, pas encore encaissées
    onMounted(async () => {
      try {
        waiting.value = (await api.get('/orders')).length;
      } catch {
        /* facultatif */
      }
    });
    const b = computed(() => props.day.breakdown);
    const gap = computed(() => (counted.value === '' ? null : roundMoney((parseNum(counted.value) || 0) - b.value.expected)));
    const finish = async () => {
      const value = counted.value === '' ? null : parseNum(counted.value);
      if (value !== null && !(value >= 0)) return toast(t('Montant compté invalide.'), 'error');
      const sure = await ask({
        title: t('Terminer la journée ?'),
        message: t('Le ticket de fin de journée s’imprime et les totaux repartent de zéro.'),
        confirm: t('Terminer la journée'),
        danger: true,
      });
      if (!sure) return;
      busy.value = true;
      try {
        const s = await api.post('/cash/current/close', { counted: value, note: note.value });
        ended.value = s;
        printSession(s);
        emit('ended', s);
      } catch (e) {
        toastError(e);
      } finally {
        busy.value = false;
      }
    };
    const isZero = (d) => Math.abs(d) < 0.005;
    // Rien depuis la dernière fin de journée (le serveur refuse aussi une journée vide)
    const empty = computed(() => {
      const x = b.value;
      return !(x.opening_float > 0) && !x.count && !x.expense_items.length && !x.payments && !x.refunds && !x.suppliers;
    });
    // Ventes par moyen de paiement : espèces (encaissées) puis les autres moyens
    const split = computed(() => [
      ...(b.value.sales > 0 ? [{ method: CASH, amount: b.value.sales }] : []),
      ...b.value.methods,
      ...(b.value.credit > 0 ? [{ method: t('Crédit'), amount: b.value.credit }] : []),
    ]);
    return { store, b, counted, note, busy, ended, waiting, gap, empty, split, finish, printSession, isZero, money, timeFr, when, payLabel };
  },
  template: `
    <Sheet :title="ended ? t('Journée terminée') : t('Terminer la journée')" @close="$emit('close')">
      <!-- Journée terminée -->
      <div v-if="ended" class="stack loose">
        <div class="done">
          <div class="tick"><Icon name="check" /></div>
          <h2>{{ t('Journée terminée') }}</h2>
          <p class="muted small">{{ t('Les totaux repartent de zéro.') }}</p>
        </div>
        <div class="kv">
          <div><span>{{ t('Ventes') }} ({{ ended.breakdown.count }})</span><span>{{ money(ended.breakdown.sales_total) }}</span></div>
          <div><span>− {{ t('Dépenses') }}</span><span>{{ money(ended.breakdown.expenses_total) }}</span></div>
          <div class="total"><span>{{ t('Total caisse') }}</span><span>{{ money(ended.breakdown.till_total) }}</span></div>
          <div v-if="ended.counted !== null"><span>{{ t('Espèces comptées') }}</span><span>{{ money(ended.counted) }}</span></div>
          <div v-if="ended.counted !== null && !isZero(ended.difference)"><span>{{ t('Écart') }}</span><span :style="{ color: 'var(--credit-ink)' }">{{ money(ended.difference, { sign: true }) }}</span></div>
        </div>
      </div>

      <!-- Récapitulatif avant de terminer -->
      <div v-else class="stack loose">
        <p class="small muted">{{ t('Journée commencée {d}.', { d: when(day.from) }) }}</p>
        <div v-if="empty" class="alert"><Icon name="alert" /><span>{{ t('Rien à terminer : aucune vente ni dépense depuis la dernière fin de journée.') }}</span></div>
        <div v-if="store.pending" class="alert danger"><Icon name="wifi" /><span>{{ t('{n} vente(s) encore gardée(s) sur cet appareil : attendez le retour du réseau avant de terminer la journée.', { n: store.pending }) }}</span></div>
        <div v-if="waiting" class="alert"><Icon name="alert" /><span>{{ t('Il reste {n} vente(s) à encaisser.', { n: waiting }) }}</span></div>

        <div class="kv">
          <div><span>{{ t('Ventes') }} ({{ b.count }})</span><span>{{ money(b.sales_total) }}</span></div>
          <div><span>− {{ t('Dépenses') }}</span><span>{{ money(b.expenses_total) }}</span></div>
        </div>
        <div class="pay-summary"><div class="sum-row big"><span>{{ t('Total caisse') }}</span><span>{{ money(b.till_total) }}</span></div></div>

        <section v-if="split.length">
          <div class="till-h"><h3>{{ t('Ventes par moyen de paiement') }}</h3></div>
          <div class="kv"><div v-for="m in split" :key="m.method"><span>{{ payLabel(m.method) }}</span><span>{{ money(m.amount) }}</span></div></div>
        </section>

        <section v-if="b.expense_items.length">
          <div class="till-h"><h3>{{ t('Dépenses') }}</h3></div>
          <div class="list" style="border:1px solid var(--line)">
            <div v-for="e in b.expense_items" :key="e.id" class="list-row">
              <div class="main-col"><div class="title">{{ e.category }}<span v-if="e.note" class="faint"> · {{ e.note }}</span></div><div class="sub">{{ timeFr(e.created_at) }} · {{ payLabel(e.method) }}</div></div>
              <span class="num strong">{{ money(e.amount, { bare: true }) }}</span>
            </div>
          </div>
        </section>

        <div class="field"><label for="day-count">{{ t('Espèces comptées (facultatif)') }}</label><input id="day-count" class="input num" v-model="counted" inputmode="decimal" :placeholder="t('Comptez les billets et pièces')" style="font-size:1.25rem;font-weight:700" />
          <span class="hint">{{ t('Espèces attendues dans le tiroir : {a}', { a: money(b.expected) }) }}</span></div>
        <div v-if="gap !== null" class="alert" :class="gap === 0 ? 'ok' : 'danger'">
          <Icon :name="gap === 0 ? 'check' : 'alert'" />
          <span v-if="gap === 0"><b>{{ t('La caisse est juste.') }}</b></span>
          <span v-else-if="gap < 0"><b>{{ t('Il manque {a} dans la caisse.', { a: money(-gap) }) }}</b></span>
          <span v-else><b>{{ t('Il y a {a} en trop dans la caisse.', { a: money(gap) }) }}</b></span>
        </div>
        <div class="field"><label for="day-note">{{ t('Remarque') }}</label><input id="day-note" class="input" v-model="note" maxlength="300" :placeholder="t('Facultatif')" /></div>
        <div v-if="day.last_closed" class="row wrap small muted">
          <span class="grow">{{ t('Journée précédente terminée {d}.', { d: when(day.last_closed.closed_at) }) }}</span>
          <button type="button" class="btn sm" @click="printSession(day.last_closed)"><Icon name="printer" size="sm" />{{ t('Réimprimer') }}</button>
        </div>
      </div>

      <template #foot>
        <template v-if="ended">
          <button type="button" class="btn" @click="printSession(ended)"><Icon name="printer" />{{ t('Réimprimer') }}</button>
          <button type="button" class="btn primary lg" @click="$emit('close')" autofocus>{{ t('Fermer') }}</button>
        </template>
        <template v-else>
          <button type="button" class="btn" @click="$emit('close')">{{ t('Retour') }}</button>
          <button type="button" class="btn danger solid" :class="{ loading: busy }" :disabled="busy || empty" @click="finish"><Icon name="lock" />{{ t('Terminer la journée') }}</button>
        </template>
      </template>
    </Sheet>`,
};
