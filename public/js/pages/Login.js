// Première installation + connexion par code PIN.
import { ref, computed, onMounted, onUnmounted } from '../vue.js';
import { api } from '../api.js';
import { store, loadStatus, toastError } from '../store.js';
import { initials } from '../format.js';
import { Icon } from '../components/ui.js';

const ROLE = { admin: 'Administrateur', manager: 'Gestionnaire', cashier: 'Vendeur' };

const Setup = {
  components: { Icon },
  emits: ['done'],
  setup(_, { emit }) {
    const f = ref({
      store_name: '',
      store_phone: '',
      store_address: '',
      currency: 'FCFA',
      admin_name: '',
      pin: '',
      pin2: '',
      demo: true,
    });
    const busy = ref(false);
    const error = ref('');
    const submit = async () => {
      error.value = '';
      const v = f.value;
      if (!/^\d{4,8}$/.test(v.pin)) return (error.value = 'Le code PIN doit contenir 4 à 8 chiffres.');
      if (v.pin !== v.pin2) return (error.value = 'Les deux codes PIN ne sont pas identiques.');
      busy.value = true;
      try {
        await api.post('/auth/setup', { ...v, currency_decimals: v.currency === '€' ? 2 : 0 });
        emit('done');
      } catch (e) {
        error.value = e.message;
      } finally {
        busy.value = false;
      }
    };
    return { f, busy, error, submit };
  },
  template: `
    <div class="login">
      <div class="login-head">
        <h1>Bienvenue</h1>
        <p>Configurons votre magasin. Cela prend une minute.</p>
      </div>
      <form class="login-card stack loose" @submit.prevent="submit">
        <div class="form-section">
          <h3>Le magasin</h3>
          <div class="field"><label for="s-name">Nom du magasin</label><input id="s-name" class="input" v-model="f.store_name" required maxlength="80" placeholder="Ex. : Grand Magasin Barry & Fils" autofocus /></div>
          <div class="form-grid">
            <div class="field"><label for="s-phone">Téléphone</label><input id="s-phone" class="input" v-model="f.store_phone" inputmode="tel" placeholder="Facultatif" /></div>
            <div class="field"><label for="s-cur">Devise</label>
              <select id="s-cur" class="select" v-model="f.currency"><option>FCFA</option><option>GNF</option><option>€</option></select>
            </div>
            <div class="field span-2"><label for="s-addr">Adresse</label><input id="s-addr" class="input" v-model="f.store_address" placeholder="Facultatif — apparaît sur les tickets" /></div>
          </div>
        </div>
        <div class="form-section">
          <h3>Votre compte administrateur</h3>
          <div class="field"><label for="a-name">Votre nom</label><input id="a-name" class="input" v-model="f.admin_name" required maxlength="60" placeholder="Ex. : Ibrahima" /></div>
          <div class="form-grid">
            <div class="field"><label for="a-pin">Code PIN (4 à 8 chiffres)</label><input id="a-pin" class="input" v-model="f.pin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" required /></div>
            <div class="field"><label for="a-pin2">Confirmez le code PIN</label><input id="a-pin2" class="input" v-model="f.pin2" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" required /></div>
          </div>
          <p class="xsmall faint">Ce code protège l'accès aux prix d'achat, aux bénéfices et aux réglages. Ne le donnez pas aux vendeurs : vous leur créerez leur propre compte.</p>
        </div>
        <label class="check"><input type="checkbox" v-model="f.demo" /><span>Ajouter des produits, clients et ventes de démonstration<small>Pratique pour essayer. Vous pourrez les modifier ou les archiver ensuite.</small></span></label>
        <div v-if="error" class="alert danger"><Icon name="alert" /><span>{{ error }}</span></div>
        <button class="btn primary lg block" :class="{ loading: busy }" :disabled="busy">Créer le magasin</button>
      </form>
    </div>`,
};

const PinLogin = {
  components: { Icon },
  emits: ['done'],
  setup(_, { emit }) {
    const users = computed(() => store.status?.users || []);
    const user = ref(null);
    const pin = ref('');
    const error = ref('');
    const shake = ref(false);
    const busy = ref(false);
    const choose = (u) => {
      user.value = u;
      pin.value = '';
      error.value = '';
    };
    const press = (d) => {
      if (busy.value) return;
      error.value = '';
      if (pin.value.length < 8) pin.value += d;
    };
    const back = () => {
      pin.value = pin.value.slice(0, -1);
    };
    const submit = async () => {
      if (pin.value.length < 4 || busy.value) return;
      busy.value = true;
      try {
        await api.post('/auth/login', { user_id: user.value.id, pin: pin.value });
        emit('done');
      } catch (e) {
        error.value = e.message;
        pin.value = '';
        shake.value = true;
        setTimeout(() => (shake.value = false), 400);
      } finally {
        busy.value = false;
      }
    };
    const onKey = (e) => {
      if (!user.value) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Enter') submit();
      else if (e.key === 'Escape') user.value = null;
    };
    onMounted(() => {
      document.addEventListener('keydown', onKey);
      if (users.value.length === 1) choose(users.value[0]);
    });
    onUnmounted(() => document.removeEventListener('keydown', onKey));
    return { store, users, user, pin, error, shake, busy, choose, press, back, submit, initials, ROLE };
  },
  template: `
    <div class="login">
      <div class="login-head">
        <h1>{{ store.status?.store_name }}</h1>
        <p>{{ user ? 'Entrez votre code PIN' : 'Qui utilise la caisse ?' }}</p>
      </div>
      <div v-if="!user" class="login-card">
        <div class="user-grid">
          <button v-for="u in users" :key="u.id" type="button" class="user-tile" @click="choose(u)">
            <span class="avatar">{{ initials(u.name) }}</span>
            <strong>{{ u.name }}</strong>
            <span>{{ ROLE[u.role] }}</span>
          </button>
        </div>
      </div>
      <div v-else class="login-card narrow">
        <div class="row">
          <span class="avatar">{{ initials(user.name) }}</span>
          <div class="grow"><strong>{{ user.name }}</strong><div class="xsmall faint">{{ ROLE[user.role] }}</div></div>
          <button v-if="users.length > 1" type="button" class="btn ghost sm" @click="user = null"><Icon name="swap" size="sm" />Changer</button>
        </div>
        <div class="pin-dots" :class="{ shake }" aria-hidden="true">
          <i v-for="n in Math.max(4, pin.length)" :key="n" :class="{ on: n <= pin.length }"></i>
        </div>
        <p class="pin-error" role="alert">{{ error }}</p>
        <div class="keypad">
          <button v-for="d in ['1','2','3','4','5','6','7','8','9']" :key="d" type="button" @click="press(d)">{{ d }}</button>
          <button type="button" @click="back" aria-label="Effacer"><Icon name="backspace" size="lg" /></button>
          <button type="button" @click="press('0')">0</button>
          <button type="button" class="ok" :disabled="pin.length < 4 || busy" @click="submit">Valider</button>
        </div>
      </div>
    </div>`,
};

export default {
  components: { Setup, PinLogin },
  emits: ['logged'],
  setup(_, { emit }) {
    const done = async () => {
      try {
        await loadStatus();
      } catch (e) {
        toastError(e);
      }
      emit('logged');
    };
    return { store, done };
  },
  template: `
    <Setup v-if="store.status?.needsSetup" @done="done" />
    <PinLogin v-else @done="done" />`,
};
