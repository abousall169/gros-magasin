// Historique des ventes, détail, réimpression, retours d'articles, annulation, ventes hors ligne à vérifier.
import { ref, computed, watch, onMounted, onUnmounted } from '../vue.js';
import { api } from '../api.js';
import { store, can, onChange, toast, toastError, ask, CASH } from '../store.js';
import { t, pname, payLabel } from '../i18n.js';
import { money, qty, plural, parseNum, round3, when, dateTimeFr, saleNo, MODE_LABEL } from '../format.js';
import { route, setQuery } from '../router.js';
import { Icon, Sheet, Empty, Skeleton, PeriodPicker, periodRange } from '../components/ui.js';
import { printTicket, printInvoice, saleText, openWhatsApp, openSms } from '../print.js';

const REVIEW = {
  stock: 'stock insuffisant',
  price: 'prix inférieur au prix fixé par le gérant',
  discount: 'remise non autorisée',
  credit: 'crédit non autorisé ou plafond dépassé',
  date: 'date de l’appareil incorrecte',
  order: 'commande déjà encaissée ou annulée',
};
export const reviewText = (codes) =>
  String(codes || '')
    .split(',')
    .filter(Boolean)
    .map((c) => t(REVIEW[c] || c))
    .join(', ');

// ---- Retour d'articles ------------------------------------------------------------
const RefundDialog = {
  components: { Sheet, Icon },
  props: { sale: Object },
  emits: ['close', 'done'],
  setup(props, { emit }) {
    const qtys = ref({});
    const method = ref(CASH);
    const restock = ref(true);
    const reason = ref('');
    const busy = ref(false);
    const methods = computed(() => [...store.paymentMethods, ...(props.sale.customer_id ? ['Compte client'] : [])]);
    const left = (it) => round3(it.qty - it.returned_qty);
    const chosen = computed(() =>
      props.sale.items
        .map((it) => ({ it, qty: parseNum(qtys.value[it.id] ?? '') || 0 }))
        .filter((x) => x.qty > 0),
    );
    const invalid = computed(() => chosen.value.some((x) => x.qty > left(x.it) + 1e-9));
    const ratio = computed(() => (props.sale.subtotal > 0 ? props.sale.total / props.sale.subtotal : 0));
    const estimate = computed(() => chosen.value.reduce((s, x) => s + (x.it.total * ratio.value * x.qty) / x.it.qty, 0));
    const all = (it) => {
      qtys.value = { ...qtys.value, [it.id]: String(left(it)).replace('.', ',') };
    };
    const submit = async () => {
      busy.value = true;
      try {
        const sale = await api.post(`/sales/${props.sale.id}/refund`, {
          items: chosen.value.map((x) => ({ sale_item_id: x.it.id, qty: x.qty })),
          method: method.value,
          restock: restock.value,
          reason: reason.value,
        });
        toast(t('Retour enregistré.'), 'success');
        emit('done', sale);
      } catch (e) {
        toastError(e);
      } finally {
        busy.value = false;
      }
    };
    return { store, qtys, method, restock, reason, busy, methods, left, chosen, invalid, estimate, all, submit, money, qty, plural, pname, payLabel };
  },
  template: `
    <Sheet :title="t('Retour d’articles') + ' — ' + t('Vente') + ' ' + sale.id" size="wide" @close="$emit('close')">
      <form id="refund-form" class="stack loose" @submit.prevent="submit">
        <p class="small muted">{{ t('Indiquez la quantité rendue par le client pour chaque article. Le montant remboursé tient compte de la remise du ticket.') }}</p>
        <div class="list" style="border:1px solid var(--line)">
          <div v-for="it in sale.items" :key="it.id" class="list-row">
            <div class="main-col"><div class="title">{{ (store.lang === 'ar' && it.name_ar) || it.name }}</div><div class="sub">{{ t('Vendu') }} : {{ qty(it.qty) }} {{ plural(it.unit_label, it.qty) }}<template v-if="it.returned_qty > 0"> · {{ t('déjà retourné') }} : {{ qty(it.returned_qty) }}</template></div></div>
            <button type="button" class="btn sm ghost" :disabled="left(it) <= 0" @click="all(it)">{{ t('Tout') }}</button>
            <input class="input num" style="width:96px" inputmode="decimal" placeholder="0" :disabled="left(it) <= 0" v-model="qtys[it.id]" :aria-label="t('Quantité rendue')" />
          </div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="rf-method">{{ t('Rembourser par') }}</label>
            <select id="rf-method" class="select" v-model="method"><option v-for="m in methods" :key="m" :value="m">{{ m === 'Compte client' ? t('Déduire de la dette du client') : payLabel(m) }}</option></select>
          </div>
          <div class="field"><label for="rf-reason">{{ t('Motif') }}</label><input id="rf-reason" class="input" v-model="reason" required maxlength="300" :placeholder="t('Ex. : article abîmé, erreur de produit')" /></div>
        </div>
        <label class="check"><input type="checkbox" v-model="restock" /><span>{{ t('Remettre les articles en stock') }}<small>{{ t('Décochez si l’article est abîmé et ne peut pas être revendu.') }}</small></span></label>
        <div class="pay-summary" v-if="chosen.length"><div class="sum-row big"><span>{{ t('À rembourser (environ)') }}</span><span>{{ money(estimate) }}</span></div></div>
        <div v-if="invalid" class="alert danger"><Icon name="alert" /><span>{{ t('La quantité rendue dépasse ce qui reste de la vente.') }}</span></div>
      </form>
      <template #foot>
        <button type="button" class="btn" @click="$emit('close')">{{ t('Annuler') }}</button>
        <button type="submit" form="refund-form" class="btn primary" :class="{ loading: busy }" :disabled="busy || !chosen.length || invalid || !reason.trim()">{{ t('Enregistrer le retour') }}</button>
      </template>
    </Sheet>`,
};

export const SaleDetail = {
  components: { Icon, Sheet, Skeleton, RefundDialog },
  props: { id: [Number, String] },
  emits: ['close', 'changed'],
  setup(props, { emit }) {
    const sale = ref(null);
    const busy = ref(false);
    const refunding = ref(false);
    const load = async () => {
      try {
        sale.value = await api.get(`/sales/${props.id}`);
      } catch (e) {
        toastError(e);
        emit('close');
      }
    };
    onMounted(load);
    const cancel = async () => {
      const reason = await ask({
        title: t('Annuler la vente {n} ?', { n: saleNo(sale.value.id) }),
        message: t('Les produits seront remis en stock et la vente ne comptera plus dans la caisse. Cette action reste visible dans l’historique.'),
        input: { label: t('Motif de l’annulation'), placeholder: t('Ex. : erreur de saisie, client a rendu la marchandise'), required: true },
        confirm: t('Annuler la vente'),
        danger: true,
      });
      if (!reason) return;
      busy.value = true;
      try {
        sale.value = await api.post(`/sales/${sale.value.id}/cancel`, { reason });
        toast(t('Vente annulée, stock remis à jour.'), 'success');
        emit('changed');
      } catch (e) {
        toastError(e);
      } finally {
        busy.value = false;
      }
    };
    const markReviewed = async () => {
      try {
        sale.value = await api.post(`/sales/${sale.value.id}/reviewed`);
        toast(t('Vente marquée comme vérifiée.'), 'success');
        emit('changed');
      } catch (e) {
        toastError(e);
      }
    };
    const refunded = (s) => {
      sale.value = s;
      refunding.value = false;
      emit('changed');
    };
    const canRefund = computed(() => sale.value && sale.value.status !== 'cancelled' && sale.value.items.some((it) => it.qty - it.returned_qty > 1e-9));
    const share = () => openWhatsApp(saleText(sale.value), sale.value.customer_phone);
    const sms = () => openSms(saleText(sale.value), sale.value.customer_phone);
    return { store, sale, busy, refunding, canRefund, cancel, markReviewed, refunded, share, sms, printTicket, printInvoice, can, money, qty, plural, dateTimeFr, saleNo, MODE_LABEL, payLabel, reviewText };
  },
  template: `
    <Sheet :title="t('Vente') + ' ' + saleNo(id)" size="wide" @close="$emit('close')">
      <Skeleton v-if="!sale" :rows="4" />
      <div v-else class="stack loose">
        <div class="row wrap">
          <span class="badge" :class="sale.status === 'cancelled' ? 'solid-danger' : sale.mode">{{ sale.status === 'cancelled' ? t('Annulée') : t(MODE_LABEL[sale.mode]) }}</span>
          <span class="badge paid" v-if="sale.status !== 'cancelled' && sale.credit <= 0">{{ t('Payée') }}</span>
          <span class="badge credit" v-if="sale.status !== 'cancelled' && sale.credit > 0">{{ t('Crédit') }} {{ money(sale.credit) }}</span>
          <span class="badge" v-if="sale.offline">{{ t('Faite hors ligne') }}</span>
          <span class="muted small">{{ dateTimeFr(sale.created_at) }} · {{ sale.seller_name ? t('vendu par {s}, encaissé par {u}', { s: sale.seller_name, u: sale.user_name }) : t('vendu par {u}', { u: sale.user_name }) }}<template v-if="sale.order_id"> · {{ t('Commande n° {n}', { n: sale.order_id }) }}</template></span>
        </div>
        <div v-if="sale.needs_review" class="alert danger"><Icon name="alert" />
          <div class="grow">{{ t('Vente faite hors ligne à vérifier : {r}.', { r: reviewText(sale.needs_review) }) }}</div>
          <button v-if="can('sales.cancel')" type="button" class="btn sm" @click="markReviewed"><Icon name="check" size="sm" />{{ t('Marquer comme vérifiée') }}</button>
        </div>
        <div v-if="sale.status === 'cancelled'" class="alert danger"><Icon name="alert" /><span>{{ t('Annulée le {d} par {u}', { d: dateTimeFr(sale.cancelled_at), u: sale.cancelled_by_name }) }} — {{ sale.cancel_reason }}</span></div>
        <div class="kv">
          <div><span>{{ t('Client') }}</span><span>{{ sale.customer_name || t('Client comptoir') }}<template v-if="sale.customer_phone"> · {{ sale.customer_phone }}</template></span></div>
          <div v-if="sale.customer_id"><span>{{ t('Solde actuel du client') }}</span><span :style="sale.customer_balance > 0 ? 'color:var(--credit-ink)' : ''">{{ money(sale.customer_balance) }}</span></div>
        </div>
        <div class="table-wrap" style="border:1px solid var(--line)">
          <table class="table">
            <thead><tr><th>{{ t('Produit') }}</th><th>{{ t('Vente') }}</th><th class="num">{{ t('Quantité') }}</th><th class="num">{{ t('Prix') }}</th><th class="num">{{ t('Total') }}</th><th class="num" v-if="can('cost.view')">{{ t('Marge') }}</th></tr></thead>
            <tbody>
              <tr v-for="it in sale.items" :key="it.id">
                <td class="cell-title">{{ (store.lang === 'ar' && it.name_ar) || it.name }}<div class="cell-sub" v-if="it.returned_qty > 0">{{ t('Retourné') }} : {{ qty(it.returned_qty) }}</div></td>
                <td><span class="badge" :class="it.sale_type">{{ it.sale_type === 'wholesale' ? t('Gros') : t('Détail') }}</span></td>
                <td class="num">{{ qty(it.qty) }} {{ plural(it.unit_label, it.qty) }}</td>
                <td class="num">{{ money(it.unit_price, { bare: true }) }}<div class="cell-sub" v-if="it.unit_price !== it.list_price">{{ t('au lieu de {p}', { p: money(it.list_price, { bare: true }) }) }}</div></td>
                <td class="num">{{ money(it.total, { bare: true }) }}</td>
                <td class="num" v-if="can('cost.view')">{{ money(it.total - it.cost_total, { bare: true }) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="cols">
          <div class="kv">
            <div v-for="(p, i) in sale.payments" :key="i"><span>{{ payLabel(p.method) }}<span v-if="p.reference" class="faint"> · {{ t('réf.') }} {{ p.reference }}</span></span><span>{{ money(p.amount) }}</span></div>
            <div v-if="sale.change_given > 0"><span>{{ t('Monnaie rendue (reçu {r})', { r: money(sale.received) }) }}</span><span>{{ money(sale.change_given) }}</span></div>
            <div v-if="sale.credit > 0"><span>{{ t('Reste à crédit') }}</span><span style="color:var(--credit-ink)">{{ money(sale.credit) }}</span></div>
            <div v-if="!sale.payments.length && sale.credit > 0"><span class="faint">{{ t('Aucun paiement à la vente') }}</span><span></span></div>
          </div>
          <div class="kv">
            <div v-if="sale.discount > 0"><span>{{ t('Sous-total') }}</span><span>{{ money(sale.subtotal) }}</span></div>
            <div v-if="sale.discount > 0"><span>{{ t('Remise') }}</span><span>−{{ money(sale.discount) }}</span></div>
            <div class="total"><span>{{ t('Total') }}</span><span>{{ money(sale.total) }}</span></div>
            <div v-if="sale.tax_total > 0"><span>{{ t('dont TVA') }}</span><span>{{ money(sale.tax_total) }}</span></div>
            <div v-if="sale.refunded_total > 0"><span>{{ t('Retours remboursés') }}</span><span style="color:var(--credit-ink)">−{{ money(sale.refunded_total) }}</span></div>
            <div v-if="can('cost.view')"><span>{{ t('Bénéfice brut') }}</span><span>{{ money(sale.total - sale.cost_total) }}</span></div>
          </div>
        </div>
        <div v-if="sale.refunds && sale.refunds.length">
          <h3 style="margin-bottom:8px">{{ t('Retours') }}</h3>
          <div class="list" style="border:1px solid var(--line)">
            <div v-for="r in sale.refunds" :key="r.id" class="list-row">
              <Icon name="undo" />
              <div class="main-col"><div class="title">{{ money(r.amount) }} · {{ r.method === 'Compte client' ? t('déduit de la dette') : payLabel(r.method) }}</div><div class="sub">{{ dateTimeFr(r.created_at) }} · {{ r.user_name }} · {{ r.reason }}<template v-if="!r.restock"> · {{ t('non remis en stock') }}</template></div></div>
            </div>
          </div>
        </div>
      </div>
      <template #foot v-if="sale">
        <button v-if="can('sales.cancel') && sale.status !== 'cancelled'" type="button" class="btn danger push-start" :class="{ loading: busy }" :disabled="busy" @click="cancel">{{ t('Annuler la vente') }}</button>
        <button v-if="can('sales.cancel') && canRefund" type="button" class="btn" @click="refunding = true"><Icon name="undo" />{{ t('Retour d’articles') }}</button>
        <button type="button" class="btn" @click="share"><Icon name="message" />WhatsApp</button>
        <button type="button" class="btn" @click="sms"><Icon name="phone" />SMS</button>
        <button type="button" class="btn" @click="printInvoice(sale)"><Icon name="file" />{{ t('Facture A4') }}</button>
        <button type="button" class="btn primary" @click="printTicket(sale)"><Icon name="printer" />{{ t('Ticket') }}</button>
      </template>
    </Sheet>
    <RefundDialog v-if="refunding" :sale="sale" @close="refunding = false" @done="refunded" />`,
};

export default {
  components: { Icon, Empty, Skeleton, PeriodPicker, SaleDetail },
  setup() {
    const period = ref({ id: 'today', ...periodRange('today') });
    const userId = ref('');
    const status = ref('');
    const creditOnly = ref(false);
    const reviewOnly = ref(route.query.filtre === 'a-verifier');
    const reviewCount = ref(0);
    const q = ref('');
    const users = ref([]);
    const rows = ref(null);
    const loading = ref(false);
    const load = async () => {
      loading.value = true;
      try {
        rows.value = await api.get(
          '/sales',
          reviewOnly.value
            ? { review: '1' }
            : {
                from: period.value.from,
                to: period.value.to,
                user_id: userId.value,
                status: status.value,
                credit: creditOnly.value ? '1' : '',
                q: q.value.trim(),
              },
        );
        if (can('sales.cancel')) reviewCount.value = (await api.get('/sales/review-count')).count;
      } catch (e) {
        if (e.status === 0) rows.value = rows.value || [];
        toastError(e);
      } finally {
        loading.value = false;
      }
    };
    let timer = null;
    watch([period, userId, status, creditOnly, reviewOnly], load, { deep: true });
    watch(q, () => {
      clearTimeout(timer);
      timer = setTimeout(load, 300);
    });
    let off = null;
    onMounted(() => {
      load();
      off = onChange('sales', load);
      if (can('sales.all')) users.value = store.status?.users || [];
    });
    onUnmounted(() => off?.());

    const summary = computed(() => {
      const ok = (rows.value || []).filter((s) => s.status === 'completed');
      return {
        count: ok.length,
        total: ok.reduce((s, x) => s + x.total, 0),
        refunds: ok.reduce((s, x) => s + (x.refunded_total || 0), 0),
        credit: ok.reduce((s, x) => s + Math.max(0, x.total - x.paid), 0),
        cancelled: (rows.value || []).length - ok.length,
      };
    });
    const openId = computed(() => route.query.vente);
    const open = (id) => setQuery({ vente: id });
    const close = () => setQuery({ vente: undefined });
    return { store, period, userId, status, creditOnly, reviewOnly, reviewCount, q, users, rows, loading, summary, openId, open, close, load, can, money, when, saleNo, MODE_LABEL };
  },
  template: `
    <div class="page">
      <div class="page-head"><h1>{{ can('sales.all') ? t('Ventes') : t('Mes ventes') }}</h1>
        <button v-if="can('sales.cancel') && (reviewCount || reviewOnly)" type="button" class="btn" :class="reviewOnly ? 'primary' : 'danger'" @click="reviewOnly = !reviewOnly"><Icon name="alert" />{{ t('À vérifier') }} ({{ reviewCount }})</button>
      </div>
      <template v-if="!reviewOnly">
        <div class="toolbar">
          <PeriodPicker v-model="period" />
        </div>
        <div class="toolbar">
          <div class="input-affix search"><Icon name="search" /><input class="input" v-model="q" :placeholder="t('N° de vente ou nom du client')" /></div>
          <select v-if="users.length" class="select" style="width:auto" v-model="userId" :aria-label="t('Vendeur')">
            <option value="">{{ t('Tous les vendeurs') }}</option>
            <option v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</option>
          </select>
          <select class="select" style="width:auto" v-model="status" :aria-label="t('État')">
            <option value="">{{ t('Toutes') }}</option><option value="completed">{{ t('Validées') }}</option><option value="cancelled">{{ t('Annulées') }}</option>
          </select>
          <label class="check" style="align-items:center"><input type="checkbox" v-model="creditOnly" />{{ t('À crédit seulement') }}</label>
        </div>
      </template>
      <div v-else class="alert" style="margin-bottom:16px"><Icon name="wifi" /><span>{{ t('Ventes faites hors ligne qui ne respectaient pas une règle (stock, prix, remise, crédit, date). Elles sont enregistrées : vérifiez-les puis marquez-les comme vérifiées, ou annulez-les.') }}</span></div>

      <div class="summary-strip" v-if="rows">
        <span>{{ t('{n} vente(s)', { n: summary.count }) }}</span>
        <span>{{ t('Total') }} <b>{{ money(summary.total) }}</b></span>
        <span v-if="summary.refunds > 0">{{ t('retours') }} <b>−{{ money(summary.refunds) }}</b></span>
        <span v-if="summary.credit > 0">{{ t('dont crédit') }} <b style="color:var(--credit-ink)">{{ money(summary.credit) }}</b></span>
        <span v-if="summary.cancelled">{{ t('{n} annulée(s)', { n: summary.cancelled }) }}</span>
      </div>

      <Skeleton v-if="!rows" />
      <div v-else-if="rows.length" class="list" :style="{ opacity: loading ? 0.6 : 1 }">
        <button v-for="s in rows" :key="s.id" type="button" class="list-row" @click="open(s.id)">
          <div class="main-col">
            <div class="title">{{ s.customer_name || t('Client comptoir') }}</div>
            <div class="sub">{{ saleNo(s.id) }} · {{ when(s.created_at) }} · {{ s.seller_name ? s.seller_name + ' → ' + s.user_name : s.user_name }} · {{ t('{n} article(s)', { n: s.lines }) }}<template v-if="s.methods"> · {{ s.methods }}</template></div>
          </div>
          <div class="end">
            <div class="num strong" :style="s.status === 'cancelled' ? 'text-decoration:line-through;color:var(--ink-3)' : ''">{{ money(s.total) }}</div>
            <div class="row" style="gap:4px;justify-content:flex-end;margin-top:4px">
              <span class="badge" v-if="s.status === 'cancelled'" :class="'off'">{{ t('Annulée') }}</span>
              <template v-else>
                <span class="badge danger" v-if="s.needs_review">{{ t('À vérifier') }}</span>
                <span class="badge" :class="s.mode">{{ t(MODE_LABEL[s.mode]) }}</span>
                <span class="badge credit" v-if="s.total - s.paid > 0.004">{{ t('Crédit') }}</span>
                <span class="badge" v-if="s.refunded_total > 0">{{ t('Retour') }}</span>
              </template>
            </div>
          </div>
        </button>
      </div>
      <Empty v-else icon="receipt" :title="reviewOnly ? t('Aucune vente à vérifier') : t('Aucune vente sur cette période')" :text="reviewOnly ? '' : t('Changez la période ou les filtres pour voir d’autres ventes.')" />

      <SaleDetail v-if="openId" :id="openId" :key="openId" @close="close" @changed="load" />
    </div>`,
};
