// Page d'aide pour installer l'autorité de certification sur un téléphone / une tablette (une seule fois par appareil).
import { Router } from 'express';
import { tlsState } from './tls.js';

const page = (httpsPort) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#161d52">
<title>Installer la caisse sur cet appareil</title>
<style>
 body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Arabic",Arial,sans-serif;margin:0;background:#f2f3f8;color:#141832;line-height:1.45}
 header{background:#161d52;color:#eceefb;padding:20px 16px}
 header h1{margin:0;font-size:1.4375rem}
 header p{margin:6px 0 0;color:#a8aed8}
 main{max-width:640px;margin:0 auto;padding:16px}
 .card{background:#fff;border-radius:12px;padding:16px;margin:12px 0}
 h2{font-size:1.1875rem;margin:0 0 8px}
 a.btn{display:flex;align-items:center;justify-content:center;min-height:52px;background:#161d52;color:#fff;text-decoration:none;font-weight:700;border-radius:12px;font-size:1.0625rem}
 ol{padding-inline-start:20px;margin:6px 0}
 li{margin:4px 0}
 .muted{color:#5f6587;font-size:.875rem}
 .ar{direction:rtl;text-align:right}
</style></head><body>
<header><h1>Installer la caisse sur cet appareil</h1><p>À faire une seule fois par téléphone ou tablette.</p></header>
<main>
<p>Cette étape permet d'utiliser la <b>caméra</b> (scan des codes-barres, reconnaissance par photo) et de continuer à vendre <b>sans réseau</b>.</p>
<div class="card"><h2>1. Télécharger le certificat du magasin</h2><a class="btn" href="/ca.crt">Télécharger le certificat</a></div>
<div class="card"><h2>2. L'installer</h2>
 <p><b>Android</b></p>
 <ol><li>Ouvrez <i>Paramètres › Sécurité › Plus de paramètres › Chiffrement et identifiants › Installer un certificat › Certificat CA</i>.</li>
 <li>Choisissez « Installer quand même », puis le fichier téléchargé <i>caisse-ca.crt</i>.</li></ol>
 <p><b>iPhone / iPad</b></p>
 <ol><li>Autorisez le téléchargement du profil, puis <i>Réglages › Profil téléchargé › Installer</i>.</li>
 <li>Puis <i>Réglages › Général › Informations › Réglages des certificats</i> : activez « Caisse Gros et Detail ».</li></ol>
</div>
<div class="card"><h2>3. Ouvrir la caisse en connexion sécurisée</h2>
 <a class="btn" id="go" href="#">Ouvrir la caisse</a>
 <p class="muted">Ensuite, dans le menu du navigateur : « Ajouter à l'écran d'accueil ».</p></div>
<div class="card ar" lang="ar"><h2>بالعربية</h2>
 <p>تُنفَّذ هذه الخطوات <b>مرة واحدة</b> على كل هاتف أو جهاز لوحي: (1) حمّل الشهادة، (2) ثبّتها من إعدادات الأمان (أندرويد: «تثبيت شهادة ← شهادة CA»، آيفون: «الملف الشخصي المُنزَّل» ثم «إعدادات الشهادات»)، (3) افتح الصندوق عبر الزر أعلاه. بعد ذلك تعمل الكاميرا والبيع دون اتصال.</p></div>
<div class="card" lang="en"><h2>In English</h2>
 <p>Do this <b>once</b> per phone or tablet: (1) download the certificate, (2) install it from the security settings (Android: “Install a certificate › CA certificate”; iPhone: “Profile downloaded”, then “Certificate Trust Settings”), (3) open the till with the button above. The camera and offline sales will then work.</p></div>
<script>document.getElementById('go').href='https://'+location.hostname+':${httpsPort}/'</script>
</main></body></html>`;

const r = Router();

r.get('/install', (req, res) => {
  if (!tlsState.enabled) return res.redirect('/');
  res.type('text/html; charset=utf-8').send(page(tlsState.httpsPort));
});

r.get('/ca.crt', (req, res) => {
  if (!tlsState.caPem) return res.status(404).send('HTTPS désactivé.');
  res.setHeader('Content-Type', 'application/x-x509-ca-cert');
  res.setHeader('Content-Disposition', 'attachment; filename="caisse-ca.crt"');
  res.send(tlsState.caPem);
});

export default r;
