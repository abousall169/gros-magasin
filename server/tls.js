// HTTPS local : les navigateurs n'autorisent la caméra (scan) et le mode hors ligne qu'en connexion sécurisée.
// Le serveur crée sa propre autorité de certification (une seule fois) ; chaque téléphone l'installe une fois
// via /install, puis le certificat du serveur peut être renouvelé sans rien refaire sur les appareils.
import forge from 'node-forge';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DATA_DIR } from './db.js';

const DAY = 86400_000;
const CERT_DIR = path.join(DATA_DIR, 'certs');
const f = (n) => path.join(CERT_DIR, n);

/** État partagé avec les routes (adresses affichées, page d'installation). */
export const tlsState = { enabled: false, httpPort: 3000, httpsPort: 3443, caPem: '' };

function lanIPv4() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.'))
    .map((n) => n.address);
}

// Clé RSA générée par node:crypto (rapide), convertie pour node-forge.
function newKey() {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const priv = forge.pki.privateKeyFromPem(privateKey);
  return { pem: privateKey, priv, pub: forge.pki.setRsaPublicKey(priv.n, priv.e) };
}

const serial = () => `01${randomBytes(15).toString('hex')}`;

function makeCA() {
  const k = newKey();
  const cert = forge.pki.createCertificate();
  cert.publicKey = k.pub;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - DAY);
  cert.validity.notAfter = new Date(Date.now() + 3650 * DAY);
  // Sans accent : « é » est interdit dans ce champ et ferait refuser le certificat
  const subject = [
    { name: 'commonName', value: 'Caisse Gros et Detail - Autorite locale' },
    { name: 'organizationName', value: 'Caisse Gros et Detail' },
  ];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(k.priv, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: k.pem };
}

function makeLeaf(ca, names, ips) {
  const k = newKey();
  const caCert = forge.pki.certificateFromPem(ca.certPem);
  const caKey = forge.pki.privateKeyFromPem(ca.keyPem);
  const cert = forge.pki.createCertificate();
  cert.publicKey = k.pub;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - DAY);
  cert.validity.notAfter = new Date(Date.now() + 800 * DAY); // < 825 jours : limite d'iOS
  cert.setSubject([{ name: 'commonName', value: 'Caisse Gros et Detail' }]);
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    {
      name: 'subjectAltName',
      altNames: [...names.map((value) => ({ type: 2, value })), ...ips.map((ip) => ({ type: 7, ip }))],
    },
    { name: 'subjectKeyIdentifier' },
    { name: 'authorityKeyIdentifier', keyIdentifier: caCert.generateSubjectKeyIdentifier().getBytes() },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: k.pem, notAfter: cert.validity.notAfter.getTime() };
}

/**
 * Crée l'autorité locale une seule fois, puis (ré)émet le certificat du serveur quand l'adresse IP
 * de l'ordinateur change ou qu'il expire bientôt.
 */
export function ensureTls() {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  if (!fs.existsSync(f('ca.pem')) || !fs.existsSync(f('ca-key.pem'))) {
    const ca = makeCA();
    fs.writeFileSync(f('ca.pem'), ca.certPem);
    fs.writeFileSync(f('ca-key.pem'), ca.keyPem, { mode: 0o600 });
    console.log('  Autorité de certification locale créée (data/certs).');
  }
  const ca = { certPem: fs.readFileSync(f('ca.pem'), 'utf8'), keyPem: fs.readFileSync(f('ca-key.pem'), 'utf8') };

  const host = os.hostname().toLowerCase();
  const extra = (process.env.TLS_NAMES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const isIp = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
  const names = [...new Set(['localhost', host, `${host}.local`, ...extra.filter((s) => !isIp(s))])];
  const ips = [...new Set(['127.0.0.1', ...lanIPv4(), ...extra.filter(isIp)])];
  const want = JSON.stringify({ names: [...names].sort(), ips: [...ips].sort() });

  let meta = null;
  try {
    meta = JSON.parse(fs.readFileSync(f('server.json'), 'utf8'));
  } catch {
    /* première fois */
  }
  if (!meta || meta.want !== want || meta.notAfter - Date.now() < 30 * DAY || !fs.existsSync(f('server.pem'))) {
    const leaf = makeLeaf(ca, names, ips);
    fs.writeFileSync(f('server.pem'), leaf.certPem);
    fs.writeFileSync(f('server-key.pem'), leaf.keyPem, { mode: 0o600 });
    fs.writeFileSync(f('server.json'), JSON.stringify({ want, notAfter: leaf.notAfter }));
    console.log(`  Certificat HTTPS émis pour : ${[...names, ...ips].join(', ')}`);
  }
  return { key: fs.readFileSync(f('server-key.pem')), cert: fs.readFileSync(f('server.pem')), caPem: ca.certPem };
}
