// Caméra : scan de codes-barres, prise de photo, reconnaissance d'un produit par photo.
import { ref, onMounted, onUnmounted, watch } from '../vue.js';
import { store } from '../store.js';
import { t, pname } from '../i18n.js';
import { money, stockText } from '../format.js';
import { Icon, Sheet } from './ui.js';
import { CONFIDENCE, embed, loadIndex, loadVision, preparePhoto, rank } from '../vision.js';

/** Bouton qui ouvre l'appareil photo (ou la galerie) et renvoie le fichier choisi. */
export const PhotoButton = {
  components: { Icon },
  props: { camera: { type: Boolean, default: true }, multiple: Boolean, disabled: Boolean, label: String, icon: { type: String, default: 'camera' }, cls: { type: String, default: 'btn' }, title: String },
  emits: ['file', 'files'],
  setup(props, { emit }) {
    const onChange = (e) => {
      const files = [...(e.target.files || [])];
      e.target.value = '';
      if (!files.length) return;
      if (props.multiple) emit('files', files);
      else emit('file', files[0]);
    };
    return { onChange };
  },
  template: `
    <label :class="[cls, { disabled }]" :title="title || label" :aria-label="title || label" role="button">
      <Icon :name="icon" /><span v-if="label">{{ label }}</span>
      <input type="file" accept="image/*" :capture="camera ? 'environment' : null" :multiple="multiple" :disabled="disabled" class="sr-only" @change="onChange" />
    </label>`,
};

let zxingLoading = null;
function loadZxing() {
  if (window.ZXingBrowser) return Promise.resolve(window.ZXingBrowser);
  zxingLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/zxing-browser.min.js';
    s.onload = () => resolve(window.ZXingBrowser);
    s.onerror = () => {
      zxingLoading = null;
      reject(new Error('ZXing indisponible'));
    };
    document.head.appendChild(s);
  });
  return zxingLoading;
}

/**
 * Scan de code-barres avec la caméra. Nécessite HTTPS (ou localhost).
 * - Chrome / Edge Android : lecteur natif du navigateur (rapide).
 * - Autres (iPhone, ordinateurs) : décodeur ZXing intégré, chargé à la demande.
 */
export const Scanner = {
  components: { Sheet, Icon },
  props: { title: String },
  emits: ['detect', 'close'],
  setup(props, { emit }) {
    const video = ref(null);
    const error = ref('');
    const insecure = !window.isSecureContext;
    let stopped = false;
    let cleanup = () => {};
    const found = (code) => {
      if (stopped) return;
      stopped = true;
      navigator.vibrate?.(60);
      cleanup();
      emit('detect', String(code).trim());
    };
    const constraints = { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } };
    onMounted(async () => {
      if (insecure || !navigator.mediaDevices?.getUserMedia) {
        error.value = insecure ? 'https' : 'unsupported';
        return;
      }
      try {
        if ('BarcodeDetector' in window) {
          const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
          const stream = await navigator.mediaDevices.getUserMedia({ video: constraints });
          let timer = null;
          cleanup = () => {
            clearTimeout(timer);
            stream.getTracks().forEach((tr) => tr.stop());
          };
          if (stopped) return cleanup();
          video.value.srcObject = stream;
          await video.value.play();
          const tick = async () => {
            if (stopped) return;
            try {
              const codes = await detector.detect(video.value);
              if (codes[0]?.rawValue) return found(codes[0].rawValue);
            } catch {
              /* image pas encore prête */
            }
            timer = setTimeout(tick, 150);
          };
          tick();
        } else {
          const Z = await loadZxing();
          const F = Z.BarcodeFormat;
          // Clés de DecodeHintType : 2 = POSSIBLE_FORMATS, 3 = TRY_HARDER
          const hints = new Map([
            [2, [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.QR_CODE]],
            [3, true],
          ]);
          const reader = new Z.BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 });
          const controls = await reader.decodeFromConstraints({ video: constraints }, video.value, (result) => {
            if (result) found(result.getText());
          });
          cleanup = () => controls.stop();
          if (stopped) cleanup();
        }
      } catch (e) {
        console.error(e);
        if (!stopped) error.value = e?.name === 'NotAllowedError' ? 'denied' : 'unsupported';
      }
    });
    onUnmounted(() => {
      stopped = true;
      cleanup();
    });
    const installUrl = `http://${location.hostname}:${location.port || 80}/install`;
    return { video, error, installUrl };
  },
  template: `
    <Sheet :title="title || t('Scanner un code-barres')" size="narrow" @close="$emit('close')">
      <div v-if="error" class="alert danger"><Icon name="alert" />
        <span v-if="error === 'https'">{{ t('La caméra demande une connexion sécurisée (HTTPS). Installez le certificat du magasin sur cet appareil :') }} <a :href="installUrl">{{ installUrl }}</a></span>
        <span v-else-if="error === 'denied'">{{ t('L’accès à la caméra a été refusé. Autorisez-le dans les réglages du navigateur.') }}</span>
        <span v-else>{{ t('Le scan par caméra n’est pas disponible sur cet appareil. Utilisez un lecteur de codes-barres ou tapez le code.') }}</span>
      </div>
      <template v-else>
        <div class="scanner"><video ref="video" muted playsinline></video><i aria-hidden="true"></i></div>
        <p class="small muted" style="text-align:center;margin-top:12px">{{ t('Placez le code-barres devant la caméra.') }}</p>
      </template>
    </Sheet>`,
};

/** Reconnaissance d'un article à partir d'une photo : propose les 3 produits les plus proches, le vendeur confirme. */
export const Recognize = {
  components: { Sheet, Icon, PhotoButton },
  props: { file: Object },
  emits: ['pick', 'close'],
  setup(props) {
    const current = ref(props.file);
    const state = ref('loading'); // loading | analyzing | done | error
    const progress = ref(null);
    const preview = ref('');
    const results = ref([]);
    const indexSize = ref(0);
    let run = 0;
    const analyze = async (file) => {
      const id = ++run; // ignore les analyses périmées (nouvelle photo prise entre-temps)
      try {
        state.value = 'loading';
        results.value = [];
        const { blob, thumb } = await preparePhoto(file);
        if (id !== run) return;
        preview.value = thumb;
        await loadVision((p) => {
          if (p.status === 'progress' && p.file?.endsWith('.onnx')) progress.value = Math.round(p.progress);
        });
        state.value = 'analyzing';
        const [vec, index] = await Promise.all([embed(blob), loadIndex()]);
        if (id !== run) return;
        const active = new Map(store.products.map((p) => [p.id, p]));
        results.value = rank(
          vec,
          index.filter((i) => active.has(i.productId)),
          3,
        ).map((r) => ({ ...r, product: active.get(r.productId) }));
        indexSize.value = index.length;
        state.value = 'done';
      } catch (e) {
        console.error(e);
        if (id === run) state.value = 'error';
      }
    };
    watch(current, analyze, { immediate: true });
    const level = (s) => (s >= CONFIDENCE.high ? ['Très probable', 'paid'] : s >= CONFIDENCE.low ? ['Probable', 'retail'] : ['Incertain', '']);
    return { current, state, progress, preview, results, indexSize, level, money, stockText, pname, CONFIDENCE };
  },
  template: `
    <Sheet :title="t('Reconnaître par photo')" size="narrow" @close="$emit('close')">
      <div class="stack">
        <div class="row top">
          <img v-if="preview" :src="preview" alt="" class="photo-thumb lg" />
          <div class="grow small muted">
            <template v-if="state === 'loading'">{{ t('Préparation de la reconnaissance (la première fois seulement)…') }}<template v-if="progress !== null && progress < 100"> {{ progress }} %</template></template>
            <template v-else-if="state === 'analyzing'">{{ t('Analyse de la photo…') }}</template>
            <span v-else-if="state === 'error'" style="color:var(--credit-ink)">{{ t('Reconnaissance indisponible sur cet appareil (modèle non installé sur l’ordinateur serveur, ou navigateur trop ancien).') }}</span>
            <template v-else-if="indexSize === 0">{{ t('Aucune photo de référence enregistrée. Ajoutez-en dans Produits (3 à 5 par produit).') }}</template>
            <template v-else-if="results[0] && results[0].score >= CONFIDENCE.low">{{ t('Lequel est-ce ?') }}</template>
            <template v-else>{{ t('Produit non reconnu. Rapprochez l’article ou utilisez la recherche.') }}</template>
          </div>
        </div>
        <div v-if="state === 'loading' || state === 'analyzing'" class="progress-bar"><i></i></div>
        <div v-if="state === 'done' && indexSize > 0" class="list" style="border:1px solid var(--line)">
          <button v-for="(r, i) in results" :key="r.productId" type="button" class="list-row" :class="{ best: i === 0 && r.score >= CONFIDENCE.low }" @click="$emit('pick', r.product)">
            <div class="main-col"><div class="title">{{ pname(r.product) }}</div><div class="sub">{{ money(r.product.retail_price) }} · {{ t('stock') }} {{ stockText(r.product) }}</div></div>
            <span class="badge" :class="level(r.score)[1]">{{ t(level(r.score)[0]) }} · {{ Math.round(r.score * 100) }} %</span>
          </button>
        </div>
        <p class="xsmall faint">{{ t('Le vendeur confirme toujours : rien n’est ajouté sans votre choix.') }}</p>
      </div>
      <template #foot>
        <PhotoButton :label="t('Reprendre la photo')" :disabled="state === 'loading' || state === 'analyzing'" @file="current = $event" />
      </template>
    </Sheet>`,
};
