// Impression des tickets (imprimante thermique ESC/POS si réglée, sinon navigateur 58/80 mm),
// factures A4, relevés, clôtures, étiquettes ; partage par WhatsApp ou SMS.
import { store, CASH, toast } from './store.js';
import { t, pname, payLabel } from './i18n.js';
import { money, qty, dateTimeFr, timeFr, dateFr, saleNo, amountInWords, MODE_LABEL, plural, dayLong } from './format.js';
import { hasThermal, sendSaleTicket, sendPaymentReceipt, sendSessionReport } from './printer.js';
import { barcodeSvg, encode } from './barcode.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function printHTML(html, format) {
  const area = document.getElementById('print-area');
  let style = document.getElementById('print-page-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'print-page-style';
    document.head.appendChild(style);
  }
  const page = {
    58: '@page { size: 58mm auto; margin: 0; }',
    80: '@page { size: 80mm auto; margin: 0; }',
    a4: '@page { size: A4; margin: 14mm 12mm; }',
    labels: '@page { size: A4; margin: 0; }',
  }[format];
  style.textContent = `@media print { ${page} }`;
  area.innerHTML = html;
  setTimeout(() => {
    window.print();
    setTimeout(() => {
      area.innerHTML = '';
    }, 500);
  }, 60);
}

/** Envoi à l'imprimante thermique avec message de réussite ou d'échec. */
async function thermal(job) {
  try {
    await job();
    toast(t('Ticket envoyé à l’imprimante.'), 'success');
    return true;
  } catch (e) {
    toast(`${t('Impression impossible')} : ${e.message}`, 'error', 6000);
    return false;
  }
}

function storeHeader(center = true) {
  const s = store.settings;
  const lines = [s.store_address, s.store_phone && `${t('Tél.')} ${s.store_phone}`, s.store_tax_id].filter(Boolean);
  return `<h1${center ? '' : ' style="text-align:left"'}>${esc(s.store_name)}</h1>${lines.map((l) => `<div class="${center ? 'c' : ''}">${esc(l)}</div>`).join('')}`;
}

const itemQty = (it) => `${qty(it.qty)} ${esc(plural(it.unit_label, it.qty))}`;
const itemName = (it) => esc((store.lang === 'ar' && it.name_ar) || it.name);
const dirAttr = () => (store.lang === 'ar' ? ' dir="rtl"' : '');

// ---- Ticket de caisse -----------------------------------------------------------------
export function printTicket(sale) {
  if (hasThermal()) return thermal(() => sendSaleTicket(sale));
  const s = store.settings;
  const w = s.receipt_width === '58' ? '58' : '80';
  const credit = Math.max(0, sale.total - (sale.paid || 0));
  const rows = (sale.items || [])
    .map(
      (it) => `
      <tr><td colspan="2">${itemName(it)}${it.sale_type === 'wholesale' ? ` <b>(${esc(t('gros'))})</b>` : ''}</td></tr>
      <tr><td class="item-sub">${itemQty(it)} × ${money(it.unit_price, { bare: true })}${it.returned_qty > 0 ? ` · ${esc(t('Retourné'))} ${qty(it.returned_qty)}` : ''}</td><td class="r">${money(it.total, { bare: true })}</td></tr>`,
    )
    .join('');
  const pays = (sale.payments || [])
    .map(
      (p) =>
        `<tr><td>${esc(payLabel(p.method))}${p.reference ? `<br><small>${esc(t('N° de transaction'))} ${esc(p.reference)}</small>` : ''}</td><td class="r">${money(p.amount, { bare: true })}</td></tr>`,
    )
    .join('');
  const html = `
  <div class="rcpt w${w}"${dirAttr()}>
    ${storeHeader()}
    <div class="hr"></div>
    <div>${sale.id ? `${esc(t('Ticket'))} ${saleNo(sale.id)}` : esc(t('Vente hors ligne'))} — ${esc(t(MODE_LABEL[sale.mode] || ''))}</div>
    <div>${dateTimeFr(sale.created_at)} · ${esc(sale.user_name)}</div>
    ${sale.seller_name ? `<div>${esc(t('Vendeur'))} : ${esc(sale.seller_name)}</div>` : ''}
    ${sale.customer_name ? `<div>${esc(t('Client'))} : <b>${esc(sale.customer_name)}</b></div>` : ''}
    <div class="hr"></div>
    <table>${rows}</table>
    <div class="hr"></div>
    <table>
      ${sale.discount > 0 ? `<tr><td>${esc(t('Sous-total'))}</td><td class="r">${money(sale.subtotal, { bare: true })}</td></tr><tr><td>${esc(t('Remise'))}</td><td class="r">−${money(sale.discount, { bare: true })}</td></tr>` : ''}
      <tr class="tot"><td>${esc(t('TOTAL'))}</td><td class="r">${money(sale.total)}</td></tr>
      ${sale.tax_total > 0 ? `<tr><td>${esc(t('dont TVA'))}</td><td class="r">${money(sale.tax_total, { bare: true })}</td></tr>` : ''}
      ${pays}
      ${sale.received > sale.paid ? `<tr><td>${esc(t('Reçu'))}</td><td class="r">${money(sale.received, { bare: true })}</td></tr>` : ''}
      ${sale.change_given > 0 ? `<tr><td>${esc(t('Rendu'))}</td><td class="r">${money(sale.change_given, { bare: true })}</td></tr>` : ''}
      ${credit > 0.004 ? `<tr><td><b>${esc(t('Reste à payer (crédit)'))}</b></td><td class="r"><b>${money(credit, { bare: true })}</b></td></tr>` : ''}
      ${sale.refunded_total > 0 ? `<tr><td>${esc(t('Retours'))}</td><td class="r">−${money(sale.refunded_total, { bare: true })}</td></tr>` : ''}
    </table>
    ${s.receipt_show_balance && sale.customer_id && sale.customer_balance !== undefined ? `<div class="hr"></div><div>${esc(t('Solde du compte client'))} : <b>${money(sale.customer_balance)}</b></div>` : ''}
    ${sale.status === 'cancelled' ? `<div class="c"><span class="stamp">${esc(t('VENTE ANNULÉE'))}</span></div>` : ''}
    <div class="hr"></div>
    ${s.receipt_footer ? `<div class="c">${esc(s.receipt_footer)}</div>` : ''}
  </div>`;
  printHTML(html, w);
  return Promise.resolve(true);
}

// ---- Facture A4 (ou proforma) ------------------------------------------------------
export function printInvoice(sale, { proforma = false } = {}) {
  const s = store.settings;
  const credit = Math.max(0, sale.total - (sale.paid || 0));
  const rows = sale.items
    .map(
      (it, i) => `<tr>
        <td>${i + 1}</td>
        <td>${esc(it.name)}${it.returned_qty > 0 ? ` <small>(retourné : ${qty(it.returned_qty)})</small>` : ''}</td>
        <td>${it.sale_type === 'wholesale' ? 'Gros' : 'Détail'}</td>
        <td class="r">${qty(it.qty)}</td>
        <td>${esc(plural(it.unit_label, it.qty))}</td>
        <td class="r">${money(it.unit_price, { bare: true })}</td>
        <td class="r">${money(it.total, { bare: true })}</td>
      </tr>`,
    )
    .join('');
  const title = proforma ? 'FACTURE PROFORMA' : 'FACTURE';
  const html = `
  <div class="inv">
    <div class="inv-head">
      <div>${storeHeader(false)}</div>
      <div>
        <h2>${title}</h2>
        ${proforma ? '' : `<div style="text-align:right">${saleNo(sale.id)}</div>`}
        <div style="text-align:right">Date : ${dateFr(sale.created_at)}</div>
        ${proforma ? '<div style="text-align:right">Valable 7 jours</div>' : `<div style="text-align:right">Vendeur : ${esc(sale.user_name || '')}</div>`}
      </div>
    </div>
    <div class="who">
      <div class="box"><b>Client</b><br>${esc(sale.customer_name || 'Client comptoir')}${sale.customer_phone ? `<br>Tél : ${esc(sale.customer_phone)}` : ''}${sale.customer_address ? `<br>${esc(sale.customer_address)}` : ''}</div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Désignation</th><th>Vente</th><th class="r">Qté</th><th>Unité</th><th class="r">Prix unitaire</th><th class="r">Montant</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="totals">
      ${sale.discount > 0 ? `<tr><td>Sous-total</td><td class="r">${money(sale.subtotal)}</td></tr><tr><td>Remise</td><td class="r">−${money(sale.discount)}</td></tr>` : ''}
      <tr class="grand"><td>TOTAL TTC</td><td class="r">${money(sale.total)}</td></tr>
      ${sale.tax_total > 0 ? `<tr><td>dont TVA</td><td class="r">${money(sale.tax_total)}</td></tr><tr><td>Total hors taxes</td><td class="r">${money(sale.total - sale.tax_total)}</td></tr>` : ''}
      ${proforma ? '' : `<tr><td>Payé</td><td class="r">${money(sale.paid)}</td></tr>${credit > 0 ? `<tr><td><b>Reste à payer</b></td><td class="r"><b>${money(credit)}</b></td></tr>` : ''}`}
      ${sale.refunded_total > 0 ? `<tr><td>Retours remboursés</td><td class="r">−${money(sale.refunded_total)}</td></tr>` : ''}
    </table>
    <p class="words">Arrêtée la présente ${proforma ? 'facture proforma' : 'facture'} à la somme de : <b>${esc(amountInWords(sale.total))}</b>.</p>
    ${!proforma && sale.payments?.length ? `<p>Règlement : ${sale.payments.map((p) => `${esc(p.method)} ${money(p.amount)}${p.reference ? ` (réf. ${esc(p.reference)})` : ''}`).join(' · ')}${credit > 0 ? ` · Crédit ${money(credit)}` : ''}</p>` : ''}
    ${sale.status === 'cancelled' ? '<p><b>FACTURE ANNULÉE</b></p>' : ''}
    <div class="signs"><div>Le client</div><div>Pour ${esc(s.store_name)}</div></div>
    ${s.receipt_footer ? `<div class="foot">${esc(s.receipt_footer)}</div>` : ''}
  </div>`;
  printHTML(html, 'a4');
}

// ---- Reçu de versement client --------------------------------------------------------
export function printPaymentReceipt(payment, customer) {
  if (hasThermal()) return thermal(() => sendPaymentReceipt(payment, customer));
  const s = store.settings;
  const w = s.receipt_width === '58' ? '58' : '80';
  const html = `
  <div class="rcpt w${w}"${dirAttr()}>
    ${storeHeader()}
    <div class="hr"></div>
    <div class="c"><b>${esc(t('REÇU DE VERSEMENT'))}</b></div>
    <div>${dateTimeFr(payment.created_at)}</div>
    <div>${esc(t('Client'))} : <b>${esc(customer.name)}</b></div>
    <div class="hr"></div>
    <table>
      <tr class="tot"><td>${esc(t('Montant versé'))}</td><td class="r">${money(payment.amount)}</td></tr>
      <tr><td>${esc(t('Mode'))}</td><td class="r">${esc(payLabel(payment.method))}</td></tr>
      <tr><td>${esc(t('Reste dû'))}</td><td class="r"><b>${money(payment.balance)}</b></td></tr>
    </table>
    ${payment.note ? `<div>${esc(payment.note)}</div>` : ''}
    <div class="hr"></div>
    <div class="c">${esc(s.receipt_footer || '')}</div>
  </div>`;
  printHTML(html, w);
}

// ---- Relevé de compte client (A4) ---------------------------------------------------
export function printStatement(customer, ledger) {
  const rows = ledger
    .slice()
    .reverse()
    .map(
      (r) => `<tr>
        <td>${dateTimeFr(r.date)}</td>
        <td>${esc(r.label)}</td>
        <td class="r">${r.debit ? money(r.debit, { bare: true }) : ''}</td>
        <td class="r">${r.credit ? money(r.credit, { bare: true }) : ''}</td>
        <td class="r">${money(r.balance, { bare: true })}</td>
      </tr>`,
    )
    .join('');
  const html = `
  <div class="inv">
    <div class="inv-head">
      <div>${storeHeader(false)}</div>
      <div><h2>RELEVÉ DE COMPTE</h2><div style="text-align:right">Au ${dateFr(new Date().toISOString())}</div></div>
    </div>
    <div class="who"><div class="box"><b>${esc(customer.name)}</b>${customer.phone ? `<br>Tél : ${esc(customer.phone)}` : ''}${customer.address ? `<br>${esc(customer.address)}` : ''}</div></div>
    <table>
      <thead><tr><th>Date</th><th>Opération</th><th class="r">Achat à crédit</th><th class="r">Versement / retour</th><th class="r">Solde</th></tr></thead>
      <tbody>${customer.opening_balance ? `<tr><td></td><td>Solde antérieur</td><td class="r">${money(customer.opening_balance, { bare: true })}</td><td></td><td></td></tr>` : ''}${rows}</tbody>
    </table>
    <table class="totals"><tr class="grand"><td>Solde dû</td><td class="r">${money(customer.balance)}</td></tr></table>
    <p class="words">Arrêté le présent relevé à la somme de : <b>${esc(amountInWords(Math.max(0, customer.balance)))}</b>.</p>
  </div>`;
  printHTML(html, 'a4');
}

// ---- Clôture de caisse : journée (navigateur) et session (thermique si réglée) -------------
export function printCashReport(r) {
  const s = store.settings;
  const w = s.receipt_width === '58' ? '58' : '80';
  const line = (label, v, bold) => `<tr><td>${bold ? '<b>' : ''}${esc(label)}${bold ? '</b>' : ''}</td><td class="r">${bold ? '<b>' : ''}${money(v, { bare: true })}${bold ? '</b>' : ''}</td></tr>`;
  const html = `
  <div class="rcpt w${w}"${dirAttr()}>
    ${storeHeader()}
    <div class="hr"></div>
    <div class="c"><b>${esc(t('RÉSUMÉ DE LA JOURNÉE'))}</b></div>
    <div class="c">${esc(dayLong(r.date))}</div>
    <div class="c">${r.user ? `${esc(t('Vendeur'))} : ${esc(r.user.name)}` : esc(t('Tout le magasin'))}</div>
    <div class="hr"></div>
    <table>
      ${line(`${t('Ventes')} (${r.sales.count})`, r.sales.total, true)}
      ${r.sales.credit > 0 ? line(t('dont à crédit'), r.sales.credit) : ''}
      ${r.sales.discount > 0 ? line(t('Remises accordées'), r.sales.discount) : ''}
      ${r.cancelled.count ? line(`${t('Ventes annulées')} (${r.cancelled.count})`, r.cancelled.total) : ''}
    </table>
    <div class="hr"></div>
    <div><b>${esc(t('Encaissements des ventes'))}</b></div>
    <table>${r.salePayments.map((p) => line(payLabel(p.method), p.amount)).join('') || '<tr><td>—</td></tr>'}</table>
    ${r.customerPayments.length ? `<div><b>${esc(t('Versements des clients'))}</b></div><table>${r.customerPayments.map((p) => line(payLabel(p.method), p.amount)).join('')}</table>` : ''}
    ${r.refunds?.length ? `<div><b>${esc(t('Retours remboursés'))}</b></div><table>${r.refunds.map((p) => line(payLabel(p.method), p.amount)).join('')}</table>` : ''}
    ${r.expenses.length ? `<div><b>${esc(t('Dépenses'))}</b></div><table>${r.expenses.map((e) => line(`${e.category}${e.method !== CASH ? ` (${e.method})` : ''}`, e.amount)).join('')}</table>` : ''}
    ${r.supplierPayments?.length ? `<div><b>${esc(t('Paiements fournisseurs'))}</b></div><table>${r.supplierPayments.map((p) => line(payLabel(p.method), p.amount)).join('')}</table>` : ''}
    <div class="hr"></div>
    <table>${line(t('Mouvement d’espèces de la journée'), r.cash.expected, true)}</table>
  </div>`;
  printHTML(html, w);
}

export function printSession(session) {
  if (hasThermal()) return thermal(() => sendSessionReport(session));
  const s = store.settings;
  const w = s.receipt_width === '58' ? '58' : '80';
  const b = session.breakdown || {};
  const line = (label, v, bold) => `<tr><td>${bold ? '<b>' : ''}${esc(label)}${bold ? '</b>' : ''}</td><td class="r">${bold ? '<b>' : ''}${money(v, { bare: true })}${bold ? '</b>' : ''}</td></tr>`;
  const html = `
  <div class="rcpt w${w}"${dirAttr()}>
    ${storeHeader()}
    <div class="hr"></div>
    <div class="c"><b>${esc(t('CLÔTURE DE CAISSE'))}</b></div>
    <div class="c">${session.user_name ? `${esc(t('Caisse de'))} ${esc(session.user_name)}` : esc(t('Tout le magasin'))}</div>
    <div class="c">${dateTimeFr(session.opened_at)} → ${dateTimeFr(session.closed_at)}</div>
    <div class="hr"></div>
    <table>
      ${line(t('Fond de caisse'), b.opening_float)}
      ${line(`+ ${t('Ventes en espèces')}`, b.sales)}
      ${line(`+ ${t('Versements des clients')}`, b.payments)}
      ${b.refunds ? line(`− ${t('Retours remboursés')}`, b.refunds) : ''}
      ${line(`− ${t('Dépenses')}`, b.expenses)}
      ${b.suppliers ? line(`− ${t('Paiements fournisseurs')}`, b.suppliers) : ''}
    </table>
    <div class="hr"></div>
    <table>
      ${line(t('Espèces attendues'), session.expected, true)}
      ${line(t('Espèces comptées'), session.counted, true)}
      ${line(t('Écart'), session.difference, true)}
    </table>
    ${b.count != null ? `<div class="hr"></div><table>${line(`${t('Ventes encaissées')} (${b.count})`, b.sales_total)}${b.credit > 0 ? line(t('dont à crédit'), b.credit) : ''}</table>` : ''}
    ${b.methods?.length ? `<div><b>${esc(t('Encaissé hors espèces'))}</b></div><table>${b.methods.map((m) => line(payLabel(m.method), m.amount)).join('')}</table>` : ''}
    ${b.expense_items?.length ? `<div class="hr"></div><div><b>${esc(t('Dépenses'))}</b></div><table>${b.expense_items.map((e) => line(`${timeFr(e.created_at)} ${e.category}${e.note ? ` · ${e.note}` : ''}${e.method !== CASH ? ` (${payLabel(e.method)})` : ''}`, e.amount)).join('')}</table>` : ''}
    ${session.note ? `<div>${esc(session.note)}</div>` : ''}
    <div class="hr"></div>
    <div>${esc(t('Clôturée par'))} ${esc(session.closed_by_name || '')}</div>
    <div>${esc(t('Signature'))} :</div><br><br>
  </div>`;
  printHTML(html, w);
}

// ---- Étiquettes A4 (codes-barres) ---------------------------------------------------
/** Formats de feuille A4 d'étiquettes (zone utile 200 × 287 mm : marge de 5 mm pour les imprimantes de bureau). */
export const LABEL_LAYOUTS = [
  { id: '3x8', cols: 3, rows: 8, name: '3 × 8 (≈ 67 × 36 mm)' },
  { id: '4x10', cols: 4, rows: 10, name: '4 × 10 (≈ 50 × 29 mm)' },
  { id: '5x13', cols: 5, rows: 13, name: '5 × 13 (≈ 40 × 22 mm)' },
];

/** Une étiquette (HTML) : nom, prix, code-barres. Dimensions en mm. */
export function labelHTML(p, { w, h, showPrice = true, showAr = true, priceType = 'retail', cutLines = false }) {
  const small = h < 25;
  const nameSize = h >= 33 ? '10.5pt' : h >= 26 ? '9pt' : '7pt';
  const priceSize = h >= 33 ? '14pt' : h >= 26 ? '11pt' : '9pt';
  const price = priceType === 'wholesale' && Number(p.wholesale_price) > 0 ? p.wholesale_price : p.retail_price;
  const unit = priceType === 'wholesale' && p.pack_unit ? p.pack_unit : p.unit;
  const clamp = `display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;-webkit-line-clamp:${small ? 1 : 2};line-height:1.15`;
  return `<div class="sticker${cutLines ? ' cut' : ''}" style="width:${w}mm;height:${h}mm">
    <div>
      <div style="${clamp};font-weight:700;font-size:${nameSize}">${esc(p.name)}</div>
      ${showAr && !small && p.name_ar ? `<div dir="rtl" style="${clamp};-webkit-line-clamp:1;font-size:${nameSize}">${esc(p.name_ar)}</div>` : ''}
    </div>
    ${showPrice ? `<div style="font-weight:800;font-size:${priceSize};line-height:1.1">${money(price)}<span style="font-weight:600;font-size:.75em"> / ${esc(unit)}</span></div>` : ''}
    <div class="sticker-code" style="${small ? 'height:9mm' : `max-height:${h * 0.42}mm`}">${barcodeSvg(p.barcode)}</div>
  </div>`;
}

/** Imprime des feuilles A4 d'étiquettes (items : un produit par étiquette). */
export function printLabelSheets(items, layout, opts) {
  const per = layout.cols * layout.rows;
  const w = 200 / layout.cols;
  const h = 287 / layout.rows;
  const pages = [];
  for (let i = 0; i < items.length; i += per) pages.push(items.slice(i, i + per));
  const html = pages
    .map(
      (page, pi) =>
        `<div class="label-sheet" style="grid-template-columns:repeat(${layout.cols}, ${w}mm);grid-auto-rows:${h}mm;page-break-after:${pi < pages.length - 1 ? 'always' : 'auto'}">${page
          .map((p) => labelHTML(p, { ...opts, w, h }))
          .join('')}</div>`,
    )
    .join('');
  printHTML(html, 'labels');
}

export const canEncode = (code) => !!encode(code);

// ---- WhatsApp et SMS ---------------------------------------------------------------
export function whatsappPhone(phone) {
  const p = String(phone || '').replace(/[^\d+]/g, '');
  if (!p) return '';
  if (p.startsWith('+')) return p.slice(1);
  if (p.startsWith('00')) return p.slice(2);
  const cc = store.settings.phone_country_code;
  if (cc && !p.startsWith(cc)) return cc + p.replace(/^0+/, '');
  return p;
}

export function saleText(sale) {
  const s = store.settings;
  const credit = Math.max(0, sale.total - (sale.paid || 0));
  const lines = [
    `*${s.store_name}*`,
    `${t('Ticket')} ${sale.id ? saleNo(sale.id) : ''} · ${dateTimeFr(sale.created_at)}`,
    sale.customer_name ? `${t('Client')} : ${sale.customer_name}` : null,
    '',
    ...(sale.items || []).map(
      (it) =>
        `• ${(store.lang === 'ar' && it.name_ar) || it.name}${it.sale_type === 'wholesale' ? ` (${t('gros')})` : ''}\n   ${qty(it.qty)} ${plural(it.unit_label, it.qty)} × ${money(it.unit_price)} = ${money(it.total)}`,
    ),
    '',
    sale.discount > 0 ? `${t('Remise')} : −${money(sale.discount)}` : null,
    `*${t('TOTAL')} : ${money(sale.total)}*`,
    sale.tax_total > 0 ? `${t('dont TVA')} : ${money(sale.tax_total)}` : null,
    ...(sale.payments || []).map((p) => `${payLabel(p.method)} : ${money(p.amount)}${p.reference ? ` (${p.reference})` : ''}`),
    credit > 0.004 ? `*${t('Reste à payer')} : ${money(credit)}*` : null,
    s.receipt_show_balance && sale.customer_balance !== undefined && sale.customer_id ? `${t('Solde de votre compte')} : ${money(sale.customer_balance)}` : null,
    '',
    s.receipt_footer || null,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

export function openWhatsApp(text, phone) {
  const p = whatsappPhone(phone);
  const url = `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener');
}

/** Ouvre l'application SMS du téléphone avec le message pré-rempli (sans Internet). */
export function openSms(text, phone) {
  const p = String(phone || '').replace(/[^\d+]/g, '');
  window.location.href = `sms:${p}?&body=${encodeURIComponent(text.replace(/\*/g, ''))}`;
}

export { pname };
