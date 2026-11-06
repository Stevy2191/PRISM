// Checkout forms: print or email the form, then upload the signed copy.
// Outbound email is recorded, not sent.
jest.mock('../../src/services/emailSender');

const { resetData, closeDb, models } = require('./helpers');
const { sendMail } = require('../../src/services/emailSender');
const { API, expectOk, makeWorld } = require('./fixtures');

const expectErr = (res, status, code) => {
  expect([res.status, res.body.code]).toEqual([status, code]);
};

// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

let w;
let asset;
const a = () => w.admin.agent;
beforeEach(async () => {
  await resetData();
  sendMail.mockReset();
  w = await makeWorld();
  const category = await models.AssetCategory.findOne();
  asset = expectOk(await a().post(`${API}/assets`).send({ categoryId: category.id, name: 'Front desk laptop', assetTag: 'LT-0042' }), 201).asset;
  // Another attachment first: the form must never be confused with it.
  expectOk(await a().post(`${API}/assets/${asset.id}/attachments`).attach('file', PNG, 'invoice.png'), 201);
});
afterAll(closeDb);

const checkOut = async (generateForm = true) => expectOk(await a().post(`${API}/assets/${asset.id}/checkouts`)
  .send({ contactId: w.contact.id, generateForm }), 201);

it('a checkout remembers its own form, which opens inline to print', async () => {
  const { checkout, attachment } = await checkOut();
  expect(checkout.formAttachmentId).toBe(attachment.id);
  expect(checkout.formAttachment).toMatchObject({ id: attachment.id, originalName: 'Checkout Form - LT-0042.pdf', mimeType: 'application/pdf' });

  const view = await a().get(`${API}/assets/${asset.id}/attachments/${attachment.id}/download?inline=1`).buffer(true);
  expect(view.status).toBe(200);
  expect(view.headers['content-type']).toBe('application/pdf');
  expect(view.headers['content-disposition']).toMatch(/^inline; filename="Checkout Form - LT-0042\.pdf"/);
  const dl = await a().get(`${API}/assets/${asset.id}/attachments/${attachment.id}/download`);
  expect(dl.headers['content-disposition']).toMatch(/^attachment/);

  const printed = expectOk(await a().post(`${API}/assets/${asset.id}/checkouts/${checkout.id}/printed`)).checkout;
  expect(printed.checkoutFormPrintedAt).toBeTruthy();
  const acts = await models.AssetActivity.findAll({ where: { assetId: asset.id }, order: [['id', 'ASC']] });
  expect(acts.map((x) => x.action)).toEqual(expect.arrayContaining(['checkout_form_generated', 'checkout_form_printed']));
});

it('checking out to someone gives the asset their department', async () => {
  await models.Contact.update({ departmentId: w.deptB.id }, { where: { id: w.contact.id } });
  await checkOut(false);
  expect((await models.Asset.findByPk(asset.id)).departmentId).toBe(w.deptB.id);
});

it('only a PDF ever opens inline', async () => {
  const png = await models.AssetAttachment.findOne({ where: { assetId: asset.id, originalName: 'invoice.png' } });
  const res = await a().get(`${API}/assets/${asset.id}/attachments/${png.id}/download?inline=1`);
  expect(res.headers['content-disposition']).toMatch(/^attachment/);
});

it('emailing sends the checkout\'s form, not the asset\'s first attachment', async () => {
  const { checkout } = await checkOut();
  const sent = expectOk(await a().post(`${API}/assets/${asset.id}/checkouts/${checkout.id}/send-form`).send({ to: 'pat@example.com' })).checkout;
  expect(sent.checkoutFormSentAt).toBeTruthy();
  expect(sendMail).toHaveBeenCalledTimes(1);
  const [mail] = sendMail.mock.calls[0];
  expect(mail.to).toBe('pat@example.com');
  expect(mail.attachments.map((x) => x.filename)).toEqual(['Checkout Form - LT-0042.pdf']);
  expect(mail.text).toMatch(/print it, sign it/);
});

it('a checkout without a form gets one later; printing needs one', async () => {
  const { checkout, attachment } = await checkOut(false);
  expect(attachment).toBeNull();
  expectErr(await a().post(`${API}/assets/${asset.id}/checkouts/${checkout.id}/printed`), 400, 'NO_FORM');
  expectErr(await a().post(`${API}/assets/${asset.id}/checkouts/${checkout.id}/send-form`).send({ to: 'pat@example.com' }), 404, 'NOT_FOUND');
  const made = expectOk(await a().post(`${API}/assets/${asset.id}/checkouts/${checkout.id}/form`), 201);
  expect(made.checkout.formAttachmentId).toBe(made.attachment.id);
});

it('the signed copy is saved, linked and marks the form received', async () => {
  const { checkout } = await checkOut();
  const pdf = Buffer.from('%PDF-1.4\n%signed\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const res = expectOk(await a().post(`${API}/assets/${asset.id}/checkouts/${checkout.id}/signed`).attach('file', pdf, 'scan 001.pdf'), 201);
  expect(res.attachment.originalName).toBe('Signed Checkout Form - LT-0042.pdf');
  expect(res.checkout.signedAttachmentId).toBe(res.attachment.id);
  expect(res.checkout.signedAttachment.originalName).toBe('Signed Checkout Form - LT-0042.pdf');
  expect(res.checkout.checkoutFormReturnedAt).toBeTruthy();

  // Deleting the signed copy unlinks it; the checkout stays received.
  expectOk(await a().delete(`${API}/assets/${asset.id}/attachments/${res.attachment.id}`));
  const after = await models.AssetCheckout.findByPk(checkout.id);
  expect(after.signedAttachmentId).toBeNull();
  expect(after.checkoutFormReturnedAt).toBeTruthy();
});

it('a signed copy needs a file, and a checkout of this asset', async () => {
  const { checkout } = await checkOut();
  expectErr(await a().post(`${API}/assets/${asset.id}/checkouts/${checkout.id}/signed`), 400, 'NO_FILE');
  expectErr(await a().post(`${API}/assets/${asset.id}/checkouts/999999/signed`).attach('file', Buffer.from('%PDF-1.4\n'), 'x.pdf'), 404, 'NOT_FOUND');
});
