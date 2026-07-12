// Generates the "Equipment Checkout Agreement" PDF and saves it directly to
// disk (not streamed to an HTTP response like pdfReport.js's other callers)
// so it can be persisted as an AssetAttachment. Reuses pdfReport.js's shared
// layout primitives/branding lookup.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  newDocument, drawHeader, fieldGrid, paragraph, PAGE_MARGIN, CONTENT_WIDTH, TEXT, MUTED,
} = require('./pdfReport');
const { getAllSettings } = require('../controllers/settingsController');
const { UPLOAD_ROOT } = require('../middleware/upload');

async function generateCheckoutFormPdf({ asset, contact, checkoutDate }) {
  const settings = await getAllSettings();
  const companyName = settings['company.name'] || settings['branding.appName'] || 'PRISM';

  const doc = newDocument();
  const dir = path.join(UPLOAD_ROOT, 'assets', String(asset.id));
  fs.mkdirSync(dir, { recursive: true });
  const filename = `checkout-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.pdf`;
  const filePath = path.join(dir, filename);
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  await drawHeader(doc, 'Equipment Checkout Agreement');

  doc.fontSize(9).fillColor(MUTED).text('Asset', PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, height: 12 });
  doc.y += 14;
  fieldGrid(doc, [
    ['Asset tag', asset.assetTag],
    ['Name', asset.name],
    ['Category', asset.category?.name],
    ['Make', asset.make],
    ['Model', asset.model],
    ['Serial number', asset.serialNumber],
  ]);

  doc.moveDown(0.4);
  doc.fontSize(9).fillColor(MUTED).text('Assigned to', PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, height: 12 });
  doc.y += 14;
  fieldGrid(doc, [
    ['Contact name', contact?.displayName],
    ['Department', contact?.department?.name],
    ['Checkout date', checkoutDate],
  ]);

  doc.moveDown(0.8);
  paragraph(
    doc,
    `I acknowledge receipt of the above equipment in good working condition. I agree to return this equipment upon `
      + `request or upon separation from ${companyName}. I am responsible for the safekeeping of this equipment while `
      + `it is in my possession.`
  );

  doc.moveDown(2);
  const sigY = doc.y;
  doc.fontSize(10).fillColor(TEXT).text('Signature: _________________________________', PAGE_MARGIN, sigY, { width: 320, height: 16 });
  doc.text('Date: _______________', PAGE_MARGIN + 340, sigY, { width: 150, height: 16 });
  doc.y = sigY + 32;
  doc.fontSize(10).fillColor(TEXT).text('Print name: _________________________________', PAGE_MARGIN, doc.y, { width: 320, height: 16 });

  doc.fontSize(8).fillColor(MUTED).text('Please sign and return to IT Department', PAGE_MARGIN, 772, { width: CONTENT_WIDTH, align: 'center', height: 12 });

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  const size = fs.statSync(filePath).size;
  return { filename, size };
}

module.exports = { generateCheckoutFormPdf };
