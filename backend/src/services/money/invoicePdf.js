// The invoice (or credit note) as a PDF (Phase 3, step 3), built in memory:
// downloaded by staff, attached to the email, and shown from the pay link.
// Uses pdfReport.js's layout and branding, like the other PDFs.
const {
  newDocument, drawHeader, fieldGrid, paragraph, table, addFooters, PAGE_MARGIN, CONTENT_WIDTH, TEXT, MUTED,
} = require('../pdfReport');
const { D, cents } = require('./money');
const { balanceOf } = require('./invoices');

const KIND_TITLE = { invoice: 'Invoice', credit_note: 'Credit note' };
const usd = (v) => `$${D(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const qty = (v) => D(v).toDecimalPlaces(4).toString();

// invoice: with lines; company: { name }; billTo: contact or null.
function invoicePdf(invoice, { company, billTo = null }) {
  return new Promise((resolve, reject) => {
    (async () => {
      const doc = newDocument();
      const title = `${KIND_TITLE[invoice.kind]} ${invoice.number || '(draft)'}`;
      doc.info.Title = title;
      doc.info.Subject = company ? company.name : '';
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      await drawHeader(doc, title);
      fieldGrid(doc, [
        ['Bill to', [company && company.name, billTo && billTo.displayName].filter(Boolean).join(' — ')],
        ['Number', invoice.number || 'Draft'],
        ['Date', invoice.issuedOn || '—'],
        ['Due', invoice.kind === 'invoice' ? (invoice.dueOn || '—') : '—'],
      ]);
      doc.moveDown(0.6);
      const lines = [...(invoice.lines || [])].sort((x, y) => x.sortOrder - y.sortOrder || x.id - y.id);
      table(doc, [
        { label: 'Description', width: 270, render: (l) => (l.serviceFrom ? `${l.description} (${l.serviceFrom} – ${l.serviceTo})` : l.description) },
        { label: 'Qty', width: 60, align: 'right', render: (l) => qty(l.quantity) },
        { label: 'Price', width: 80, align: 'right', render: (l) => usd(l.unitPrice) },
        { label: 'Amount', width: 82, align: 'right', render: (l) => usd(l.amount) },
      ], lines);
      doc.moveDown(0.6);
      const totals = [['Subtotal', invoice.subtotal], ['Sales tax', invoice.taxTotal], ['Total', invoice.total]];
      if (invoice.kind === 'invoice' && !D(invoice.amountPaid).plus(invoice.creditApplied).isZero()) {
        totals.push(['Paid and credited', cents(D(invoice.amountPaid).plus(invoice.creditApplied))], ['Balance due', balanceOf(invoice)]);
      }
      totals.forEach(([label, value]) => {
        const y = doc.y;
        doc.fontSize(10).fillColor(MUTED).text(label, PAGE_MARGIN + CONTENT_WIDTH - 220, y, { width: 120, align: 'right' });
        doc.fillColor(TEXT).text(usd(value), PAGE_MARGIN + CONTENT_WIDTH - 90, y, { width: 90, align: 'right' });
        doc.moveDown(0.2);
      });
      if (invoice.notes) {
        doc.moveDown(0.8);
        paragraph(doc, invoice.notes);
      }
      addFooters(doc);
      doc.end();
    })().catch(reject);
  });
}

module.exports = { invoicePdf };
