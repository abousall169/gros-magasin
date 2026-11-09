// Graphiques SVG légers : recette par jour (barres) et répartition gros / détail.
import { ref, computed, onMounted, onUnmounted } from '../vue.js';
import { money, dayShort, percent } from '../format.js';

const compactFmt = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const compact = (n) => compactFmt.format(n).replace(/[  ]/g, ' ');

function niceStep(max, count) {
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

/** Barres verticales : une barre par jour, la dernière (aujourd'hui) mise en avant. */
export const BarChart = {
  props: {
    data: { type: Array, default: () => [] }, // [{ day, revenue, margin, count }]
    height: { type: Number, default: 220 },
    label: { type: String, default: 'Recette par jour' },
    highlightLast: { type: Boolean, default: true },
  },
  setup(props) {
    const box = ref(null);
    const width = ref(640);
    const hover = ref(-1);
    let ro = null;
    onMounted(() => {
      width.value = Math.max(260, Math.floor(box.value.getBoundingClientRect().width));
      ro = new ResizeObserver(([entry]) => {
        width.value = Math.max(260, Math.floor(entry.contentRect.width));
      });
      ro.observe(box.value);
    });
    onUnmounted(() => ro?.disconnect());

    const L = computed(() => {
      const pad = { l: 46, r: 8, t: 22, b: 26 };
      const w = width.value;
      const h = props.height;
      const innerW = w - pad.l - pad.r;
      const innerH = h - pad.t - pad.b;
      const max = Math.max(0, ...props.data.map((d) => d.revenue));
      const step = niceStep(max || 1, 4);
      const top = Math.max(step, Math.ceil((max || 1) / step) * step);
      const ticks = [];
      for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
      const n = Math.max(1, props.data.length);
      const band = innerW / n;
      const bw = Math.max(3, Math.min(24, band * 0.62));
      const maxIndex = props.data.reduce((best, d, i, a) => (d.revenue > (a[best]?.revenue ?? -1) ? i : best), 0);
      const bars = props.data.map((d, i) => {
        const bh = top ? (d.revenue / top) * innerH : 0;
        return {
          ...d,
          i,
          x: pad.l + i * band + (band - bw) / 2,
          y: pad.t + innerH - bh,
          w: bw,
          h: bh,
          cx: pad.l + i * band + band / 2,
          bandX: pad.l + i * band,
          band,
        };
      });
      const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(innerW / 46))));
      const y = (v) => pad.t + innerH - (top ? (v / top) * innerH : 0);
      return { pad, w, h, innerW, innerH, ticks, top, bars, every, y, maxIndex };
    });

    const barPath = (b) => {
      if (b.h <= 0.5) return '';
      const r = Math.min(4, b.w / 2, b.h);
      const x2 = b.x + b.w;
      const base = b.y + b.h;
      return `M${b.x},${base}V${b.y + r}Q${b.x},${b.y} ${b.x + r},${b.y}H${x2 - r}Q${x2},${b.y} ${x2},${b.y + r}V${base}Z`;
    };
    const xLabel = (day) => {
      const [, m, d] = day.split('-');
      return `${Number(d)}/${Number(m)}`;
    };
    const tip = computed(() => {
      const b = L.value.bars[hover.value];
      if (!b) return null;
      return { b, left: Math.min(Math.max(b.cx, 70), L.value.w - 70), top: Math.max(b.y, L.value.pad.t + 20) };
    });
    return { box, L, hover, tip, barPath, xLabel, compact, money, dayShort };
  },
  template: `
    <div class="chart-box" ref="box">
      <svg class="chart" :width="L.w" :height="L.h" :viewBox="'0 0 ' + L.w + ' ' + L.h" role="img" :aria-label="label">
        <g>
          <template v-for="t in L.ticks" :key="'t' + t">
            <line class="grid-line" :x1="L.pad.l" :x2="L.w - L.pad.r" :y1="L.y(t)" :y2="L.y(t)" />
            <text :x="L.pad.l - 8" :y="L.y(t) + 4" text-anchor="end">{{ compact(t) }}</text>
          </template>
        </g>
        <g v-for="b in L.bars" :key="b.day">
          <path :d="barPath(b)" class="bar" :class="{ today: highlightLast && b.i === L.bars.length - 1, hover: hover === b.i }" />
          <text v-if="b.i === L.maxIndex && b.revenue > 0 && hover < 0" class="cap" :x="b.cx" :y="b.y - 6" text-anchor="middle">{{ compact(b.revenue) }}</text>
          <text v-if="b.i === L.bars.length - 1 || (b.i % L.every === 0 && L.bars.length - 1 - b.i >= L.every)" :x="b.cx" :y="L.h - 6" text-anchor="middle">{{ xLabel(b.day) }}</text>
          <rect class="hit" :x="b.bandX" :y="L.pad.t" :width="b.band" :height="L.innerH" tabindex="0"
                :aria-label="dayShort(b.day) + ' : ' + money(b.revenue) + ', ' + b.count + ' ventes'"
                @pointerenter="hover = b.i" @pointerleave="hover = -1" @focus="hover = b.i" @blur="hover = -1" />
        </g>
      </svg>
      <div v-if="tip" class="chart-tip" :style="{ left: tip.left + 'px', top: tip.top + 'px' }">
        <strong>{{ money(tip.b.revenue) }}</strong>
        <div class="tip-sub">{{ dayShort(tip.b.day) }} · {{ tip.b.count }} vente{{ tip.b.count > 1 ? 's' : '' }}<template v-if="tip.b.margin !== null && tip.b.margin !== undefined"> · marge {{ money(tip.b.margin) }}</template></div>
      </div>
    </div>`,
};

/** Barre fine répartie en deux : détail / gros. */
export const SplitBar = {
  props: { retail: { type: Number, default: 0 }, wholesale: { type: Number, default: 0 } },
  setup(props) {
    const total = computed(() => (props.retail || 0) + (props.wholesale || 0));
    const share = (v) => (total.value ? (v / total.value) * 100 : 0);
    return { total, share, money, percent };
  },
  template: `
    <div class="split-wrap">
      <div class="split-bar" role="img" :aria-label="'Détail ' + money(retail) + ' (' + percent(share(retail)) + '), gros ' + money(wholesale) + ' (' + percent(share(wholesale)) + ')'">
        <i v-if="retail > 0" class="retail" :style="{ flexGrow: retail }" :title="'Détail : ' + money(retail) + ' — ' + percent(share(retail))"></i>
        <i v-if="wholesale > 0" class="wholesale" :style="{ flexGrow: wholesale }" :title="'Gros : ' + money(wholesale) + ' — ' + percent(share(wholesale))"></i>
      </div>
      <div class="split-legend">
        <span><i class="k retail"></i>Détail <b>{{ money(retail) }}</b> <span class="faint">{{ percent(share(retail)) }}</span></span>
        <span><i class="k wholesale"></i>Gros <b>{{ money(wholesale) }}</b> <span class="faint">{{ percent(share(wholesale)) }}</span></span>
      </div>
    </div>`,
};
