// Prépare la reconnaissance par photo : le modèle et le moteur WebAssembly sont ensuite servis par l'ordinateur
// du magasin (aucun accès Internet nécessaire pour vendre). Idempotent : ne retélécharge pas ce qui existe déjà.
// Lancé automatiquement par « npm install » ; à relancer à la main avec « npm run setup-vision ».
import { existsSync, mkdirSync, writeFileSync, statSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');

// Doit correspondre à la version d'onnxruntime-web incluse dans public/vendor/transformers.min.js (4.3.2).
const ORT_VERSION = '1.31.0-dev.20260914-8d85527a0';
const MODEL = 'Xenova/dinov2-small';

const has = (p) => existsSync(p) && statSync(p).size > 0;

async function download(url, dst) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  mkdirSync(path.dirname(dst), { recursive: true });
  writeFileSync(dst, Buffer.from(await res.arrayBuffer()));
}

try {
  // 1) Moteur ONNX Runtime (WebAssembly) : plusieurs variantes, le navigateur choisit celle qu'il supporte.
  const localOrt = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
  for (const v of ['asyncify', 'jspi', '']) {
    for (const ext of ['mjs', 'wasm']) {
      const file = `ort-wasm-simd-threaded${v ? `.${v}` : ''}.${ext}`;
      const dst = path.join(pub, 'vendor', 'ort', file);
      if (has(dst)) continue;
      if (existsSync(path.join(localOrt, file))) {
        mkdirSync(path.dirname(dst), { recursive: true });
        copyFileSync(path.join(localOrt, file), dst);
      } else {
        console.log(`  Reconnaissance par photo : téléchargement de ${file}…`);
        await download(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/${file}`, dst);
      }
    }
  }

  // 2) Modèle DINOv2-small quantifié (~24 Mo)
  for (const f of ['config.json', 'preprocessor_config.json', 'onnx/model_quantized.onnx']) {
    const dst = path.join(pub, 'models', MODEL, f);
    if (has(dst)) continue;
    console.log(`  Reconnaissance par photo : téléchargement du modèle (${f})…`);
    await download(`https://huggingface.co/${MODEL}/resolve/main/${f}`, dst);
  }
} catch (e) {
  console.warn(`  Reconnaissance par photo indisponible pour l'instant (${e.message}).`);
  console.warn('  Relancez « npm run setup-vision » avec une connexion Internet pour l’activer.');
}
