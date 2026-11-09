// Point d'entrée de l'interface : coquille (menu), connexion, pages.
import { createApp, computed, ref, watch, onMounted } from './vue.js';
import { store, can, loadStatus, loadMe, loadProducts, connectEvents, logout, toastError } from './store.js';
import { route, go } from './router.js';
import { initials } from './format.js';
import { Icon, Sheet, Toasts, DialogHost } from './components/ui.js';
import Login from './pages/Login.js';
import Pos from './pages/Pos.js';
import Dashboard from './pages/Dashboard.js';
import Sales from './pages/Sales.js';
import Products from './pages/Products.js';
import Stock from './pages/Stock.js';
import Customers from './pages/Customers.js';
import Expenses from './pages/Expenses.js';
import Reports from './pages/Reports.js';
import Settings from './pages/Settings.js';

const ROLE = { admin: 'Administrateur', manager: 'Gestionnaire', cashier: 'Vendeur' };

// Pages et droits nécessaires
const PAGES = [
  { path: '/tableau-de-bord', label: 'Tableau de bord', short: 'Accueil', icon: 'home', perm: 'dashboard', comp: Dashboard },
  { path: '/caisse', label: 'Caisse', short: 'Caisse', icon: 'cart', perm: 'pos', comp: Pos, bare: true },
  { path: '/ventes', label: 'Ventes', short: 'Ventes', icon: 'receipt', perm: 'pos', comp: Sales },
  { path: '/produits', label: 'Produits', short: 'Produits', icon: 'box', perm: null, comp: Products },
  { path: '/stock', label: 'Stock & réceptions', short: 'Stock', icon: 'truck', perm: 'stock.manage', comp: Stock },
  { path: '/clients', label: 'Clients & crédits', short: 'Clients', icon: 'users', perm: 'customers.manage', comp: Customers },
  { path: '/depenses', label: 'Dépenses', short: 'Dépenses', icon: 'wallet', perm: 'expenses.add', comp: Expenses },
  { path: '/rapports', label: 'Rapports', short: 'Rapports', icon: 'chart', perm: 'reports.view', comp: Reports },
  { path: '/caisse-du-jour', label: 'Ma caisse du jour', short: 'Ma caisse', icon: 'calculator', perm: 'cash.own', hideIf: 'reports.view', comp: Reports },
  { path: '/parametres', label: 'Paramètres', short: 'Réglages', icon: 'sliders', perm: null, comp: Settings },
];

const App = {
  components: { Icon, Sheet, Toasts, DialogHost, Login },
  setup() {
    const menuOpen = ref(false);
    const pages = computed(() => PAGES.filter((p) => (!p.perm || can(p.perm)) && !(p.hideIf && can(p.hideIf))));
    const current = computed(() => pages.value.find((p) => route.path === p.path || route.path.startsWith(`${p.path}/`)));
    const homePath = computed(() => (can('dashboard') ? '/tableau-de-bord' : '/caisse'));
    const tabs = computed(() => {
      const order = can('dashboard') ? ['/caisse', '/ventes', '/produits', '/clients'] : ['/caisse', '/ventes', '/clients', '/produits'];
      return order.map((p) => pages.value.find((x) => x.path === p)).filter(Boolean).slice(0, 4);
    });
    const pageTitle = computed(() => (current.value?.path === '/parametres' && !can('settings.manage') ? 'Mon compte' : current.value?.label || ''));
    const navLabel = (p) => (p.path === '/parametres' && !can('settings.manage') ? 'Mon compte' : p.label);

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

    const start = async () => {
      try {
        const status = await loadStatus();
        if (status.loggedIn && (await loadMe())) {
          connectEvents();
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

    return { store, route, pages, current, tabs, menuOpen, pageTitle, navLabel, onLogged, signOut, initials, ROLE, can };
  },
  template: `
    <div v-if="!store.booted" class="boot">Chargement…</div>
    <Login v-else-if="!store.me" @logged="onLogged" />
    <div v-else class="shell">
      <aside class="rail" aria-label="Menu principal">
        <div class="rail-brand"><img class="rail-logo" src="/icons/icon.svg" :alt="store.settings.store_name" /><strong>{{ store.settings.store_name }}</strong><span v-if="store.settings.demo_data" class="demo-tag">Données de démonstration</span><span v-else>Caisse gros & détail</span></div>
        <nav class="nav">
          <a v-for="p in pages" :key="p.path" :href="'#' + p.path" :class="{ active: current && current.path === p.path }" :aria-current="current && current.path === p.path ? 'page' : null">
            <Icon :name="p.icon" /><span class="lbl">{{ navLabel(p) }}</span><span class="lbl-short">{{ p.path === '/parametres' && !can('settings.manage') ? 'Compte' : p.short }}</span>
          </a>
        </nav>
        <div class="rail-foot">
          <div class="conn" :class="{ off: !store.online }"><i></i><span>{{ store.online ? 'Connecté au serveur' : 'Serveur injoignable' }}</span></div>
          <div class="rail-user">
            <span class="avatar">{{ initials(store.me.name) }}</span>
            <div class="who ellipsis"><strong class="ellipsis">{{ store.me.name }}</strong><span>{{ ROLE[store.me.role] }}</span></div>
          </div>
          <button type="button" class="btn-rail" @click="signOut"><Icon name="swap" /><span>Changer d'utilisateur</span></button>
        </div>
      </aside>

      <div class="main">
        <header class="topbar">
          <h1>{{ pageTitle }}</h1>
          <span v-if="store.settings.demo_data" class="demo-tag" style="margin-top:0">Démo</span>
          <span class="conn" :class="{ off: !store.online }" v-if="!store.online"><i></i></span>
          <button type="button" class="icon-btn" @click="signOut" aria-label="Changer d'utilisateur"><Icon name="swap" /></button>
        </header>
        <div v-if="!store.online" class="offline-banner" role="status"><Icon name="wifi" size="sm" />Connexion au serveur perdue. Vérifiez le Wi-Fi ; les données se mettront à jour au retour de la connexion.</div>
        <component v-if="current" :is="current.comp" :key="current.path" />
      </div>

      <nav class="tabbar" aria-label="Navigation">
        <a v-for="t in tabs" :key="t.path" :href="'#' + t.path" :class="{ on: current && current.path === t.path }">
          <Icon :name="t.icon" /><span>{{ t.short }}</span>
        </a>
        <button type="button" :class="{ on: current && !tabs.includes(current) }" @click="menuOpen = true"><Icon name="menu" /><span>Plus</span></button>
      </nav>

      <Sheet v-if="menuOpen" title="Menu" @close="menuOpen = false">
        <div class="list">
          <a v-for="p in pages" :key="p.path" :href="'#' + p.path" class="list-row click" style="text-decoration:none;color:inherit">
            <Icon :name="p.icon" /><div class="main-col"><div class="title">{{ navLabel(p) }}</div></div><Icon name="chevronRight" size="sm" />
          </a>
        </div>
        <div class="row" style="margin-top:16px">
          <span class="avatar">{{ initials(store.me.name) }}</span>
          <div class="grow"><strong>{{ store.me.name }}</strong><div class="xsmall faint">{{ ROLE[store.me.role] }}</div></div>
          <button type="button" class="btn" @click="signOut"><Icon name="swap" />Changer d'utilisateur</button>
        </div>
      </Sheet>
    </div>
    <Toasts />
    <DialogHost />`,
};

createApp(App).mount('#app');
