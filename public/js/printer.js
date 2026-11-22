// Imprimante de tickets thermique (58 ou 80 mm, ESC/POS) : le ticket est dessiné en image par le navigateur
// (texte arabe correctement formé et orienté, quelle que soit l'imprimante), puis envoyé au serveur
// qui le transmet à l'imprimante USB ou réseau.
import { api } from './api.js';
import { store, CASH } from './store.js';
import { t, pname, payLabel } from './i18n.js';
import { money, qty, plural, dateTimeFr, timeFr, saleNo, MODE_LABEL } from './format.js';
import { bars, encode, humanReadable } from './barcode.js';

const FONT = '"Noto Sans Arabic","Segoe UI",Tahoma,Arial,sans-serif';
const PAD = 12;
const MAX_H = 6000;
// Sens de lecture d'un texte d'après son contenu : un nom ou une adresse en français reste dans l'ordre
// même sur un ticket en arabe (sinon « 2 rue X » s'imprime « rue X 2 »).
const dirOf = (s) => (/[֐-ࣿיִ-﷿ﹰ-﻿]/.test(String(s)) ? 'rtl' : 'ltr');

/** L'imprimante de tickets est-elle réglée ? (sinon : impression du navigateur) */
export const hasThermal = () => !!store.settings.printer;

/** Petit moteur de mise en page d'un ticket sur un canvas (203 dpi : 576 points en 80 mm, 384 en 58 mm). */
class Ticket {
  constructor(paper = store.settings.receipt_width) {
    this.W = String(paper) === '58' ? 384 : 576;
    this.k = this.W === 384 ? 0.8 : 1;
    this.rtl = store.lang === 'ar';
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W;
    this.canvas.height = MAX_H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.ctx.fillStyle = '#fff';
    this.ctx.fillRect(0, 0, this.W, MAX_H);
    this.ctx.fillStyle = '#000';
    this.ctx.textBaseline = 'top';
    this.ctx.direction = this.rtl ? 'rtl' : 'ltr';
    this.y = 8;
  }
  px(size) {
    return Math.round(size * this.k);
  }
  font(size, bold) {
    this.ctx.font = `${bold ? '700 ' : '400 '}${this.px(size)}px ${FONT}`;
  }
  wrap(text, size, bold, width = this.W - 2 * PAD) {
    this.font(size, bold);
    const lines = [];
    let cur = '';
    for (const w of String(text ?? '').split(/\s+/)) {
      const test = cur ? `${cur} ${w}` : w;
      if (this.ctx.measureText(test).width > width && cur) {
        lines.push(cur);
        cur = w;
      } else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  text(s, x, align) {
    this.ctx.direction = dirOf(s);
    this.ctx.textAlign = align;
    this.ctx.fillText(s, x, this.y);
  }
  center(text, size = 24, bold = false) {
    for (const l of this.wrap(text, size, bold)) {
      this.font(size, bold);
      this.text(l, this.W / 2, 'center');
      this.y += Math.round(this.px(size) * 1.35);
    }
  }
  start(text, size = 24, bold = false) {
    for (const l of this.wrap(text, size, bold)) {
      this.font(size, bold);
      this.text(l, this.rtl ? this.W - PAD : PAD, this.rtl ? 'right' : 'left');
      this.y += Math.round(this.px(size) * 1.35);
    }
  }
  row(a, b, size = 24, bold = false) {
    this.font(size, bold);
    const bw = this.ctx.measureText(b).width;
    const lines = this.wrap(a, size, bold, this.W - 2 * PAD - bw - 16);
    lines.forEach((l, i) => {
      this.font(size, bold);
      this.text(l, this.rtl ? this.W - PAD : PAD, this.rtl ? 'right' : 'left');
      if (i === 0) this.text(b, this.rtl ? PAD : this.W - PAD, this.rtl ? 'left' : 'right');
      this.y += Math.round(this.px(size) * 1.35);
    });
  }
  rule() {
    for (let x = PAD; x < this.W - PAD; x += 12) this.ctx.fillRect(x, this.y + 6, 6, 2);
    this.y += 16;
  }
  gap(n = 8) {
    this.y += n;
  }
  barcode(code, height = 110) {
    const enc = encode(code);
    if (!enc) return;
    const module = Math.max(2, Math.min(4, Math.floor((this.W - 40) / enc.bits.length)));
    const x0 = Math.round((this.W - enc.bits.length * module) / 2);
    for (const b of bars(enc.bits)) this.ctx.fillRect(x0 + b.x * module, this.y, b.w * module, height);
    this.y += height + 6;
    this.ctx.direction = 'ltr';
    this.ctx.font = `600 ${this.px(26)}px Consolas, "Courier New", monospace`;
    for (const d of humanReadable(enc)) {
      this.ctx.textAlign = d.anchor === 'start' ? 'left' : 'center';
      this.ctx.fillText(d.s, x0 + d.x * module, this.y);
    }
    this.ctx.direction = this.rtl ? 'rtl' : 'ltr';
    this.y += 36;
  }
  header() {
    const s = store.settings;
    this.center(s.store_name, 34, true);
    if (s.store_address) this.center(s.store_address, 20);
    if (s.store_phone) this.center(`${t('Tél.')} ${s.store_phone}`, 20);
    if (s.store_tax_id) this.center(s.store_tax_id, 20);
  }
  /** Image 1 bit (1 = noir), 8 points par octet, encodée en base64. */
  bitmap() {
    const height = Math.min(Math.ceil(this.y + 8), MAX_H);
    const { data } = this.ctx.getImageData(0, 0, this.W, height);
    const bpr = this.W / 8;
    const out = new Uint8Array(bpr * height);
    for (let yy = 0; yy < height; yy++) {
      for (let x = 0; x < this.W; x++) {
        const i = (yy * this.W + x) * 4;
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (lum < 150) out[yy * bpr + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    let bin = '';
    for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return { width: this.W, height, data: btoa(bin) };
  }
  send() {
    return api.post('/print', this.bitmap());
  }
}

const itemName = (it) => (store.lang === 'ar' && it.name_ar) || it.name;

/** Ticket de caisse. */
export function sendSaleTicket(sale) {
  const s = store.settings;
  const tk = new Ticket();
  tk.header();
  tk.gap(4);
  tk.center(`${sale.id ? `${t('Ticket')} ${saleNo(sale.id)}` : t('Vente hors ligne')} — ${t(MODE_LABEL[sale.mode] || '')}`, 22);
  tk.center(`${dateTimeFr(sale.created_at)} · ${sale.user_name || ''}`, 22);
  if (sale.seller_name) tk.center(`${t('Vendeur')} : ${sale.seller_name}`, 22);
  if (sale.customer_name) tk.center(`${t('Client')} : ${sale.customer_name}`, 22, true);
  if (sale.status === 'cancelled') tk.center(`*** ${t('VENTE ANNULÉE')} ***`, 28, true);
  tk.rule();
  for (const it of sale.items || []) {
    tk.start(`${itemName(it)}${it.sale_type === 'wholesale' ? ` (${t('gros')})` : ''}`, 24, true);
    tk.row(`${qty(it.qty)} ${plural(it.unit_label, it.qty)} × ${money(it.unit_price, { bare: true })}`, money(it.total, { bare: true }), 24);
    if (it.returned_qty > 0) tk.row(`  ${t('Retourné')} : ${qty(it.returned_qty)}`, '', 20);
    tk.gap(4);
  }
  tk.rule();
  if (sale.discount > 0) {
    tk.row(t('Sous-total'), money(sale.subtotal));
    tk.row(t('Remise'), `−${money(sale.discount, { bare: true })}`);
  }
  tk.row(t('TOTAL'), money(sale.total), 32, true);
  if (sale.tax_total > 0) tk.row(t('dont TVA'), money(sale.tax_total), 22);
  for (const p of sale.payments || []) {
    tk.row(payLabel(p.method), money(p.amount, { bare: true }));
    if (p.reference) tk.row(`  ${t('N° de transaction')}`, p.reference, 20);
  }
  if (sale.received > sale.paid) tk.row(t('Reçu'), money(sale.received, { bare: true }));
  if (sale.change_given > 0) tk.row(t('Rendu'), money(sale.change_given, { bare: true }), 26, true);
  const credit = Math.max(0, sale.total - (sale.paid || 0));
  if (credit > 0.004) tk.row(t('Reste à payer (crédit)'), money(credit, { bare: true }), 24, true);
  if (sale.refunded_total > 0) tk.row(t('Retours'), `−${money(sale.refunded_total, { bare: true })}`, 22);
  if (s.receipt_show_balance && sale.customer_id && sale.customer_balance !== undefined) {
    tk.rule();
    tk.row(t('Solde du compte client'), money(sale.customer_balance), 22, true);
  }
  if (s.receipt_footer) {
    tk.gap(10);
    tk.center(s.receipt_footer, 22);
  }
  return tk.send();
}

/** Reçu de versement d'un client. */
export function sendPaymentReceipt(payment, customer) {
  const tk = new Ticket();
  tk.header();
  tk.rule();
  tk.center(t('REÇU DE VERSEMENT'), 26, true);
  tk.center(dateTimeFr(payment.created_at), 22);
  tk.center(`${t('Client')} : ${customer.name}`, 22, true);
  tk.rule();
  tk.row(t('Montant versé'), money(payment.amount), 30, true);
  tk.row(t('Mode'), payLabel(payment.method));
  tk.row(t('Reste dû'), money(payment.balance), 24, true);
  if (payment.note) tk.start(payment.note, 20);
  if (store.settings.receipt_footer) {
    tk.gap(10);
    tk.center(store.settings.receipt_footer, 22);
  }
  return tk.send();
}

/** Ticket de clôture d'une session de caisse. */
export function sendSessionReport(session) {
  const b = session.breakdown || {};
  const tk = new Ticket();
  tk.header();
  tk.rule();
  tk.center(t('CLÔTURE DE CAISSE'), 26, true);
  tk.center(session.user_name ? `${t('Caisse de')} ${session.user_name}` : t('Tout le magasin'), 22);
  tk.center(`${dateTimeFr(session.opened_at)} → ${dateTimeFr(session.closed_at)}`, 20);
  tk.rule();
  tk.row(t('Fond de caisse'), money(b.opening_float, { bare: true }));
  tk.row(`+ ${t('Ventes en espèces')}`, money(b.sales, { bare: true }));
  tk.row(`+ ${t('Versements des clients')}`, money(b.payments, { bare: true }));
  if (b.refunds) tk.row(`− ${t('Retours remboursés')}`, money(b.refunds, { bare: true }));
  tk.row(`− ${t('Dépenses')}`, money(b.expenses, { bare: true }));
  if (b.suppliers) tk.row(`− ${t('Paiements fournisseurs')}`, money(b.suppliers, { bare: true }));
  tk.rule();
  tk.row(t('Espèces attendues'), money(session.expected), 24, true);
  tk.row(t('Espèces comptées'), money(session.counted), 24, true);
  tk.row(t('Écart'), money(session.difference, { sign: true }), 26, true);
  if (b.count != null) {
    tk.rule();
    tk.row(`${t('Ventes encaissées')} (${b.count})`, money(b.sales_total, { bare: true }));
    if (b.credit > 0) tk.row(t('dont à crédit'), money(b.credit, { bare: true }));
  }
  if (b.methods?.length) {
    tk.start(t('Encaissé hors espèces'), 20, true);
    for (const m of b.methods) tk.row(payLabel(m.method), money(m.amount, { bare: true }));
  }
  if (b.expense_items?.length) {
    tk.rule();
    tk.start(t('Dépenses'), 20, true);
    for (const e of b.expense_items) {
      tk.row(`${timeFr(e.created_at)} ${e.category}${e.method !== CASH ? ` (${payLabel(e.method)})` : ''}`, money(e.amount, { bare: true }));
      if (e.note) tk.start(`  ${e.note}`, 18);
    }
  }
  if (session.note) tk.start(session.note, 20);
  tk.gap(10);
  tk.start(`${t('Clôturée par')} ${session.closed_by_name || ''}`, 20);
  tk.gap(30);
  tk.start(`${t('Signature')} :`, 20);
  tk.gap(40);
  return tk.send();
}

/** Étiquette produit (nom, prix, code-barres), imprimée seule puis coupée. */
export function sendLabel(product, { showPrice = true, priceType = 'retail' } = {}) {
  const tk = new Ticket();
  tk.gap(6);
  tk.center(pname(product), 32, true);
  if (store.lang !== 'ar' && product.name_ar) tk.center(product.name_ar, 28);
  if (showPrice) {
    const price = priceType === 'wholesale' ? product.wholesale_price : product.retail_price;
    const unit = priceType === 'wholesale' && product.pack_unit ? product.pack_unit : product.unit;
    tk.center(`${money(price)} / ${unit}`, 40, true);
  }
  tk.gap(8);
  tk.barcode(product.barcode);
  return tk.send();
}

/** Ticket d'essai (réglages de l'imprimante). */
export function sendTestTicket() {
  const tk = new Ticket();
  tk.header();
  tk.rule();
  tk.center(t('Ticket d’essai'), 28, true);
  tk.center(dateTimeFr(new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().replace('T', ' ')), 22);
  tk.rule();
  tk.row('Riz 25 kg (gros)', money(14500, { bare: true }));
  tk.row('Huile 1 L × 3', money(3900, { bare: true }));
  tk.row('سكر 1 كغ', money(800, { bare: true }));
  tk.rule();
  tk.row(t('TOTAL'), money(19200), 32, true);
  tk.row(payLabel(CASH), money(20000, { bare: true }));
  tk.row(t('Rendu'), money(800, { bare: true }), 26, true);
  tk.gap(8);
  tk.barcode('2000000000015', 80);
  return tk.send();
}
