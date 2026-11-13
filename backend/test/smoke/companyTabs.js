// A company's page has five tabs; a tab with several parts shows them as a
// second row. openCompanyTab(page, 'People', 'Departments') opens one.
async function openCompanyTab(page, tab, part) {
  await page.getByRole('navigation', { name: 'Company sections' }).getByRole('button', { name: tab, exact: true }).click();
  if (part) await page.getByRole('group', { name: `${tab} parts` }).getByRole('button', { name: part, exact: true }).click();
}

module.exports = { openCompanyTab };
