// Shared pdfkit layout helpers for all generated reports (per-ticket,
// per-project, and the custom report builder's PDF export). pdfkit was
// chosen over puppeteer because it's pure JS — no Chromium/system deps to
// install in the (Alpine, no-sudo) Docker image.
//
// IMPORTANT pdfkit gotcha: .text() auto-inserts a new page when the content
// would overflow the bottom margin — this happens even when explicit x/y
// coordinates are passed, and it happens *silently*, leaving doc.y pointing
// at the new page while callers' own manual y-bookkeeping (ensureSpace,
// table row math, etc.) still assumes the old page. That desync compounds
// fast and produces reports with far more blank/near-empty pages than the
// content warrants. The fix is to always pass an explicit `height` on
// .text() calls with a fixed layout box — a bounded box makes pdfkit clip
// instead of paginating, so *only* our own ensureSpace() calls decide when
// to add a page.
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { getAllSettings, BRANDING_DIR } = require('../controllers/settingsController');

const PAGE_MARGIN = 50;
const CONTENT_WIDTH = 512; // LETTER (612pt) minus 2x margin
const NAVY = '#1d3461';
const TEXT = '#1e293b';
const MUTED = '#64748b';
const BORDER = '#cbd5e1';
const PAGE_BOTTOM = 740;

async function brandingInfo() {
  const values = await getAllSettings();
  const companyName = values['company.name'] || values['branding.appName'] || 'PRISM';
  const logoFilename = values['company.logoFilename'];
  let logoPath = null;
  if (logoFilename) {
    const p = path.join(BRANDING_DIR, logoFilename);
    if (fs.existsSync(p)) logoPath = p;
  }
  return { companyName, logoPath };
}

function newDocument() {
  return new PDFDocument({ size: 'LETTER', margin: PAGE_MARGIN, bufferPages: true });
}

async function drawHeader(doc, title) {
  const { companyName, logoPath } = await brandingInfo();
  let textStartY = 40;
  if (logoPath) {
    try {
      doc.image(logoPath, PAGE_MARGIN, 38, { height: 28 });
      textStartY = 72;
    } catch {
      // Corrupt/unreadable logo file — fall through without it.
    }
  }
  doc.fontSize(9).fillColor(MUTED).text(companyName, PAGE_MARGIN, textStartY, { width: 250, height: 14, ellipsis: true });
  doc.fontSize(19).fillColor(NAVY).text(title, PAGE_MARGIN, 40, { width: CONTENT_WIDTH, align: 'right', height: 24, ellipsis: true });
  doc.fontSize(8.5).fillColor(MUTED).text(`Generated ${new Date().toLocaleString()}`, PAGE_MARGIN, 63, { width: CONTENT_WIDTH, align: 'right', height: 12, ellipsis: true });
  doc.moveTo(PAGE_MARGIN, 96).lineTo(PAGE_MARGIN + CONTENT_WIDTH, 96).strokeColor(BORDER).lineWidth(1).stroke();
  doc.y = 112;
  doc.x = PAGE_MARGIN;
}

function ensureSpace(doc, height) {
  if (doc.y + height > PAGE_BOTTOM) {
    doc.addPage();
    doc.y = PAGE_MARGIN;
    doc.x = PAGE_MARGIN;
  }
}

function sectionTitle(doc, text) {
  ensureSpace(doc, 30);
  doc.moveDown(0.6);
  doc.fontSize(12.5).fillColor(NAVY).text(text, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, height: 16, ellipsis: true });
  doc.y += 16;
  doc.moveTo(PAGE_MARGIN, doc.y + 2).lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y + 2).strokeColor(BORDER).lineWidth(0.75).stroke();
  doc.y += 8;
  doc.x = PAGE_MARGIN;
  doc.fillColor(TEXT);
}

// Renders a 2-column grid of label/value pairs, e.g. ticket summary fields.
function fieldGrid(doc, pairs, colWidth = CONTENT_WIDTH / 2) {
  let col = 0;
  let rowTopY = doc.y;
  pairs.forEach(([label, value]) => {
    const x = PAGE_MARGIN + col * colWidth;
    ensureSpace(doc, 34);
    if (col === 0) rowTopY = doc.y;
    doc.fontSize(8).fillColor(MUTED).text(label, x, rowTopY, { width: colWidth - 12, height: 11, ellipsis: true });
    doc.fontSize(10).fillColor(TEXT).text(value === null || value === undefined || value === '' ? '—' : String(value), x, rowTopY + 11, { width: colWidth - 12, height: 20, ellipsis: true });
    col += 1;
    if (col >= 2) {
      col = 0;
      doc.y = rowTopY + 34;
      doc.x = PAGE_MARGIN;
    }
  });
  if (col !== 0) doc.y = rowTopY + 34;
  doc.x = PAGE_MARGIN;
}

// Free-flowing paragraph text — deliberately the one place callers may want
// real multi-page flow (long descriptions), so no height bound here; pdfkit's
// own auto-pagination is what we want for this case.
function paragraph(doc, text, opts = {}) {
  ensureSpace(doc, 20);
  doc.fontSize(9.5).fillColor(TEXT).text(text || '—', PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, ...opts });
  doc.x = PAGE_MARGIN;
  doc.moveDown(0.4);
}

// Simple table renderer. columns: [{ key, label, width, align, render(row) }]
function table(doc, columns, rows, opts = {}) {
  const rowHeight = opts.rowHeight || 18;
  const headerHeight = opts.headerHeight || 20;
  const totalWidth = columns.reduce((s, c) => s + c.width, 0);
  const startX = PAGE_MARGIN;

  // NOTE: doc.y is captured once per row (rowY) rather than re-read inside
  // the per-column loop — .text() advances doc.y even with explicit x/y, so
  // re-reading it per column would push each successive column's text
  // progressively lower within the same visual row.
  function drawHeaderRow() {
    ensureSpace(doc, headerHeight + rowHeight);
    const rowY = doc.y;
    doc.rect(startX, rowY, totalWidth, headerHeight).fill('#f1f5f9');
    let x = startX;
    doc.fontSize(8).fillColor('#334155');
    columns.forEach((c) => {
      doc.text(c.label, x + 4, rowY + 6, { width: c.width - 8, align: c.align || 'left', height: headerHeight - 6, ellipsis: true });
      x += c.width;
    });
    doc.y = rowY + headerHeight;
  }

  drawHeaderRow();
  doc.fontSize(8.2);
  rows.forEach((row, i) => {
    if (doc.y + rowHeight > PAGE_BOTTOM) {
      doc.addPage();
      doc.y = PAGE_MARGIN;
      drawHeaderRow();
    }
    const rowY = doc.y;
    if (i % 2 === 1) doc.rect(startX, rowY, totalWidth, rowHeight).fill('#f8fafc');
    let x = startX;
    columns.forEach((c) => {
      const val = c.render ? c.render(row) : (row[c.key] ?? '');
      doc.fillColor('#334155').text(val === null || val === undefined || val === '' ? '—' : String(val), x + 4, rowY + 5, { width: c.width - 8, align: c.align || 'left', height: rowHeight - 5, ellipsis: true });
      x += c.width;
    });
    doc.y = rowY + rowHeight;
  });
  if (!rows.length) {
    ensureSpace(doc, rowHeight);
    doc.fontSize(9).fillColor(MUTED).text('None.', startX + 4, doc.y + 4, { width: totalWidth - 8, height: rowHeight - 4, ellipsis: true });
    doc.y += rowHeight;
  }
  doc.x = PAGE_MARGIN;
  doc.moveDown(0.5);
  doc.fillColor(TEXT);
}

// Simple horizontal bar chart (no charting library available server-side —
// pdfkit only draws primitives, so bars are hand-drawn rects sized
// proportional to value). Used by the custom report builder's PDF export.
const BAR_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
function barChart(doc, rows, valueKey, opts = {}) {
  if (!rows.length) return;
  const labelWidth = opts.labelWidth || 140;
  const barMaxWidth = CONTENT_WIDTH - labelWidth - 60;
  const barHeight = 14;
  const gap = 6;
  const maxVal = Math.max(...rows.map((r) => Number(r[valueKey]) || 0), 1);

  rows.forEach((r, i) => {
    ensureSpace(doc, barHeight + gap);
    const rowY = doc.y;
    const val = Number(r[valueKey]) || 0;
    const barWidth = Math.max(2, (val / maxVal) * barMaxWidth);
    doc.fontSize(8).fillColor(TEXT).text(String(r.name), PAGE_MARGIN, rowY + 2, { width: labelWidth - 6, height: barHeight, ellipsis: true });
    doc.rect(PAGE_MARGIN + labelWidth, rowY, barWidth, barHeight).fill(BAR_COLORS[i % BAR_COLORS.length]);
    doc.fontSize(8).fillColor(TEXT).text(String(val), PAGE_MARGIN + labelWidth + barWidth + 4, rowY + 2, { width: 55, height: barHeight, ellipsis: true });
    doc.y = rowY + barHeight + gap;
  });
  doc.x = PAGE_MARGIN;
  doc.moveDown(0.4);
}

function addFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc.fontSize(7.5).fillColor(MUTED).text(`Page ${i + 1} of ${range.count}`, PAGE_MARGIN, 772, { width: CONTENT_WIDTH, align: 'center', height: 12, ellipsis: true });
  }
}

function streamPdfResponse(res, filename, doc, buildFn) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  return Promise.resolve(buildFn(doc)).then(() => {
    addFooters(doc);
    doc.end();
  });
}

module.exports = {
  PAGE_MARGIN, CONTENT_WIDTH, NAVY, TEXT, MUTED, BORDER,
  newDocument, drawHeader, sectionTitle, fieldGrid, paragraph, table, barChart, addFooters, ensureSpace, streamPdfResponse,
};
