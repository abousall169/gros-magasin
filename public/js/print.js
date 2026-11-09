// Impression des tickets (58/80 mm), factures A4, relevés et clôtures ; partage WhatsApp.
import { store, CASH } from './store.js';
import { money, qty, dateTimeFr, dateFr, saleNo, amountInWords, MODE_LABEL, plural, dayLong } from './format.js';

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

function storeHeader(center = true) {
  const s = store.settings;
  const lines = [s.store_address, s.store_phone && `Tél : ${s.store_phone}`, s.store_tax_id].filter(Boolean);
  return `<h1${center ? '' : ' style="text-align:left"'}>${esc(s.store_name)}</h1>${lines.map((l) => `<div class="${center ? 'c' : ''}">${esc(l)}</div>`).join('')}`;
}

const itemQty = (it) => `${qty(it.qty)} ${esc(plural(it.unit_label, it.qty))}`;

// ---- Ticket de caisse -----------------------------------------------------------------
export function printTicket(sale) {
  const s = store.settings;
  const w = s.receipt_width === '58' ? '58' : '80';
  const credit = Math.max(0, sale.total - sale.paid);
  const rows = sale.items
    .map(
      (it) => `
      <tr><td colspan="2">${esc(it.name)}${it.sale_type === 'wholesale' ? ' <b>(gros)</b>' : ''}</td></tr>
      <tr><td class="item-sub">${itemQty(it)} × ${money(it.unit_price, { bare: true })}</td><td class="r">${money(it.total, { bare: true })}</td></tr>`,
    )
    .join('');
  const pays = sale.payments.map((p) => `<tr><td>${esc(p.method)}</td><td class="r">${money(p.amount, { bare: true })}</td></tr>`).join('');
  const html = `
  <div class="rcpt w${w}">
    ${storeHeader()}
    <div class="hr"></div>
    <div>Ticket ${saleNo(sale.id)} — ${MODE_LABEL[sale.mode] || ''}</div>
    <div>${dateTimeFr(sale.created_at)} · ${esc(sale.user_name)}</div>
    ${sale.customer_name ? `<div>Client : <b>${esc(sale.customer_name)}</b></div>` : ''}
    <div class="hr"></div>
    <table>${rows}</table>
    <div class="hr"></div>
    <table>
      ${sale.discount > 0 ? `<tr><td>Sous-total</td><td class="r">${money(sale.subtotal, { bare: true })}</td></tr><tr><td>Remise</td><td class="r">−${money(sale.discount, { bare: true })}</td></tr>` : ''}
      <tr class="tot"><td>TOTAL</td><td class="r">${money(sale.total)}</td></tr>
      ${pays}
      ${sale.received > sale.paid ? `<tr><td>Reçu</td><td class="r">${money(sale.received, { bare: true })}</td></tr>` : ''}
      ${sale.change_given > 0 ? `<tr><td>Rendu</td><td class="r">${money(sale.change_given, { bare: true })}</td></tr>` : ''}
      ${credit > 0 ? `<tr><td><b>Reste à payer (crédit)</b></td><td class="r"><b>${money(credit, { bare: true })}</b></td></tr>` : ''}
    </table>
    ${s.receipt_show_balance && sale.customer_id && sale.customer_balance !== undefined ? `<div class="hr"></div><div>Solde du compte client : <b>${money(sale.customer_balance)}</b></div>` : ''}
    ${sale.status === 'cancelled' ? '<div class="c"><span class="stamp">VENTE ANNULÉE</span></div>' : ''}
    <div class="hr"></div>
    ${s.receipt_footer ? `<div class="c">${esc(s.receipt_footer)}</div>` : ''}
  </div>`;
  printHTML(html, w);
}

// ---- Facture A4 (ou proforma) ------------------------------------------------------
export function printInvoice(sale, { proforma = false } = {}) {
  const s = store.settings;
  const credit = Math.max(0, sale.total - (sale.paid || 0));
  const rows = sale.items
    .map(
      (it, i) => `<tr>
        <td>${i + 1}</td>
        <td>${esc(it.name)}</td>
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
      <tr class="grand"><td>TOTAL</td><td class="r">${money(sale.total)}</td></tr>
      ${proforma ? '' : `<tr><td>Payé</td><td class="r">${money(sale.paid)}</td></tr>${credit > 0 ? `<tr><td><b>Reste à payer</b></td><td class="r"><b>${money(credit)}</b></td></tr>` : ''}`}
    </table>
    <p class="words">Arrêtée la présente ${proforma ? 'facture proforma' : 'facture'} à la somme de : <b>${esc(amountInWords(sale.total))}</b>.</p>
    ${!proforma && sale.payments?.length ? `<p>Règlement : ${sale.payments.map((p) => `${esc(p.method)} ${money(p.amount)}`).join(' · ')}${credit > 0 ? ` · Crédit ${money(credit)}` : ''}</p>` : ''}
    ${sale.status === 'cancelled' ? '<p><b>FACTURE ANNULÉE</b></p>' : ''}
    <div class="signs"><div>Le client</div><div>Pour ${esc(s.store_name)}</div></div>
    ${s.receipt_footer ? `<div class="foot">${esc(s.receipt_footer)}</div>` : ''}
  </div>`;
  printHTML(html, 'a4');
}

// ---- Reçu de versement client --------------------------------------------------------
export function printPaymentReceipt(payment, customer) {
  const s = store.settings;
  const w = s.receipt_width === '58' ? '58' : '80';
  const html = `
  <div class="rcpt w${w}">
    ${storeHeader()}
    <div class="hr"></div>
    <div class="c"><b>REÇU DE VERSEMENT</b></div>
    <div>${dateTimeFr(payment.created_at)}</div>
    <div>Client : <b>${esc(customer.name)}</b></div>
    <div class="hr"></div>
    <table>
      <tr class="tot"><td>Montant versé</td><td class="r">${money(payment.amount)}</td></tr>
      <tr><td>Mode</td><td class="r">${esc(payment.method)}</td></tr>
      <tr><td>Reste dû</td><td class="r"><b>${money(payment.balance)}</b></td></tr>
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
      <thead><tr><th>Date</th><th>Opération</th><th class="r">Achat à crédit</th><th class="r">Versement</th><th class="r">Solde</th></tr></thead>
      <tbody>${customer.opening_balance ? `<tr><td></td><td>Solde antérieur</td><td class="r">${money(customer.opening_balance, { bare: true })}</td><td></td><td></td></tr>` : ''}${rows}</tbody>
    </table>
    <table class="totals"><tr class="grand"><td>Solde dû</td><td class="r">${money(customer.balance)}</td></tr></table>
    <p class="words">Arrêté le présent relevé à la somme de : <b>${esc(amountInWords(Math.max(0, customer.balance)))}</b>.</p>
  </div>`;
  printHTML(html, 'a4');
}

// ---- Clôture de caisse (ticket) ---------------------------------------------------
export function printCashReport(r, { float = 0, counted = null } = {}) {
  const s = store.settings;
  const w = s.receipt_width === '58' ? '58' : '80';
  const line = (label, v, bold) => `<tr><td>${bold ? '<b>' : ''}${esc(label)}${bold ? '</b>' : ''}</td><td class="r">${bold ? '<b>' : ''}${money(v, { bare: true })}${bold ? '</b>' : ''}</td></tr>`;
  const expected = r.cash.expected + (Number(float) || 0);
  const html = `
  <div class="rcpt w${w}">
    ${storeHeader()}
    <div class="hr"></div>
    <div class="c"><b>CLÔTURE DE CAISSE</b></div>
    <div class="c">${esc(dayLong(r.date))}</div>
    <div class="c">${r.user ? `Vendeur : ${esc(r.user.name)}` : 'Tout le magasin'}</div>
    <div class="hr"></div>
    <table>
      ${line(`Ventes (${r.sales.count})`, r.sales.total, true)}
      ${r.sales.credit > 0 ? line('dont à crédit', r.sales.credit) : ''}
      ${r.sales.discount > 0 ? line('Remises accordées', r.sales.discount) : ''}
      ${r.cancelled.count ? line(`Ventes annulées (${r.cancelled.count})`, r.cancelled.total) : ''}
    </table>
    <div class="hr"></div>
    <div><b>Encaissements des ventes</b></div>
    <table>${r.salePayments.map((p) => line(p.method, p.amount)).join('') || '<tr><td>—</td></tr>'}</table>
    ${r.customerPayments.length ? `<div><b>Versements clients</b></div><table>${r.customerPayments.map((p) => line(p.method, p.amount)).join('')}</table>` : ''}
    ${r.expenses.length ? `<div><b>Dépenses</b></div><table>${r.expenses.map((e) => line(`${e.category}${e.method !== CASH ? ` (${e.method})` : ''}`, e.amount)).join('')}</table>` : ''}
    <div class="hr"></div>
    <table>
      ${Number(float) ? line('Fond de caisse', float) : ''}
      ${line('Espèces attendues', expected, true)}
      ${counted !== null && counted !== '' ? line('Espèces comptées', counted) + line('Écart', Number(counted) - expected, true) : ''}
    </table>
    <div class="hr"></div>
    <div>Signature :</div><br><br>
  </div>`;
  printHTML(html, w);
}

// ---- WhatsApp ---------------------------------------------------------------------
export function whatsappPhone(phone) {
  let p = String(phone || '').replace(/[^\d+]/g, '');
  if (!p) return '';
  if (p.startsWith('+')) return p.slice(1);
  if (p.startsWith('00')) return p.slice(2);
  const cc = store.settings.phone_country_code;
  if (cc) return cc + p.replace(/^0+/, '');
  return p;
}

export function saleText(sale) {
  const s = store.settings;
  const credit = Math.max(0, sale.total - sale.paid);
  const lines = [
    `*${s.store_name}*`,
    `Ticket ${saleNo(sale.id)} du ${dateTimeFr(sale.created_at)}`,
    sale.customer_name ? `Client : ${sale.customer_name}` : null,
    '',
    ...sale.items.map((it) => `• ${it.name}${it.sale_type === 'wholesale' ? ' (gros)' : ''}\n   ${qty(it.qty)} ${plural(it.unit_label, it.qty)} × ${money(it.unit_price)} = ${money(it.total)}`),
    '',
    sale.discount > 0 ? `Remise : −${money(sale.discount)}` : null,
    `*TOTAL : ${money(sale.total)}*`,
    ...sale.payments.map((p) => `${p.method} : ${money(p.amount)}`),
    credit > 0 ? `*Reste à payer : ${money(credit)}*` : null,
    s.receipt_show_balance && sale.customer_balance !== undefined && sale.customer_id ? `Solde de votre compte : ${money(sale.customer_balance)}` : null,
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
