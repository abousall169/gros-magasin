// Paramètres : magasin, ventes et paiements, utilisateurs, appareils (QR code), sauvegardes, mon compte.
import { ref, computed, watch, onMounted } from '../vue.js';
import { api } from '../api.js';
import { store, can, toast, toastError, ask, loadMe, loadProducts } from '../store.js';
import { when, initials } from '../format.js';
import { route, setQuery } from '../router.js';
import { t, LANGS, setLang } from '../i18n.js';
import { sendTestTicket } from '../printer.js';
import { Icon, Sheet, Skeleton } from '../components/ui.js';

const ROLE_HELP = {
  admin: 'Accès complet : prix, bénéfices, réglages, employés.',
  manager: 'Gère produits, stock, clients et rapports. Ne touche pas aux réglages ni aux employés.',
  cashier: 'Ne voit que la liste des ventes envoyées par les vendeurs. Il en choisit une et l’encaisse, sans pouvoir la modifier. Il ne vend pas lui-même. Il note ses dépenses et termine sa journée (ticket imprimé, totaux remis à zéro).',
  seller: 'Ne voit que la caisse. Prépare le panier du client et l’envoie à la caisse : il n’encaisse pas. Peut vendre plus cher que le prix fixé, jamais moins cher.',
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
        const { printer, auto_print, printer_cut, cash_drawer, ...rest } = f.value; // réglés dans l'onglet Imprimante
        await api.put('/settings', rest);
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
          <p class="small muted">Vendeurs et caissiers ne voient que la caisse. Plusieurs <b>vendeurs</b> préparent chacun le panier de leur client et l'envoient à la caisse ; ils peuvent changer le prix d'un article pour vendre <b>plus cher</b> que le prix fixé ici, jamais moins cher, et ne peuvent pas faire de remise. Le <b>caissier</b> voit la liste des ventes envoyées, en choisit une et l'encaisse <b>sans pouvoir la modifier</b> ; il ne vend pas lui-même. Les gestionnaires et l'administrateur peuvent vendre directement, baisser un prix et accorder des remises.</p>
          <label class="check"><input type="checkbox" v-model="f.cashier_can_sell_on_credit" /><span>Les caissiers peuvent encaisser à crédit<small>Le plafond de crédit de chaque client reste appliqué.</small></span></label>
          <label class="check"><input type="checkbox" v-model="f.allow_negative_stock" /><span>Autoriser la vente quand le stock est à zéro<small>Utile si tous les produits n’ont pas encore été comptés. Le stock deviendra négatif.</small></span></label>        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>TVA</h2></div>
        <div class="stack">
          <label class="check"><input type="checkbox" v-model="f.tax_enabled" /><span>Afficher la TVA sur les tickets et factures<small>Les prix de vente restent TTC (TVA comprise) : le logiciel calcule la part de TVA de chaque vente et la TVA collectée dans les rapports.</small></span></label>
          <div class="field" v-if="f.tax_enabled" style="max-width:240px"><label for="st-tax">Taux de TVA du magasin (%)</label><input id="st-tax" class="input num" v-model.number="f.tax_rate" inputmode="decimal" /><span class="hint">Un produit peut avoir son propre taux dans sa fiche (0 = exonéré).</span></div>
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

// ---- Imprimante de tickets thermique (ESC/POS) et tiroir-caisse ---------------------------
const PrinterSettings = {
  components: { Icon, Skeleton },
  setup() {
    const s = store.settings;
    const printers = ref(null);
    const listError = ref('');
    const cur = s.printer || '';
    const mode = ref(cur.startsWith('tcp:') ? 'tcp' : cur); // '' | 'usb:<nom>' | 'tcp'
    const ip = ref(cur.startsWith('tcp:') ? cur.slice(4) : '');
    const f = ref({ receipt_width: s.receipt_width, auto_print: !!s.auto_print, printer_cut: s.printer_cut !== false, cash_drawer: !!s.cash_drawer });
    const busy = ref('');
    onMounted(async () => {
      try {
        const r = await api.get('/system/printers');
        printers.value = r.printers || [];
        listError.value = r.error || '';
      } catch (e) {
        printers.value = [];
        listError.value = e.message;
      }
    });
    const value = computed(() => (mode.value === 'tcp' ? (ip.value.trim() ? `tcp:${ip.value.trim()}` : '') : mode.value));
    const persist = async () => {
      await api.put('/settings', {
        printer: value.value,
        receipt_width: f.value.receipt_width,
        auto_print: f.value.auto_print && !!value.value,
        printer_cut: f.value.printer_cut,
        cash_drawer: f.value.cash_drawer && !!value.value,
      });
      await loadMe();
    };
    const run = async (label, fn, ok) => {
      busy.value = label;
      try {
        await fn();
        if (ok) toast(ok, 'success');
      } catch (e) {
        toastError(e);
      } finally {
        busy.value = '';
      }
    };
    const save = () => run('save', persist, 'Réglages de l’imprimante enregistrés.');
    const test = () => run('test', async () => {
      await persist();
      await sendTestTicket();
    }, 'Ticket d’essai envoyé à l’imprimante.');
    const drawer = () => run('drawer', async () => {
      await persist();
      await api.post('/system/drawer');
    }, 'Tiroir-caisse ouvert.');
    return { printers, listError, mode, ip, f, value, busy, save, test, drawer };
  },
  template: `
    <div class="stack loose" style="max-width:820px">
      <section class="panel">
        <div class="panel-head"><h2>Imprimante de tickets</h2></div>
        <div class="stack">
          <p class="small muted">Branchée à l'ordinateur serveur (USB) ou au réseau (Ethernet / Wi-Fi). Le ticket est dessiné par l'appareil qui vend (français et arabe corrects) puis envoyé directement à l'imprimante, sans fenêtre d'impression — même depuis un téléphone.</p>
          <div class="field"><label for="pr-mode">Imprimante</label>
            <select id="pr-mode" class="select" v-model="mode">
              <option value="">Aucune : impression par le navigateur</option>
              <option v-for="p in printers || []" :key="p.name" :value="'usb:' + p.name">{{ p.name }} (USB / Windows)</option>
              <option value="tcp">Imprimante réseau (adresse IP)</option>
              <option v-if="mode.startsWith('usb:') && printers && !printers.some(p => 'usb:' + p.name === mode)" :value="mode">{{ mode.slice(4) }} (introuvable)</option>
            </select>
            <span class="hint" v-if="printers && !printers.length">Aucune imprimante trouvée dans Windows{{ listError ? ' (' + listError + ')' : '' }}. Installez son pilote (ou « Generic / Text Only »), ou utilisez une imprimante réseau.</span>
          </div>
          <div class="field" v-if="mode === 'tcp'"><label for="pr-ip">Adresse IP de l'imprimante</label><input id="pr-ip" class="input" v-model="ip" dir="ltr" placeholder="192.168.1.50 ou 192.168.1.50:9100" /><span class="hint">Port 9100 par défaut. L'adresse s'imprime souvent en maintenant le bouton FEED à l'allumage.</span></div>
          <div class="field"><span class="label">Largeur du papier</span>
            <div class="seg"><button type="button" :class="{ on: f.receipt_width === '80' }" @click="f.receipt_width = '80'">80 mm</button><button type="button" :class="{ on: f.receipt_width === '58' }" @click="f.receipt_width = '58'">58 mm</button></div>
          </div>
          <label class="check"><input type="checkbox" v-model="f.auto_print" :disabled="!value" /><span>Imprimer le ticket automatiquement après chaque vente</span></label>
          <label class="check"><input type="checkbox" v-model="f.printer_cut" /><span>Couper le papier après chaque ticket<small>Si l'imprimante a un massicot.</small></span></label>
          <label class="check"><input type="checkbox" v-model="f.cash_drawer" :disabled="!value" /><span>Ouvrir le tiroir-caisse à chaque vente payée en espèces<small>Tiroir branché sur la prise RJ11 de l'imprimante.</small></span></label>
          <div class="row wrap">
            <button type="button" class="btn primary" :class="{ loading: busy === 'save' }" :disabled="!!busy" @click="save">Enregistrer</button>
            <button type="button" class="btn" :class="{ loading: busy === 'test' }" :disabled="!!busy || !value" @click="test"><Icon name="printer" />Imprimer un ticket d'essai</button>
            <button v-if="f.cash_drawer" type="button" class="btn" :class="{ loading: busy === 'drawer' }" :disabled="!!busy || !value" @click="drawer"><Icon name="coins" />Ouvrir le tiroir</button>
          </div>
          <p class="xsmall faint">Sans imprimante réglée, le bouton « Ticket » ouvre la fenêtre d'impression du navigateur (marges : aucune).</p>
          <p class="xsmall faint">Si la caisse démarre avec Windows sous le compte système, une imprimante installée seulement pour votre utilisateur peut ne pas apparaître : voir le guide d'installation.</p>
        </div>
      </section>
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
        <div v-if="net.https" class="alert"><Icon name="shield" /><span>Connexion sécurisée (HTTPS) disponible : elle permet la <b>caméra</b> (scan des codes-barres, photos) et la <b>vente sans réseau</b>. À faire une seule fois par appareil : ouvrir l'adresse d'installation, installer le certificat du magasin, puis utiliser l'adresse sécurisée.</span></div>
        <section class="panel" v-for="u in net.urls" :key="u.url">
          <div class="qr-card">
            <div class="qr" v-html="u.installQr || u.qr"></div>
            <div class="stack">
              <template v-if="u.secureUrl">
                <div class="xsmall faint">1re fois sur un appareil : installation</div>
                <div class="url-big">{{ u.installUrl }}</div>
                <div class="xsmall faint">Ensuite, adresse de la caisse</div>
                <div class="url-big">{{ u.secureUrl }}</div>
                <ol class="steps">
                  <li>Connectez le téléphone ou la tablette au <b>même Wi-Fi</b> que cet ordinateur.</li>
                  <li>Scannez ce code avec l'appareil photo : la page d'installation explique comment installer le certificat (Android, iPhone).</li>
                  <li>Ouvrez ensuite l'adresse sécurisée et choisissez <b>« Ajouter à l'écran d'accueil »</b> dans le menu du navigateur.</li>
                </ol>
              </template>
              <template v-else>
                <div class="xsmall faint">Adresse à ouvrir sur les téléphones et tablettes</div>
                <div class="url-big">{{ u.url }}</div>
                <ol class="steps">
                  <li>Connectez le téléphone ou la tablette au <b>même Wi-Fi</b> que cet ordinateur.</li>
                  <li>Scannez ce code avec l'appareil photo, ou tapez l'adresse dans le navigateur (Chrome, Safari).</li>
                  <li>Dans le menu du navigateur, choisissez <b>« Ajouter à l'écran d'accueil »</b> : l'application s'ouvrira comme une appli.</li>
                </ol>
              </template>
            </div>
          </div>
        </section>
        <div v-if="!net.urls.length" class="alert danger"><Icon name="wifi" /><span>L'ordinateur serveur n'est connecté à aucun réseau. Connectez-le au Wi-Fi du magasin, puis rouvrez cette page.</span></div>
        <section class="panel">
          <div class="kv">
            <div><span>Nom de l'ordinateur serveur</span><span>{{ net.hostname }}</span></div>
            <div><span>Appareils connectés en ce moment</span><span>{{ net.connected }}</span></div>
            <div><span>Adresse utilisée par cet appareil</span><span>{{ here }}{{ net.secure ? ' (sécurisée)' : '' }}</span></div>
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
    const dir = ref('');
    const lastCopy = ref(null);
    const fileInput = ref(null);
    const load = async () => {
      try {
        const r = await api.get('/system/backups');
        rows.value = r.files;
        dir.value = r.dir;
        lastCopy.value = r.lastCopy;
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
    const saveDir = async () => {
      busy.value = true;
      try {
        const r = await api.put('/system/backups/dir', { dir: dir.value });
        lastCopy.value = r.lastCopy;
        toast(dir.value ? 'Dossier enregistré : une copie y a été faite.' : 'Copie externe désactivée.', 'success');
        load();
      } catch (e) {
        toastError(e);
      } finally {
        busy.value = false;
      }
    };
    const restored = (r) => {
      try {
        localStorage.removeItem('gm_cart');
        localStorage.removeItem('gm_held');
      } catch {
        /* stockage indisponible */
      }
      window.alert(`Données restaurées. Une copie de sécurité a été gardée (${r.safety}). Reconnectez-vous.`);
      window.location.reload();
    };
    const confirmRestore = (label) =>
      ask({
        title: 'Restaurer cette sauvegarde ?',
        message: `${label}\n\nToutes les données actuelles (produits, ventes, clients, stock…) seront remplacées par celles de la sauvegarde. Une copie de sécurité est faite juste avant. Tous les appareils devront se reconnecter.`,
        input: { label: 'Tapez RESTAURER pour confirmer', placeholder: 'RESTAURER', required: true },
        confirm: 'Restaurer',
        danger: true,
      }).then((w) => String(w || '').trim().toUpperCase() === 'RESTAURER');
    const restoreName = async (name) => {
      if (!(await confirmRestore(name))) return;
      busy.value = true;
      try {
        restored(await api.post(`/system/backups/${encodeURIComponent(name)}/restore`));
      } catch (e) {
        toastError(e);
      } finally {
        busy.value = false;
      }
    };
    const restoreFile = async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file || !(await confirmRestore(file.name))) return;
      busy.value = true;
      try {
        restored(await api.upload('/system/restore-upload', file));
      } catch (err) {
        toastError(err);
      } finally {
        busy.value = false;
      }
    };
    const size = (b) => `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
    const url = (name) => api.url(`/system/backups/${encodeURIComponent(name)}`);
    return { rows, busy, now, size, url, when, reset, resetting, store, dir, lastCopy, saveDir, restoreName, restoreFile, fileInput };
  },
  template: `
    <div class="stack" style="max-width:820px">
      <div class="alert"><Icon name="database" /><span>Une sauvegarde automatique est faite au démarrage puis toutes les 6 heures, dans le dossier <b>backups</b> du logiciel. <b>Sans copie ailleurs, les sauvegardes restent sur le même disque que les données</b> : indiquez ci-dessous une clé USB ou un dossier synchronisé (Google Drive pour ordinateur…).</span></div>
      <section class="panel">
        <div class="panel-head"><h2>Copier aussi les sauvegardes vers…</h2></div>
        <div class="stack">
          <div class="row"><input class="input" v-model="dir" dir="ltr" placeholder="Ex. : E:\\Sauvegardes ou C:\\Users\\Gerant\\Google Drive\\Caisse" /><button type="button" class="btn" :disabled="busy" @click="saveDir">Enregistrer</button></div>
          <p class="xsmall faint">Dossier de l'ordinateur serveur. Chaque sauvegarde (automatique ou manuelle) y est copiée.</p>
          <p v-if="lastCopy" class="small" :style="{ color: lastCopy.ok ? 'var(--paid-ink)' : 'var(--credit-ink)' }">{{ lastCopy.ok ? 'Dernière copie réussie le ' + lastCopy.at : 'Échec de la dernière copie (' + lastCopy.at + ') : ' + lastCopy.error }}</p>
        </div>
      </section>
      <div class="row wrap">
        <button type="button" class="btn primary" :class="{ loading: busy }" :disabled="busy" @click="now"><Icon name="database" />Sauvegarder maintenant</button>
        <button type="button" class="btn" :disabled="busy" @click="fileInput.click()"><Icon name="upload" />Restaurer depuis un fichier…</button>
        <input ref="fileInput" type="file" accept=".db" class="sr-only" @change="restoreFile" />
      </div>
      <Skeleton v-if="!rows" :rows="3" />
      <div v-else-if="rows.length" class="list">
        <div v-for="b in rows.slice(0, 30)" :key="b.name" class="list-row">
          <div class="main-col"><div class="title">{{ b.name }}</div><div class="sub">{{ when(b.date.replace('T', ' ')) }} · {{ size(b.size) }}</div></div>
          <button type="button" class="btn sm" :disabled="busy" @click="restoreName(b.name)"><Icon name="undo" size="sm" />Restaurer</button>
          <a class="btn sm" :href="url(b.name)"><Icon name="download" size="sm" />Télécharger</a>
        </div>
      </div>
      <p v-else class="small muted">Aucune sauvegarde pour l'instant.</p>
      <p class="xsmall faint">La restauration remplace toutes les données sans arrêter le logiciel ; une copie de sécurité « avant-restauration » est faite juste avant.</p>
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
      if (f.value.pin !== f.value.pin2) return toast(t('Les deux nouveaux codes ne sont pas identiques.'), 'error');
      busy.value = true;
      try {
        await api.post('/auth/change-pin', { current: f.value.current, pin: f.value.pin });
        f.value = { current: '', pin: '', pin2: '' };
        toast(t('Code PIN modifié.'), 'success');
      } catch (e) {
        toastError(e);
      } finally {
        busy.value = false;
      }
    };
    const ROLE = { admin: 'Administrateur', manager: 'Gestionnaire', cashier: 'Caissier', seller: 'Vendeur' };
    return { f, busy, save, store, LANGS, setLang, ROLE };
  },
  template: `
    <div class="stack loose" style="max-width:520px">
      <section class="panel">
        <div class="panel-head"><h2>{{ t('Langue de la caisse') }}</h2></div>
        <div class="seg block" role="group" :aria-label="t('Langue')">
          <button v-for="l in LANGS" :key="l.id" type="button" :class="{ on: store.lang === l.id }" @click="setLang(l.id)">{{ l.label }}</button>
        </div>
        <p class="xsmall faint" style="margin-top:8px">{{ t('Retenue pour votre compte. Les tickets sortent dans cette langue.') }}</p>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>{{ t('Changer mon code PIN') }}</h2></div>
        <form class="stack" @submit.prevent="save">
          <p class="small muted">{{ t('Connecté en tant que {u} ({r}).', { u: store.me.name, r: t(ROLE[store.me.role]) }) }}</p>
          <div class="field"><label for="a-cur">{{ t('Code PIN actuel') }}</label><input id="a-cur" class="input" type="password" inputmode="numeric" maxlength="8" v-model="f.current" required autocomplete="current-password" /></div>
          <div class="field"><label for="a-new">{{ t('Nouveau code PIN (4 à 8 chiffres)') }}</label><input id="a-new" class="input" type="password" inputmode="numeric" maxlength="8" v-model="f.pin" required autocomplete="new-password" /></div>
          <div class="field"><label for="a-new2">{{ t('Confirmez le nouveau code') }}</label><input id="a-new2" class="input" type="password" inputmode="numeric" maxlength="8" v-model="f.pin2" required autocomplete="new-password" /></div>
          <div><button class="btn primary" :class="{ loading: busy }" :disabled="busy">{{ t('Changer le code') }}</button></div>
        </form>
      </section>
    </div>`,
};

export default {
  components: { StoreSettings, PrinterSettings, Users, Devices, Backups, Account },
  setup() {
    const tabs = computed(() =>
      [
        { id: 'magasin', label: 'Magasin & ventes', perm: 'settings.manage' },
        { id: 'imprimante', label: 'Imprimante & tiroir', perm: 'settings.manage' },
        { id: 'utilisateurs', label: 'Employés', perm: 'users.manage' },
        { id: 'appareils', label: 'Connecter un appareil' },
        { id: 'sauvegardes', label: 'Sauvegardes', perm: 'backup' },
        { id: 'compte', label: 'Langue et code PIN' },
      ].filter((x) => !x.perm || can(x.perm)),
    );
    const tab = computed(() => (tabs.value.some((x) => x.id === route.query.onglet) ? route.query.onglet : tabs.value[0].id));
    const setTab = (id) => setQuery({ onglet: id });
    return { tabs, tab, setTab, can };
  },
  template: `
    <div class="page">
      <div class="page-head"><h1>{{ can('settings.manage') ? t('Paramètres') : t('Mon compte') }}</h1></div>
      <nav class="tabs"><button v-for="x in tabs" :key="x.id" type="button" :class="{ on: tab === x.id }" @click="setTab(x.id)">{{ t(x.label) }}</button></nav>
      <StoreSettings v-if="tab === 'magasin'" />
      <PrinterSettings v-else-if="tab === 'imprimante'" />
      <Users v-else-if="tab === 'utilisateurs'" />
      <Devices v-else-if="tab === 'appareils'" />
      <Backups v-else-if="tab === 'sauvegardes'" />
      <Account v-else />
    </div>`,
};
