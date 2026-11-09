// Tableau de bord du gérant : la journée en cours, les 14 derniers jours, les alertes.
import { ref, computed, onMounted, onUnmounted } from '../vue.js';
import { api } from '../api.js';
import { store, can, onChange, toastError } from '../store.js';
import { money, today, dayLong, dayShort, when, saleNo, stockText, MODE_LABEL } from '../format.js';
import { go } from '../router.js';
import { Icon, Skeleton, Empty } from '../components/ui.js';
import { BarChart, SplitBar } from '../components/charts.js';

export default {
  components: { Icon, Skeleton, Empty, BarChart, SplitBar },
  setup() {
    const d = ref(null);
    const loading = ref(false);
    const showTable = ref(false);
    const load = async () => {
      loading.value = true;
      try {
        d.value = await api.get('/reports/dashboard');
      } catch (e) {
        toastError(e);
      } finally {
        loading.value = false;
      }
    };
    let timer = null;
    const offs = [];
    onMounted(() => {
      load();
      for (const t of ['sales', 'products', 'customers', 'expenses']) {
        offs.push(
          onChange(t, () => {
            clearTimeout(timer);
            timer = setTimeout(load, 600);
          }),
        );
      }
    });
    onUnmounted(() => {
      offs.forEach((off) => off());
      clearTimeout(timer);
    });

    const collected = computed(() => (d.value?.collected || []).reduce((s, x) => s + x.amount, 0));
    const split = computed(() => {
      const by = Object.fromEntries((d.value?.byType || []).map((x) => [x.sale_type, x.amount]));
      return { retail: by.retail || 0, wholesale: by.wholesale || 0 };
    });
    const vsYesterday = computed(() => {
      if (!d.value) return '';
      const y = d.value.yesterday.revenue;
      return `Hier : ${money(y)} (${d.value.yesterday.count} ventes)`;
    });
    const openSale = (id) => go('/ventes', { vente: id });
    return { store, d, loading, showTable, collected, split, vsYesterday, load, openSale, can, go, money, today, dayLong, dayShort, when, saleNo, stockText, MODE_LABEL };
  },
  template: `
    <div class="page">
      <div class="page-head">
        <h1>Tableau de bord</h1>
        <span class="muted small">{{ dayLong(today()) }}</span>
        <button type="button" class="btn" @click="load" :class="{ loading }"><Icon name="refresh" />Actualiser</button>
      </div>

      <div v-if="store.settings.demo_data" class="alert" style="margin-bottom:16px">
        <Icon name="alert" />
        <div class="grow">
          <b>Données de démonstration.</b> Les produits, clients et ventes affichés sont fictifs : essayez librement.
          <template v-if="can('backup')"> Quand vous êtes prêt, effacez-les dans <a href="#/parametres?onglet=sauvegardes">Paramètres › Sauvegardes</a>.</template>
        </div>
      </div>
      <Skeleton v-if="!d" :rows="6" />
      <template v-else>
        <section class="day" :style="{ opacity: loading ? 0.6 : 1 }">
          <div class="day-main">
            <small>Recette du jour</small>
            <strong>{{ money(d.today.revenue) }}</strong>
            <div class="vs">{{ d.today.count }} vente{{ d.today.count > 1 ? 's' : '' }} · panier moyen {{ money(d.today.average) }}</div>
            <div class="vs">{{ vsYesterday }}</div>
          </div>
          <div class="figures">
            <div class="figure ok" v-if="d.today.margin !== null"><small>Bénéfice brut</small><strong>{{ money(d.today.margin) }}</strong><div class="sub">ventes moins prix d'achat</div></div>
            <div class="figure"><small>Encaissé aujourd'hui</small><strong>{{ money(collected) }}</strong>
              <div class="sub">{{ d.collected.map(c => c.method + ' ' + money(c.amount, { bare: true })).join(' · ') || 'Aucun encaissement' }}</div></div>
            <div class="figure" :class="{ danger: d.today.credit > 0 }"><small>Vendu à crédit</small><strong>{{ money(d.today.credit) }}</strong><div class="sub">à récupérer auprès des clients</div></div>
            <div class="figure"><small>Dépenses du jour</small><strong>{{ money(d.today.expenses) }}</strong><div class="sub"><a href="#/depenses">Voir les dépenses</a></div></div>
          </div>
          <div class="split">
            <div class="row between"><span class="label">Gros et détail aujourd'hui</span></div>
            <SplitBar v-if="split.retail + split.wholesale > 0" :retail="split.retail" :wholesale="split.wholesale" />
            <p v-else class="small faint">Aucune vente pour l'instant aujourd'hui.</p>
          </div>
        </section>

        <div class="cols">
          <section class="panel">
            <div class="panel-head">
              <h2>Recette des 14 derniers jours</h2>
              <button type="button" class="btn sm ghost" @click="showTable = !showTable">{{ showTable ? 'Graphique' : 'Tableau' }}</button>
            </div>
            <BarChart v-if="!showTable" :data="d.series" label="Recette des 14 derniers jours" />
            <div v-else class="table-wrap">
              <table class="table compact-table">
                <thead><tr><th>Jour</th><th class="num">Ventes</th><th class="num">Recette</th><th class="num" v-if="d.series[0] && d.series[0].margin !== null">Bénéfice brut</th></tr></thead>
                <tbody>
                  <tr v-for="s in d.series.slice().reverse()" :key="s.day"><td>{{ dayShort(s.day) }}</td><td class="num">{{ s.count }}</td><td class="num">{{ money(s.revenue) }}</td><td class="num" v-if="s.margin !== null">{{ money(s.margin) }}</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h2>À réapprovisionner</h2>
              <span class="badge danger" v-if="d.lowCount">{{ d.lowCount }} produit{{ d.lowCount > 1 ? 's' : '' }}</span>
            </div>
            <div v-if="d.low.length" class="list">
              <a v-for="p in d.low" :key="p.id" class="list-row click" :href="'#/produits?produit=' + p.id" style="color:inherit;text-decoration:none">
                <div class="main-col"><div class="title">{{ p.name }}</div><div class="sub">Seuil d'alerte : {{ stockText(p, p.min_stock) }}</div></div>
                <span class="badge" :class="p.stock <= 0 ? 'solid-danger' : 'danger'">{{ p.stock <= 0 ? 'Rupture' : stockText(p) }}</span>
              </a>
            </div>
            <Empty v-else icon="check" title="Stock suffisant" text="Aucun produit sous son seuil d'alerte." />
            <div class="row" style="margin-top:12px" v-if="d.lowCount > d.low.length">
              <a href="#/produits?filtre=bas" class="small">Voir les {{ d.lowCount }} produits</a>
            </div>
          </section>
        </div>

        <div class="cols" style="margin-top:16px">
          <section class="panel">
            <div class="panel-head"><h2>Dernières ventes</h2><a href="#/ventes" class="small">Toutes les ventes</a></div>
            <div v-if="d.recent.length" class="list">
              <button v-for="s in d.recent" :key="s.id" type="button" class="list-row" @click="openSale(s.id)">
                <div class="main-col">
                  <div class="title">{{ s.customer_name || 'Client comptoir' }}</div>
                  <div class="sub">{{ saleNo(s.id) }} · {{ when(s.created_at) }} · {{ s.user_name }}</div>
                </div>
                <div class="end">
                  <div class="num strong" :style="s.status === 'cancelled' ? 'text-decoration:line-through;color:var(--ink-3)' : ''">{{ money(s.total) }}</div>
                  <span class="badge" :class="s.status === 'cancelled' ? 'off' : s.mode">{{ s.status === 'cancelled' ? 'Annulée' : MODE_LABEL[s.mode] }}</span>
                </div>
              </button>
            </div>
            <Empty v-else icon="receipt" title="Aucune vente" text="Les ventes apparaîtront ici dès qu'elles sont encaissées." />
          </section>

          <section class="panel">
            <div class="panel-head"><h2>Meilleures ventes · 7 jours</h2></div>
            <table class="table compact-table" v-if="d.top.length">
              <thead><tr><th>Produit</th><th class="num">Quantité</th><th class="num">Recette</th></tr></thead>
              <tbody>
                <tr v-for="t in d.top" :key="t.product_id"><td class="cell-title">{{ t.name }}</td><td class="num">{{ t.unit ? stockText(t, t.qty) : t.qty }}</td><td class="num">{{ money(t.revenue) }}</td></tr>
              </tbody>
            </table>
            <Empty v-else icon="chart" title="Pas encore de données" />
            <div class="kv" style="margin-top:16px">
              <div><span>Les clients vous doivent <span class="faint">({{ d.receivables.customers }} client{{ d.receivables.customers > 1 ? 's' : '' }})</span></span><span><a href="#/clients?filtre=dette">{{ money(d.receivables.total) }}</a></span></div>
              <div v-if="d.stockValue !== null"><span>Valeur du stock (prix d'achat)</span><span>{{ money(d.stockValue) }}</span></div>
            </div>
          </section>
        </div>
      </template>
    </div>`,
};
