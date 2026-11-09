// Paramètres : magasin, ventes et paiements, utilisateurs, appareils (QR code), sauvegardes, mon compte.
import { ref, computed, watch, onMounted } from '../vue.js';
import { api } from '../api.js';
import { store, can, toast, toastError, ask, loadMe, loadProducts } from '../store.js';
import { when, initials } from '../format.js';
import { route, setQuery } from '../router.js';
import { Icon, Sheet, Skeleton } from '../components/ui.js';

const ROLE_HELP = {
  admin: 'Accès complet : prix, bénéfices, réglages, employés.',
  manager: 'Gère produits, stock, clients et rapports. Ne touche pas aux réglages ni aux employés.',
  cashier: 'Encaisse les ventes, voit ses propres ventes et les clients. Ne voit pas les prix d’achat.',
};

const StoreSettings = {
  components: { Icon },
  setup() {
    const f = ref({ ...store.settings, payment_methods: [...(store.settings.payment_methods || [])] });
    const newMethod = ref('');
    const busy = ref(false);
    const save = async () => {
      busy.value = true;
      try {
        await api.put('/settings', f.value);
        await loadMe();
        toast('Paramètres enregistrés.', 'success');
      } catch (e) {
        toastError(e);
      } finally {
        busy.value = false;
      }
    };
    const addMethod = () => {
      const m = newMethod.value.trim();
      if (m && !f.value.payment_methods.includes(m) && m.toLowerCase() !== 'espèces') f.value.payment_methods.push(m);
      newMethod.value = '';
    };
    return { f, newMethod, busy, save, addMethod };
  },
  template: `
    <form class="stack loose" @submit.prevent="save" style="max-width:820px">
      <section class="panel">
        <div class="panel-head"><h2>Le magasin</h2></div>
        <div class="form-grid">
          <div class="field span-2"><label for="st-name">Nom du magasin</label><input id="st-name" class="input" v-model="f.store_name" required maxlength="80" /></div>
          <div class="field"><label for="st-phone">Téléphone</label><input id="st-phone" class="input" v-model="f.store_phone" maxlength="80" /></div>
          <div class="field"><label for="st-tax">NINEA / RCCM / NIF</label><input id="st-tax" class="input" v-model="f.store_tax_id" maxlength="120" placeholder="Facultatif, imprimé sur les factures" /></div>
          <div class="field span-2"><label for="st-addr">Adresse</label><input id="st-addr" class="input" v-model="f.store_address" maxlength="200" /></div>
          <div class="field"><label for="st-cur">Devise</label><input id="st-cur" class="input" v-model="f.currency" maxlength="10" list="currencies" /><datalist id="currencies"><option>FCFA</option><option>GNF</option><option>€</option><option>CDF</option><option>MAD</option></datalist></div>
          <div class="field"><label for="st-dec">Centimes</label><select id="st-dec" class="select" v-model.number="f.currency_decimals"><option :value="0">Sans centimes (FCFA, GNF…)</option><option :value="2">Avec centimes (€…)</option></select></div>
          <div class="field"><label for="st-cc">Indicatif téléphonique pour WhatsApp</label><input id="st-cc" class="input" v-model="f.phone_country_code" inputmode="numeric" maxlength="4" placeholder="Ex. : 221, 225, 223, 224" /><span class="hint">Ajouté devant les numéros des clients pour l’envoi des reçus.</span></div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Tickets et factures</h2></div>
        <div class="form-grid">
          <div class="field"><label for="st-w">Largeur du papier du ticket</label><select id="st-w" class="select" v-model="f.receipt_width"><option value="80">80 mm (standard)</option><option value="58">58 mm (petite imprimante)</option></select></div>
          <div class="field span-2"><label for="st-foot">Message en bas du ticket</label><input id="st-foot" class="input" v-model="f.receipt_footer" maxlength="300" /></div>
        </div>
        <label class="check"><input type="checkbox" v-model="f.receipt_show_balance" /><span>Afficher le solde du client sur le ticket<small>Le client voit ce qu'il doit encore au total.</small></span></label>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Règles de vente</h2></div>
        <div class="stack">
          <label class="check"><input type="checkbox" v-model="f.cashier_can_edit_price" /><span>Les vendeurs peuvent modifier les prix et faire des remises<small>Pour négocier au comptoir. Les gestionnaires et l'administrateur le peuvent toujours.</small></span></label>
          <label class="check"><input type="checkbox" v-model="f.cashier_can_sell_on_credit" /><span>Les vendeurs peuvent vendre à crédit<small>Le plafond de crédit de chaque client reste appliqué.</small></span></label>
          <label class="check"><input type="checkbox" v-model="f.allow_negative_stock" /><span>Autoriser la vente quand le stock est à zéro<small>Utile si tous les produits n’ont pas encore été comptés. Le stock deviendra négatif.</small></span></label>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Moyens de paiement</h2></div>
        <p class="small muted" style="margin-bottom:12px">« Espèces » est toujours proposé. Ajoutez vos services de paiement mobile un par un pour les suivre séparément (Orange Money, Wave, MTN MoMo, Moov Money…).</p>
        <div class="chips" style="flex-wrap:wrap;margin-bottom:12px">
          <span class="chip on">Espèces</span>
          <button v-for="(m, i) in f.payment_methods" :key="m" type="button" class="chip" @click="f.payment_methods.splice(i, 1)" :aria-label="'Retirer ' + m" style="display:inline-flex;align-items:center;gap:6px">{{ m }}<Icon name="x" size="sm" /></button>
        </div>
        <div class="row"><input class="input" v-model="newMethod" placeholder="Ex. : Orange Money" maxlength="40" @keydown.enter.prevent="addMethod" /><button type="button" class="btn" @click="addMethod" :disabled="!newMethod.trim()">Ajouter</button></div>
      </section>
      <div><button class="btn primary lg" :class="{ loading: busy }" :disabled="busy">Enregistrer les paramètres</button></div>
    </form>`,
};

const Users = {
  components: { Icon, Sheet, Skeleton },
  setup() {
    const rows = ref(null);
    const form = ref(null);
    const load = async () => {
      try {
        rows.value = await api.get('/users');
      } catch (e) {
        toastError(e);
      }
    };
    onMounted(load);
    const edit = (u) => {
      form.value = u ? { id: u.id, name: u.name, role: u.role, active: !!u.active, pin: '' } : { name: '', role: 'cashier', active: true, pin: '' };
    };
    const save = async () => {
      const f = form.value;
      if (!f.id && !/^\d{4,8}$/.test(f.pin)) return toast('Le code PIN doit contenir 4 à 8 chiffres.', 'error');
      if (f.pin && !/^\d{4,8}$/.test(f.pin)) return toast('Le code PIN doit contenir 4 à 8 chiffres.', 'error');
      try {
        if (f.id) await api.put(`/users/${f.id}`, { name: f.name, role: f.role, active: f.active, pin: f.pin || undefined });
        else await api.post('/users', { name: f.name, role: f.role, pin: f.pin });
        toast('Utilisateur enregistré.', 'success');
        form.value = null;
        load();
      } catch (e) {
        toastError(e);
      }
    };
    return { rows, form, edit, save, store, when, initials, ROLE_HELP };
  },
  template: `
    <div class="stack" style="max-width:820px">
      <div class="row between"><p class="small muted">Chaque employé a son propre nom et son code PIN : on sait qui a fait chaque vente.</p><button type="button" class="btn primary" @click="edit(null)"><Icon name="plus" />Ajouter un employé</button></div>
      <Skeleton v-if="!rows" :rows="3" />
      <div v-else class="list">
        <button v-for="u in rows" :key="u.id" type="button" class="list-row" @click="edit(u)" :style="{ opacity: u.active ? 1 : 0.55 }">
          <span class="avatar">{{ initials(u.name) }}</span>
          <div class="main-col"><div class="title">{{ u.name }}<span v-if="!u.active" class="badge" style="margin-left:6px">Désactivé</span></div><div class="sub">{{ store.roles[u.role] }}<template v-if="u.last_seen"> · actif {{ when(u.last_seen) }}</template><template v-if="u.devices"> · {{ u.devices }} appareil(s) connecté(s)</template></div></div>
          <Icon name="chevronRight" size="sm" />
        </button>
      </div>
      <Sheet v-if="form" :title="form.id ? 'Modifier ' + form.name : 'Nouvel employé'" size="narrow" @close="form = null">
        <form id="user-form" class="stack" @submit.prevent="save">
          <div class="field"><label for="u-name">Nom affiché</label><input id="u-name" class="input" v-model="form.name" required maxlength="60" /></div>
          <div class="field"><span class="label">Rôle</span>
            <div class="list" style="border:1px solid var(--line)">
              <label v-for="(label, key) in store.roles" :key="key" class="list-row click" style="cursor:pointer">
                <input type="radio" :value="key" v-model="form.role" style="width:20px;height:20px;accent-color:var(--rail)" />
                <div class="main-col"><div class="title">{{ label }}</div><div class="sub" style="white-space:normal">{{ ROLE_HELP[key] }}</div></div>
              </label>
            </div>
          </div>
          <div class="field"><label for="u-pin">{{ form.id ? 'Nouveau code PIN (laisser vide pour ne pas changer)' : 'Code PIN (4 à 8 chiffres)' }}</label><input id="u-pin" class="input" v-model="form.pin" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password" :required="!form.id" /></div>
          <label class="check" v-if="form.id"><input type="checkbox" v-model="form.active" /><span>Compte actif<small>Un compte désactivé ne peut plus se connecter ; son historique est conservé.</small></span></label>
        </form>
        <template #foot><button type="button" class="btn" @click="form = null">Annuler</button><button type="submit" form="user-form" class="btn primary">Enregistrer</button></template>
      </Sheet>
    </div>`,
};

const Devices = {
  components: { Icon, Skeleton },
  setup() {
    const net = ref(null);
    onMounted(async () => {
      try {
        net.value = await api.get('/system/network');
      } catch (e) {
        toastError(e);
      }
    });
    const here = location.origin;
    return { net, here };
  },
  template: `
    <div class="stack loose" style="max-width:820px">
      <Skeleton v-if="!net" :rows="3" />
      <template v-else>
        <section class="panel" v-for="u in net.urls" :key="u.url">
          <div class="qr-card">
            <div class="qr" v-html="u.qr"></div>
            <div class="stack">
              <div class="xsmall faint">Adresse à ouvrir sur les téléphones et tablettes</div>
              <div class="url-big">{{ u.url }}</div>
              <ol class="steps">
                <li>Connectez le téléphone ou la tablette au <b>même Wi-Fi</b> que cet ordinateur.</li>
                <li>Scannez ce code avec l'appareil photo, ou tapez l'adresse dans le navigateur (Chrome, Safari).</li>
                <li>Dans le menu du navigateur, choisissez <b>« Ajouter à l'écran d'accueil »</b> : l'application s'ouvrira comme une appli.</li>
              </ol>
            </div>
          </div>
        </section>
        <div v-if="!net.urls.length" class="alert danger"><Icon name="wifi" /><span>L'ordinateur serveur n'est connecté à aucun réseau. Connectez-le au Wi-Fi du magasin, puis rouvrez cette page.</span></div>
        <section class="panel">
          <div class="kv">
            <div><span>Nom de l'ordinateur serveur</span><span>{{ net.hostname }}</span></div>
            <div><span>Appareils connectés en ce moment</span><span>{{ net.connected }}</span></div>
            <div><span>Adresse utilisée par cet appareil</span><span>{{ here }}</span></div>
          </div>
          <p class="xsmall faint" style="margin-top:12px">Conseil : demandez à votre fournisseur Internet de « réserver » l'adresse IP de l'ordinateur serveur dans la box, pour qu'elle ne change pas.</p>
        </section>
      </template>
    </div>`,
};

const Backups = {
  components: { Icon, Skeleton },
  setup() {
    const rows = ref(null);
    const busy = ref(false);
    const resetting = ref(false);
    const reset = async () => {
      const word = await ask({
        title: 'Effacer toutes les données ?',
        message: 'Produits, rayons, clients et leurs dettes, fournisseurs, ventes, réceptions, mouvements de stock et dépenses seront effacés. Les employés et les réglages sont conservés.\n\nUne sauvegarde complète est faite juste avant.',
        input: { label: 'Tapez EFFACER pour confirmer', placeholder: 'EFFACER', required: true },
        confirm: 'Tout effacer',
        danger: true,
      });
      if (!word) return;
      resetting.value = true;
      try {
        const r = await api.post('/system/reset', { confirm: word });
        try {
          localStorage.removeItem('gm_cart');
          localStorage.removeItem('gm_held');
        } catch {
          /* stockage indisponible */
        }
        await Promise.all([loadMe(), loadProducts()]);
        toast(`Données effacées. Sauvegarde gardée : ${r.backup}`, 'success', 6000);
        load();
      } catch (e) {
        toastError(e);
      } finally {
        resetting.value = false;
      }
    };
    const load = async () => {
      try {
        rows.value = await api.get('/system/backups');
      } catch (e) {
        toastError(e);
      }
    };
    onMounted(load);
    const now = async () => {
      busy.value = true;
      try {
        await api.post('/system/backups');
        toast('Sauvegarde créée.', 'success');
        load();
      } catch (e) {
        toastError(e);
      } finally {
        busy.value = false;
      }
    };
    const size = (b) => `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
    const url = (name) => api.url(`/system/backups/${encodeURIComponent(name)}`);
    return { rows, busy, now, size, url, when, reset, resetting, store };
  },
  template: `
    <div class="stack" style="max-width:820px">
      <div class="alert"><Icon name="database" /><span>Une sauvegarde automatique est faite au démarrage puis toutes les 6 heures, dans le dossier <b>backups</b> du logiciel. Téléchargez-en une de temps en temps sur une clé USB ou un autre ordinateur : si l'ordinateur tombe en panne, vos données sont sauves.</span></div>
      <div><button type="button" class="btn primary" :class="{ loading: busy }" :disabled="busy" @click="now"><Icon name="database" />Sauvegarder maintenant</button></div>
      <Skeleton v-if="!rows" :rows="3" />
      <div v-else-if="rows.length" class="list">
        <div v-for="b in rows.slice(0, 30)" :key="b.name" class="list-row">
          <div class="main-col"><div class="title">{{ b.name }}</div><div class="sub">{{ when(b.date.replace('T', ' ')) }} · {{ size(b.size) }}</div></div>
          <a class="btn sm" :href="url(b.name)"><Icon name="download" size="sm" />Télécharger</a>
        </div>
      </div>
      <p v-else class="small muted">Aucune sauvegarde pour l'instant.</p>
      <p class="xsmall faint">Pour restaurer une sauvegarde : arrêtez le logiciel, remplacez le fichier <b>data/grand-magasin.db</b> par la sauvegarde (renommée « grand-magasin.db »), puis redémarrez.</p>
      <section class="panel" style="margin-top:16px">
        <div class="panel-head"><h2>Repartir à zéro</h2></div>
        <p class="small muted" style="margin-bottom:12px">{{ store.settings.demo_data ? 'Vous utilisez les données de démonstration. ' : '' }}Efface les produits, clients, ventes, stocks et dépenses pour commencer avec vos vraies données. Les employés et les réglages restent.</p>
        <button type="button" class="btn danger" :class="{ loading: resetting }" :disabled="resetting" @click="reset"><Icon name="trash" />Effacer toutes les données…</button>
      </section>
    </div>`,
};

const Account = {
  setup() {
    const f = ref({ current: '', pin: '', pin2: '' });
    const busy = ref(false);
    const save = async () => {
      if (f.value.pin !== f.value.pin2) return toast('Les deux nouveaux codes ne sont pas identiques.', 'error');
      busy.value = true;
      try {
        await api.post('/auth/change-pin', { current: f.value.current, pin: f.value.pin });
        f.value = { current: '', pin: '', pin2: '' };
        toast('Code PIN modifié.', 'success');
      } catch (e) {
        toastError(e);
      } finally {
        busy.value = false;
      }
    };
    return { f, busy, save, store };
  },
  template: `
    <section class="panel" style="max-width:520px">
      <div class="panel-head"><h2>Changer mon code PIN</h2></div>
      <form class="stack" @submit.prevent="save">
        <p class="small muted">Connecté en tant que <b>{{ store.me.name }}</b> ({{ store.roles[store.me.role] }}).</p>
        <div class="field"><label for="a-cur">Code PIN actuel</label><input id="a-cur" class="input" type="password" inputmode="numeric" maxlength="8" v-model="f.current" required autocomplete="current-password" /></div>
        <div class="field"><label for="a-new">Nouveau code PIN (4 à 8 chiffres)</label><input id="a-new" class="input" type="password" inputmode="numeric" maxlength="8" v-model="f.pin" required autocomplete="new-password" /></div>
        <div class="field"><label for="a-new2">Confirmez le nouveau code</label><input id="a-new2" class="input" type="password" inputmode="numeric" maxlength="8" v-model="f.pin2" required autocomplete="new-password" /></div>
        <div><button class="btn primary" :class="{ loading: busy }" :disabled="busy">Changer le code</button></div>
      </form>
    </section>`,
};

export default {
  components: { StoreSettings, Users, Devices, Backups, Account },
  setup() {
    const tabs = computed(() =>
      [
        { id: 'magasin', label: 'Magasin & ventes', perm: 'settings.manage' },
        { id: 'utilisateurs', label: 'Employés', perm: 'users.manage' },
        { id: 'appareils', label: 'Connecter un appareil' },
        { id: 'sauvegardes', label: 'Sauvegardes', perm: 'backup' },
        { id: 'compte', label: 'Mon code PIN' },
      ].filter((t) => !t.perm || can(t.perm)),
    );
    const tab = computed(() => (tabs.value.some((t) => t.id === route.query.onglet) ? route.query.onglet : tabs.value[0].id));
    const setTab = (t) => setQuery({ onglet: t });
    return { tabs, tab, setTab, can };
  },
  template: `
    <div class="page">
      <div class="page-head"><h1>{{ can('settings.manage') ? 'Paramètres' : 'Mon compte' }}</h1></div>
      <nav class="tabs"><button v-for="t in tabs" :key="t.id" type="button" :class="{ on: tab === t.id }" @click="setTab(t.id)">{{ t.label }}</button></nav>
      <StoreSettings v-if="tab === 'magasin'" />
      <Users v-else-if="tab === 'utilisateurs'" />
      <Devices v-else-if="tab === 'appareils'" />
      <Backups v-else-if="tab === 'sauvegardes'" />
      <Account v-else />
    </div>`,
};
