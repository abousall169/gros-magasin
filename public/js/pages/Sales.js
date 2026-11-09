// Historique des ventes, détail, réimpression, annulation.
import { ref, computed, watch, onMounted, onUnmounted } from '../vue.js';
import { api } from '../api.js';
import { store, can, onChange, toast, toastError, ask } from '../store.js';
import { money, qty, plural, when, dateTimeFr, saleNo, MODE_LABEL } from '../format.js';
import { route, setQuery } from '../router.js';
import { Icon, Sheet, Empty, Skeleton, PeriodPicker, periodRange } from '../components/ui.js';
import { printTicket, printInvoice, saleText, openWhatsApp } from '../print.js';

export const SaleDetail = {
  components: { Icon, Sheet, Skeleton },
  props: { id: [Number, String] },
  emits: ['close', 'changed'],
  setup(props, { emit }) {
    const sale = ref(null);
    const busy = ref(false);
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
        title: `Annuler la vente ${saleNo(sale.value.id)} ?`,
        message: 'Les produits seront remis en stock et la vente ne comptera plus dans la caisse. Cette action reste visible dans l’historique.',
        input: { label: "Motif de l'annulation", placeholder: 'Ex. : erreur de saisie, client a rendu la marchandise', required: true },
        confirm: 'Annuler la vente',
        danger: true,
      });
      if (!reason) return;
      busy.value = true;
      try {
        sale.value = await api.post(`/sales/${sale.value.id}/cancel`, { reason });
        toast('Vente annulée, stock remis à jour.', 'success');
        emit('changed');
      } catch (e) {
        toastError(e);
      } finally {
        busy.value = false;
      }
    };
    const share = () => openWhatsApp(saleText(sale.value), sale.value.customer_phone);
    return { sale, busy, cancel, share, printTicket, printInvoice, can, money, qty, plural, dateTimeFr, saleNo, MODE_LABEL };
  },
  template: `
    <Sheet :title="'Vente ' + saleNo(id)" size="wide" @close="$emit('close')">
      <Skeleton v-if="!sale" :rows="4" />
      <div v-else class="stack loose">
        <div class="row wrap">
          <span class="badge" :class="sale.status === 'cancelled' ? 'solid-danger' : sale.mode">{{ sale.status === 'cancelled' ? 'Annulée' : MODE_LABEL[sale.mode] }}</span>
          <span class="badge paid" v-if="sale.status !== 'cancelled' && sale.credit <= 0">Payée</span>
          <span class="badge credit" v-if="sale.status !== 'cancelled' && sale.credit > 0">Crédit {{ money(sale.credit) }}</span>
          <span class="muted small">{{ dateTimeFr(sale.created_at) }} · vendu par {{ sale.user_name }}</span>
        </div>
        <div v-if="sale.status === 'cancelled'" class="alert danger"><Icon name="alert" /><span>Annulée le {{ dateTimeFr(sale.cancelled_at) }} par {{ sale.cancelled_by_name }} — {{ sale.cancel_reason }}</span></div>
        <div class="kv">
          <div><span>Client</span><span>{{ sale.customer_name || 'Client comptoir' }}<template v-if="sale.customer_phone"> · {{ sale.customer_phone }}</template></span></div>
          <div v-if="sale.customer_id"><span>Solde actuel du client</span><span :style="sale.customer_balance > 0 ? 'color:var(--credit-ink)' : ''">{{ money(sale.customer_balance) }}</span></div>
        </div>
        <div class="table-wrap" style="border:1px solid var(--line)">
          <table class="table">
            <thead><tr><th>Produit</th><th>Vente</th><th class="num">Quantité</th><th class="num">Prix</th><th class="num">Total</th><th class="num" v-if="can('cost.view')">Marge</th></tr></thead>
            <tbody>
              <tr v-for="it in sale.items" :key="it.id">
                <td class="cell-title">{{ it.name }}</td>
                <td><span class="badge" :class="it.sale_type">{{ it.sale_type === 'wholesale' ? 'Gros' : 'Détail' }}</span></td>
                <td class="num">{{ qty(it.qty) }} {{ plural(it.unit_label, it.qty) }}</td>
                <td class="num">{{ money(it.unit_price, { bare: true }) }}<div class="cell-sub" v-if="it.unit_price !== it.list_price">au lieu de {{ money(it.list_price, { bare: true }) }}</div></td>
                <td class="num">{{ money(it.total, { bare: true }) }}</td>
                <td class="num" v-if="can('cost.view')">{{ money(it.total - it.cost_total, { bare: true }) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="cols">
          <div class="kv">
            <div v-for="p in sale.payments" :key="p.method"><span>{{ p.method }}</span><span>{{ money(p.amount) }}</span></div>
            <div v-if="sale.change_given > 0"><span>Monnaie rendue (reçu {{ money(sale.received) }})</span><span>{{ money(sale.change_given) }}</span></div>
            <div v-if="sale.credit > 0"><span>Reste à crédit</span><span style="color:var(--credit-ink)">{{ money(sale.credit) }}</span></div>
            <div v-if="!sale.payments.length && sale.credit > 0"><span class="faint">Aucun paiement à la vente</span><span></span></div>
          </div>
          <div class="kv">
            <div v-if="sale.discount > 0"><span>Sous-total</span><span>{{ money(sale.subtotal) }}</span></div>
            <div v-if="sale.discount > 0"><span>Remise</span><span>−{{ money(sale.discount) }}</span></div>
            <div class="total"><span>Total</span><span>{{ money(sale.total) }}</span></div>
            <div v-if="can('cost.view')"><span>Bénéfice brut</span><span>{{ money(sale.total - sale.cost_total) }}</span></div>
          </div>
        </div>
      </div>
      <template #foot v-if="sale">
        <button v-if="can('sales.cancel') && sale.status !== 'cancelled'" type="button" class="btn danger" :class="{ loading: busy }" :disabled="busy" @click="cancel" style="margin-right:auto">Annuler la vente</button>
        <button type="button" class="btn" @click="share"><Icon name="message" />WhatsApp</button>
        <button type="button" class="btn" @click="printInvoice(sale)"><Icon name="file" />Facture A4</button>
        <button type="button" class="btn primary" @click="printTicket(sale)"><Icon name="printer" />Ticket</button>
      </template>
    </Sheet>`,
};

export default {
  components: { Icon, Empty, Skeleton, PeriodPicker, SaleDetail },
  setup() {
    const period = ref({ id: 'today', ...periodRange('today') });
    const userId = ref('');
    const status = ref('');
    const creditOnly = ref(false);
    const q = ref('');
    const users = ref([]);
    const rows = ref(null);
    const loading = ref(false);
    const load = async () => {
      loading.value = true;
      try {
        rows.value = await api.get('/sales', {
          from: period.value.from,
          to: period.value.to,
          user_id: userId.value,
          status: status.value,
          credit: creditOnly.value ? '1' : '',
          q: q.value.trim(),
        });
      } catch (e) {
        toastError(e);
      } finally {
        loading.value = false;
      }
    };
    let t = null;
    watch([period, userId, status, creditOnly], load, { deep: true });
    watch(q, () => {
      clearTimeout(t);
      t = setTimeout(load, 300);
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
        credit: ok.reduce((s, x) => s + Math.max(0, x.total - x.paid), 0),
        cancelled: (rows.value || []).length - ok.length,
      };
    });
    const openId = computed(() => route.query.vente);
    const open = (id) => setQuery({ vente: id });
    const close = () => setQuery({ vente: undefined });
    return { store, period, userId, status, creditOnly, q, users, rows, loading, summary, openId, open, close, load, can, money, when, saleNo, MODE_LABEL };
  },
  template: `
    <div class="page">
      <div class="page-head"><h1>{{ can('sales.all') ? 'Ventes' : 'Mes ventes' }}</h1></div>
      <div class="toolbar">
        <PeriodPicker v-model="period" />
      </div>
      <div class="toolbar">
        <div class="input-affix search"><Icon name="search" /><input class="input" v-model="q" placeholder="N° de vente ou nom du client" /></div>
        <select v-if="users.length" class="select" style="width:auto" v-model="userId" aria-label="Vendeur">
          <option value="">Tous les vendeurs</option>
          <option v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</option>
        </select>
        <select class="select" style="width:auto" v-model="status" aria-label="État">
          <option value="">Toutes</option><option value="completed">Validées</option><option value="cancelled">Annulées</option>
        </select>
        <label class="check" style="align-items:center"><input type="checkbox" v-model="creditOnly" />À crédit seulement</label>
      </div>

      <div class="summary-strip" v-if="rows">
        <span><b>{{ summary.count }}</b> vente{{ summary.count > 1 ? 's' : '' }}</span>
        <span>Total <b>{{ money(summary.total) }}</b></span>
        <span v-if="summary.credit > 0">dont crédit <b style="color:var(--credit-ink)">{{ money(summary.credit) }}</b></span>
        <span v-if="summary.cancelled">{{ summary.cancelled }} annulée{{ summary.cancelled > 1 ? 's' : '' }}</span>
      </div>

      <Skeleton v-if="!rows" />
      <div v-else-if="rows.length" class="list" :style="{ opacity: loading ? 0.6 : 1 }">
        <button v-for="s in rows" :key="s.id" type="button" class="list-row" @click="open(s.id)">
          <div class="main-col">
            <div class="title">{{ s.customer_name || 'Client comptoir' }}</div>
            <div class="sub">{{ saleNo(s.id) }} · {{ when(s.created_at) }} · {{ s.user_name }} · {{ s.lines }} article{{ s.lines > 1 ? 's' : '' }}<template v-if="s.methods"> · {{ s.methods }}</template></div>
          </div>
          <div class="end">
            <div class="num strong" :style="s.status === 'cancelled' ? 'text-decoration:line-through;color:var(--ink-3)' : ''">{{ money(s.total) }}</div>
            <div class="row" style="gap:4px;justify-content:flex-end;margin-top:4px">
              <span class="badge" v-if="s.status === 'cancelled'" :class="'off'">Annulée</span>
              <template v-else>
                <span class="badge" :class="s.mode">{{ MODE_LABEL[s.mode] }}</span>
                <span class="badge credit" v-if="s.total - s.paid > 0.004">Crédit</span>
              </template>
            </div>
          </div>
        </button>
      </div>
      <Empty v-else icon="receipt" title="Aucune vente sur cette période" text="Changez la période ou les filtres pour voir d'autres ventes." />

      <SaleDetail v-if="openId" :id="openId" :key="openId" @close="close" @changed="load" />
    </div>`,
};
