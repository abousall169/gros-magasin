// Choix (ou création rapide) d'un client.
import { ref, computed, onMounted } from '../vue.js';
import { api } from '../api.js';
import { can, toastError } from '../store.js';
import { money, norm } from '../format.js';
import { Icon, Sheet, Skeleton } from './ui.js';

export default {
  components: { Icon, Sheet, Skeleton },
  props: { current: Object, title: { type: String, default: 'Choisir le client' }, allowWalkIn: { type: Boolean, default: true } },
  emits: ['pick', 'close'],
  setup(props, { emit }) {
    const all = ref(null);
    const q = ref('');
    const creating = ref(false);
    const form = ref({ name: '', phone: '', type: 'retail' });
    const busy = ref(false);
    onMounted(async () => {
      try {
        all.value = await api.get('/customers');
      } catch (e) {
        toastError(e);
        all.value = [];
      }
    });
    const list = computed(() => {
      if (!all.value) return [];
      const words = norm(q.value).split(/\s+/).filter(Boolean);
      return all.value.filter((c) => {
        const hay = norm(`${c.name} ${c.phone || ''}`);
        return words.every((w) => hay.includes(w));
      });
    });
    const startCreate = () => {
      form.value = { name: /\d{4,}/.test(q.value) ? '' : q.value, phone: /\d{4,}/.test(q.value) ? q.value : '', type: 'retail' };
      creating.value = true;
    };
    const create = async () => {
      if (!form.value.name.trim()) return;
      busy.value = true;
      try {
        const c = await api.post('/customers', form.value);
        emit('pick', c);
      } catch (e) {
        toastError(e);
      } finally {
        busy.value = false;
      }
    };
    return { all, q, list, creating, form, busy, startCreate, create, money, can };
  },
  template: `
    <Sheet :title="creating ? 'Nouveau client' : title" @close="$emit('close')">
      <form v-if="creating" class="stack" @submit.prevent="create" id="new-cust">
        <div class="field"><label for="nc-name">Nom du client ou de la boutique</label><input id="nc-name" class="input" v-model="form.name" required maxlength="100" autofocus /></div>
        <div class="field"><label for="nc-phone">Téléphone</label><input id="nc-phone" class="input" v-model="form.phone" inputmode="tel" placeholder="Pour lui envoyer ses reçus par WhatsApp" /></div>
        <div class="field"><span class="label">Type de client</span>
          <div class="seg block">
            <button type="button" :class="{ on: form.type === 'retail' }" @click="form.type = 'retail'">Particulier (détail)</button>
            <button type="button" :class="{ on: form.type === 'wholesale' }" @click="form.type = 'wholesale'">Revendeur (gros)</button>
          </div>
        </div>
      </form>
      <div v-else class="stack">
        <div class="input-affix"><Icon name="search" /><input class="input" v-model="q" placeholder="Nom ou téléphone…" autofocus /></div>
        <Skeleton v-if="!all" :rows="4" />
        <div v-else class="list picker-list">
          <button v-if="allowWalkIn && !q" type="button" class="list-row" @click="$emit('pick', null)">
            <div class="main-col"><div class="title">Client comptoir</div><div class="sub">Sans compte client — paiement immédiat</div></div>
            <Icon v-if="!current" name="check" />
          </button>
          <button v-for="c in list" :key="c.id" type="button" class="list-row" @click="$emit('pick', c)">
            <div class="main-col">
              <div class="title">{{ c.name }}</div>
              <div class="sub">{{ c.phone || 'Sans téléphone' }} · {{ c.type === 'wholesale' ? 'Revendeur' : 'Particulier' }}</div>
            </div>
            <div class="end small">
              <span v-if="c.balance > 0" class="badge credit">Doit {{ money(c.balance) }}</span>
              <Icon v-else-if="current && current.id === c.id" name="check" />
            </div>
          </button>
          <p v-if="!list.length" class="small muted" style="padding:16px">Aucun client trouvé.</p>
        </div>
      </div>
      <template #foot>
        <template v-if="creating">
          <button type="button" class="btn" @click="creating = false">Retour</button>
          <button type="submit" form="new-cust" class="btn primary" :class="{ loading: busy }" :disabled="busy">Créer et choisir</button>
        </template>
        <button v-else-if="can('customers.manage')" type="button" class="btn" @click="startCreate"><Icon name="plus" />Nouveau client</button>
      </template>
    </Sheet>`,
};
