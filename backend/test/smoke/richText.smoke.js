const { resetData, closeDb, models } = require('../integration/helpers');
const { makeAdmin } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// The rich-text editor (components/RichTextEditor, Tiptap 3), through the
// knowledge base article editor: typing, the toolbar's buttons and their
// on/off state, links, tables and colour all reach the saved HTML.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetData);

const pressed = async (page, name) => (await page.getByRole('button', { name, exact: true }).getAttribute('aria-pressed')) === 'true';

it('the article editor formats text, shows what is on, and saves it all', async () => {
  await makeAdmin();
  const page = await smoke.pageAs('admin');
  await page.goto('/knowledge/new');
  await page.getByLabel('Article title').fill('Resetting a printer');
  const body = page.locator('.ProseMirror');
  await body.click();

  // A heading, then a bold and underlined word in a paragraph.
  await page.getByRole('button', { name: 'Heading 2', exact: true }).click();
  await page.keyboard.type('Before you start');
  expect(await pressed(page, 'Heading 2')).toBe(true);
  await page.keyboard.press('Enter');
  expect(await pressed(page, 'Heading 2')).toBe(false);

  await page.keyboard.type('Turn it ');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await page.getByRole('button', { name: 'Underline', exact: true }).click();
  await page.keyboard.type('off');
  // The toolbar follows the caret (Tiptap 3 needs shouldRerenderOnTransaction).
  expect(await pressed(page, 'Bold')).toBe(true);
  expect(await pressed(page, 'Underline')).toBe(true);
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await page.getByRole('button', { name: 'Underline', exact: true }).click();
  await page.keyboard.type(' and on again.');
  expect(await pressed(page, 'Bold')).toBe(false);

  // A link on a selected word.
  await page.keyboard.press('Enter');
  await page.keyboard.type('Drivers');
  await page.keyboard.down('Shift');
  for (let i = 0; i < 'Drivers'.length; i += 1) await page.keyboard.press('ArrowLeft'); // eslint-disable-line no-await-in-loop
  await page.keyboard.up('Shift');
  page.once('dialog', (d) => d.accept('https://example.com/drivers'));
  await page.getByRole('button', { name: 'Add / edit link', exact: true }).click();
  expect(await pressed(page, 'Add / edit link')).toBe(true);
  await page.keyboard.press('End');

  // Red text, a list and a table.
  await page.keyboard.press('Enter');
  // The colour input is hidden behind the "A"; set it as the browser's picker would.
  await page.locator('label[title="Text color"] input[type="color"]').evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '#ff0000');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.keyboard.type('Unplug it first');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Bullet list', exact: true }).click();
  await page.keyboard.type('Wait ten seconds');
  expect(await pressed(page, 'Bullet list')).toBe(true);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Insert table', exact: true }).click();
  await page.keyboard.type('Model');

  // Undo is live once there is something to undo.
  expect(await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled()).toBe(false);

  await page.getByRole('button', { name: 'Create article' }).click();
  await page.waitForURL(/\/knowledge\/\d+\/edit$/);

  const article = await models.KbArticle.findOne({ where: { title: 'Resetting a printer' } });
  const html = article.body;
  expect(html).toMatch(/<h2[^>]*>Before you start<\/h2>/);
  // Bold and underlined (Tiptap may keep the space before "off" inside them).
  expect(html).toMatch(/<(strong|u)>(<(strong|u)>)?\s?off(<\/(strong|u)>){1,2}/);
  expect(html).toMatch(/<strong>[^<]*(<u>)?\s?off/);
  expect(html).toMatch(/<u>/);
  expect(html).toMatch(/<a [^>]*href="https:\/\/example\.com\/drivers"[^>]*>Drivers<\/a>/);
  expect(html).toMatch(/rel="noopener noreferrer nofollow"/);
  expect(html).toMatch(/color:\s*(#ff0000|rgb\(255, 0, 0\))/i);
  expect(html).toMatch(/<ul>[\s\S]*Wait ten seconds[\s\S]*<\/ul>/);
  expect(html).toMatch(/<table[\s\S]*<th[\s\S]*Model[\s\S]*<\/table>/);

  // Opening it again shows the same content in the editor.
  await page.reload();
  await page.locator('.ProseMirror h2', { hasText: 'Before you start' }).waitFor();
  await page.locator('.ProseMirror a[href="https://example.com/drivers"]').waitFor();
  await page.locator('.ProseMirror table').waitFor();
});
