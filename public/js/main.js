// Point d'entrée de l'interface : coquille (menu), connexion, pages, hors ligne.
import { createApp, computed, ref, watch, onMounted, onUnmounted } from './vue.js';
import { store, can, loadStatus, loadMe, loadProducts, connectEvents, logout, toastError, startSync, syncQueue, onChange } from './store.js';
import { api, readQueue, readRejected, retryRejected, dropRejected } from './api.js';
import { route, go } from './router.js';
import { initials, money, dateTimeFr } from './format.js';
import { t, LANGS, setLang, applyLang, initLang } from './i18n.js';
import { Icon, Sheet, Toasts, DialogHost } from './components/ui.js';
import { EndDaySheet } from './components/till.js';
import Login from './pages/Login.js';
import Pos from './pages/Pos.js';
import CashDesk from './pages/CashDesk.js';
import Dashboard from './pages/Dashboard.js';
import Sales from './pages/Sales.js';
import Products from './pages/Products.js';
import Stock from './pages/Stock.js';
import Customers from './pages/Customers.js';
import Expenses from './pages/Expenses.js';
import Reports from './pages/Reports.js';
import Settings from './pages/Settings.js';

const ROLE = { admin: 'Administrateur', manager: 'Gestionnaire', cashier: 'Caissier', seller: 'Vendeur' };

// Caissier : il encaisse sans vendre (ni « sales.create » ni « orders.send »).
const isDesk = () => can('orders.cash') && !can('sales.create') && !can('orders.send');

// Caisse : le caissier voit seulement la liste des ventes envoyées par les vendeurs ;
// le vendeur, le gérant et l'administrateur ont la caisse complète.
const Till = {
  components: { Pos, CashDesk },
  setup: () => ({ desk: computed(isDesk) }),
  template: `<CashDesk v-if="desk" /><Pos v-else />`,
};

// Pages et droits nécessaires. Le vendeur ne voit que la caisse (sans le droit « menu.full ») ;
// le caissier a en plus sa page « desk » : ses dépenses (sa journée se termine en bas des ventes à encaisser).
const PAGES = [
  { path: '/tableau-de-bord', label: 'Tableau de bord', short: 'Accueil', icon: 'home', perm: 'dashboard', comp: Dashboard },
  { path: '/caisse', label: 'Caisse', short: 'Caisse', icon: 'cart', perm: ['pos', 'orders.send'], comp: Till, bare: true },
  { path: '/ventes', label: 'Ventes', short: 'Ventes', icon: 'receipt', perm: 'pos', comp: Sales },
  { path: '/produits', label: 'Produits', short: 'Produits', icon: 'box', perm: null, comp: Products },
  { path: '/stock', label: 'Stock & réceptions', short: 'Stock', icon: 'truck', perm: 'stock.manage', comp: Stock },
  { path: '/clients', label: 'Clients & crédits', short: 'Clients', icon: 'users', perm: 'customers.manage', comp: Customers },
  { path: '/depenses', label: 'Dépenses', short: 'Dépenses', icon: 'wallet', perm: 'expenses.add', comp: Expenses },
  { path: '/rapports', label: 'Rapports', short: 'Rapports', icon: 'chart', perm: 'reports.view', comp: Reports },
  { path: '/parametres', label: 'Paramètres', short: 'Réglages', icon: 'sliders', perm: null, comp: Settings },
  { path: '/mes-depenses', label: 'Dépenses', short: 'Dépenses', icon: 'wallet', perm: 'expenses.add', comp: Expenses, desk: true },
];

// Ventes hors ligne refusées par le serveur : elles restent sur l'appareil jusqu'à décision
const RejectedSales = {
  components: { Sheet, Icon },
  setup() {
    const refresh = () => {
      store.rejected = readRejected();
      store.pending = readQueue().length;
    };
    const total = (r) => (r.payload.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const when = (r) => dateTimeFr(new Date(r.at - new Date().getTimezoneOffset() * 60000).toISOString().replace('T', ' '));
    const drop = (r) => {
      if (!window.confirm(t('Supprimer définitivement cette vente de l’appareil ?'))) return;
      dropRejected(r.payload.client_id);
      refresh();
    };
    const retry = () => {
      retryRejected();
      refresh();
      store.showRejected = false;
      syncQueue().catch(() => {});
    };
    return { store, total, when, drop, retry, money };
  },
  template: `
    <Sheet :title="t('Ventes hors ligne à traiter')" size="narrow" @close="store.showRejected = false">
      <p class="small muted" style="margin-bottom:12px">{{ t('Ces ventes faites sans réseau ont été refusées par le serveur. Elles restent sur cet appareil : réessayez, ou supprimez-les.') }}</p>
      <div class="list" v-if="store.rejected.length">
        <div v-for="r in store.rejected" :key="r.payload.client_id" class="list-row">
          <div class="main-col"><div class="title">{{ when(r) }} · {{ money(total(r)) }}</div><div class="sub" style="white-space:normal;color:var(--credit-ink)">{{ r.error }}</div></div>
          <button type="button" class="icon-btn sm" @click="drop(r)" :aria-label="t('Supprimer')"><Icon name="trash" size="sm" /></button>
        </div>
      </div>
      <p v-else class="small muted">{{ t('Rien à traiter.') }}</p>
      <template #foot><button type="button" class="btn" @click="store.showRejected = false">{{ t('Fermer') }}</button><button v-if="store.rejected.length" type="button" class="btn primary" @click="retry">{{ t('Réessayer') }}</button></template>
    </Sheet>`,
};

const App = {
  components: { Icon, Sheet, Toasts, DialogHost, Login, RejectedSales, EndDaySheet },
  setup() {
    const menuOpen = ref(false);
    const desk = computed(isDesk);
    const pages = computed(() =>
      PAGES.filter((p) => (!p.perm || [].concat(p.perm).some(can)) && (p.desk ? desk.value : p.path === '/caisse' || can('menu.full'))),
    );
    const current = computed(() => pages.value.find((p) => route.path === p.path || route.path.startsWith(`${p.path}/`)));
    const homePath = computed(() => (can('dashboard') ? '/tableau-de-bord' : '/caisse'));
    const tabs = computed(() => {
      const order = desk.value
        ? ['/caisse', '/mes-depenses']
        : can('dashboard')
          ? ['/caisse', '/ventes', '/produits', '/clients']
          : ['/caisse', '/ventes', '/clients', '/produits'];
      return order.map((p) => pages.value.find((x) => x.path === p)).filter(Boolean).slice(0, 4);
    });
    const account = () => !can('settings.manage');
    // Libellés propres à certains rôles : « Mon compte » sans les réglages, « Ventes à encaisser » pour le caissier
    const navLabel = (p) =>
      p.path === '/parametres' && account() ? t('Mon compte') : p.path === '/caisse' && desk.value ? t('Ventes à encaisser') : t(p.label);
    const navShort = (p) =>
      p.path === '/parametres' && account() ? t('Compte') : p.path === '/caisse' && desk.value ? t('À encaisser') : t(p.short);
    const pageTitle = computed(() => (current.value ? navLabel(current.value) : ''));
    const nextLang = computed(() => LANGS[(LANGS.findIndex((l) => l.id === store.lang) + 1) % LANGS.length]);

    // Caissier : « Total caisse » (ventes − dépenses depuis la dernière fin de journée) dans le menu,
    // et « Terminer la journée » en bas du menu. Mis à jour à chaque encaissement et à chaque dépense.
    const day = ref(null);
    const ending = ref(false);
    const loadDay = async () => {
      if (!store.me || !desk.value || !can('cash.own')) {
        day.value = null;
        return;
      }
      try {
        day.value = await api.get('/cash/current');
      } catch {
        /* hors ligne : on garde le dernier total connu */
      }
    };
    watch(() => [store.me?.id, desk.value], loadDay, { immediate: true });
    const dayOffs = [];
    onMounted(() => dayOffs.push(onChange('cash', loadDay), onChange('sales', loadDay), onChange('expenses', loadDay)));
    onUnmounted(() => dayOffs.forEach((off) => off()));
    const endDay = async () => {
      await loadDay();
      if (day.value) ending.value = true;
    };

    // Redirection vers une page autorisée
    watch(
      () => [route.path, store.me, pages.value.length],
      () => {
        if (store.me && !current.value) go(homePath.value);
      },
      { immediate: true },
    );
    watch(
      () => route.path,
      () => {
        menuOpen.value = false;
        window.scrollTo(0, 0);
      },
    );
    // Langue de l'employé connecté (choisie dans « Mon compte »)
    watch(
      () => store.me?.lang,
      (l) => {
        if (l) applyLang(l);
      },
    );

    const start = async () => {
      try {
        await loadStatus().catch((e) => {
          if (e.status !== 0) throw e;
        });
        // Hors ligne, on tente quand même la session gardée en cache sur l'appareil
        const tryMe = !store.status || store.status.offline || store.status.loggedIn;
        if (tryMe && (await loadMe())) {
          connectEvents();
          startSync();
          await loadProducts();
        }
      } catch (e) {
        toastError(e);
      } finally {
        store.booted = true;
      }
    };
    onMounted(start);

    const onLogged = async () => {
      await start();
      if (!current.value) go(homePath.value);
    };
    const signOut = async () => {
      menuOpen.value = false;
      await logout();
    };

    return { store, route, pages, current, tabs, menuOpen, pageTitle, navLabel, navShort, nextLang, onLogged, signOut, setLang, initials, ROLE, can, day, ending, loadDay, endDay, money };
  },
  template: `
    <div v-if="!store.booted" class="boot">{{ t('Chargement…') }}</div>
    <Login v-else-if="!store.me" @logged="onLogged" />
    <div v-else class="shell" :class="{ solo: pages.length === 1 }">
      <aside class="rail" :aria-label="t('Menu principal')">
        <div class="rail-brand"><img class="rail-logo" src="/icons/icon.svg" :alt="store.settings.store_name" /><strong>{{ store.settings.store_name }}</strong><span v-if="store.settings.demo_data" class="demo-tag">{{ t('Données de démonstration') }}</span><span v-else>{{ t('Caisse gros & détail') }}</span></div>
        <div v-if="day" class="rail-total" :title="t('Total caisse') + ' : ' + money(day.breakdown.till_total)">
          <small>{{ t('Total caisse') }}</small>
          <strong class="num">{{ money(day.breakdown.till_total, { bare: true }) }}<span class="cur">{{ store.settings.currency }}</span></strong>
        </div>
        <nav class="nav">
          <a v-for="p in pages" :key="p.path" :href="'#' + p.path" :class="{ active: current && current.path === p.path }" :aria-current="current && current.path === p.path ? 'page' : null">
            <Icon :name="p.icon" /><span class="lbl">{{ navLabel(p) }}</span><span class="lbl-short">{{ navShort(p) }}</span>
          </a>
        </nav>
        <div class="rail-foot">
          <button v-if="day" type="button" class="btn-end-day" @click="endDay" :title="t('Terminer la journée')"><Icon name="lock" /><span class="lbl">{{ t('Terminer la journée') }}</span><span class="lbl-short">{{ t('Terminer') }}</span></button>
          <button v-if="store.pending || store.rejected.length" type="button" class="sync-pill" :class="{ bad: store.rejected.length }" @click="store.rejected.length ? (store.showRejected = true) : null">
            <Icon :name="store.rejected.length ? 'alert' : 'clock'" size="sm" />
            <span v-if="store.rejected.length">{{ t('{n} vente(s) à traiter', { n: store.rejected.length }) }}</span>
            <span v-else>{{ t('{n} vente(s) en attente d’envoi', { n: store.pending }) }}</span>
          </button>
          <div class="conn" :class="{ off: !store.online }"><i></i><span>{{ store.online ? t('Connecté au serveur') : t('Hors ligne') }}</span></div>
          <div class="rail-user">
            <span class="avatar">{{ initials(store.me.name) }}</span>
            <div class="who ellipsis"><strong class="ellipsis">{{ store.me.name }}</strong><span>{{ t(ROLE[store.me.role]) }}</span></div>
          </div>
          <button type="button" class="btn-rail" @click="setLang(nextLang.id)" :title="t('Langue')"><Icon name="globe" /><span>{{ nextLang.label }}</span></button>
          <button type="button" class="btn-rail" @click="signOut"><Icon name="swap" /><span>{{ t('Changer d’utilisateur') }}</span></button>
        </div>
      </aside>

      <div class="main">
        <header class="topbar">
          <h1>{{ pageTitle }}</h1>
          <span v-if="store.settings.demo_data" class="demo-tag" style="margin-top:0">{{ t('Démo') }}</span>
          <button v-if="store.pending || store.rejected.length" type="button" class="sync-pill" :class="{ bad: store.rejected.length }" @click="store.rejected.length ? (store.showRejected = true) : null">
            <Icon :name="store.rejected.length ? 'alert' : 'clock'" size="sm" />{{ store.rejected.length || store.pending }}
          </button>
          <span class="conn" :class="{ off: !store.online }" v-if="!store.online"><i></i></span>
          <button type="button" class="icon-btn lang-btn" @click="setLang(nextLang.id)" :aria-label="t('Langue')">{{ nextLang.short }}</button>
          <button type="button" class="icon-btn" @click="signOut" :aria-label="t('Changer d’utilisateur')"><Icon name="swap" /></button>
        </header>
        <div v-if="!store.online" class="offline-banner" role="status"><Icon name="wifi" size="sm" />{{ store.pending ? t('Hors ligne : les ventes sont gardées sur cet appareil ({n} en attente) et partiront au retour du réseau.', { n: store.pending }) : t('Hors ligne : vous pouvez continuer à vendre. Les ventes partiront au retour du réseau.') }}</div>
        <div v-if="day" class="phone-till">
          <span class="grow">{{ t('Total caisse') }} <b class="num">{{ money(day.breakdown.till_total) }}</b></span>
          <button type="button" class="btn sm danger" @click="endDay"><Icon name="lock" size="sm" />{{ t('Terminer la journée') }}</button>
        </div>
        <component v-if="current" :is="current.comp" :key="current.path" />
      </div>

      <nav class="tabbar" :aria-label="t('Navigation')">
        <a v-for="tb in tabs" :key="tb.path" :href="'#' + tb.path" :class="{ on: current && current.path === tb.path }">
          <Icon :name="tb.icon" /><span>{{ navShort(tb) }}</span>
        </a>
        <button type="button" :class="{ on: current && !tabs.includes(current) }" @click="menuOpen = true"><Icon name="menu" /><span>{{ t('Plus') }}</span></button>
      </nav>

      <Sheet v-if="menuOpen" :title="t('Menu')" @close="menuOpen = false">
        <div class="list">
          <a v-for="p in pages" :key="p.path" :href="'#' + p.path" class="list-row click" style="text-decoration:none;color:inherit">
            <Icon :name="p.icon" /><div class="main-col"><div class="title">{{ navLabel(p) }}</div></div><Icon name="chevronRight" size="sm" class="flip-rtl" />
          </a>
        </div>
        <div class="row" style="margin-top:16px">
          <span class="avatar">{{ initials(store.me.name) }}</span>
          <div class="grow"><strong>{{ store.me.name }}</strong><div class="xsmall faint">{{ t(ROLE[store.me.role]) }}</div></div>
          <button type="button" class="btn" @click="signOut"><Icon name="swap" />{{ t('Changer d’utilisateur') }}</button>
        </div>
      </Sheet>
      <RejectedSales v-if="store.showRejected" />
      <EndDaySheet v-if="ending && day" :day="day" @close="ending = false" @ended="loadDay" />
    </div>
    <Toasts />
    <DialogHost />`,
};

initLang();
const app = createApp(App);
app.config.globalProperties.t = t;
app.mount('#app');

// Service worker : l'application s'ouvre même sans réseau (exige HTTPS sur les téléphones)
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
