const Sequelize = require('sequelize');
const {
  resetData, closeDb, models, sequelize,
} = require('./helpers');
const { makeWorld, makeCompany } = require('./fixtures');
const ledger = require('../../src/services/money/ledger');
const { downFrom, upFrom } = require('./moneyMigrations');
const migration = require('../../migrations/20260101000103-ledger');

// Phase 3, step 1, task 2: the double-entry ledger underneath every money
// record. Entries balance, are never changed, and are corrected by reversal.

let w;
let alpha;
const bal = async (filter = {}) => Object.fromEntries((await ledger.balances(filter)).map((b) => [b.code, b.balance]));
const sale = (extra = {}) => ledger.postEntry({
  date: '2026-12-01',
  memo: 'Invoice INV-1001',
  sourceType: 'invoice',
  sourceId: 1,
  companyId: alpha.id,
  lines: [
    { account: '1100', debit: '108.25' },
    { account: '4000', credit: '100.00' },
    { account: '2100', credit: '8.25' },
  ],
  ...extra,
});

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  alpha = await makeCompany(w.admin, { name: 'Alpha Dental' });
});
afterAll(closeDb);

it('has the fixed chart of accounts', async () => {
  const codes = (await models.LedgerAccount.findAll()).map((a) => a.code);
  for (const code of ['1000', '1010', '1100', '1200', '2000', '2100', '2200', '3000', '4000', '4100', '4200', '4300', '5000', '5100', '6000', '6100', '6200', '6300', '6900']) {
    expect(codes).toContain(code);
  }
  expect((await ledger.accountByCode('2100')).type).toBe('liability');
});

it('posts a balanced entry and reports balances by account', async () => {
  const entry = await sale();
  expect(entry.id).toEqual(expect.any(Number));
  const b = await bal();
  expect(b['1100']).toBe('108.25');
  expect(b['4000']).toBe('100.00');
  expect(b['2100']).toBe('8.25');
});

it('refuses an unbalanced, empty, two-sided or unknown-account entry, writing nothing', async () => {
  const bad = (lines) => ledger.postEntry({ date: '2026-12-01', memo: 'x', sourceType: 'test', lines });
  await expect(bad([{ account: '1100', debit: '100.00' }, { account: '4000', credit: '99.99' }])).rejects.toThrow(/balance/i);
  await expect(bad([{ account: '1100', debit: '0' }, { account: '4000', credit: '0' }])).rejects.toThrow(/zero|empty/i);
  await expect(bad([])).rejects.toThrow(/zero|empty/i);
  await expect(bad([{ account: '1100', debit: '5', credit: '5' }, { account: '4000', credit: '0' }])).rejects.toThrow(/debit or a credit/i);
  await expect(bad([{ account: '9999', debit: '5' }, { account: '4000', credit: '5' }])).rejects.toThrow(/account/i);
  await expect(bad([{ account: '1100', debit: '-5' }, { account: '4000', credit: '-5' }])).rejects.toThrow(/negative/i);
  await expect(bad([{ account: '1100', debit: 'abc' }, { account: '4000', credit: '5' }])).rejects.toThrow();
  expect(await models.LedgerEntry.count()).toBe(0);
  expect(await models.LedgerLine.count()).toBe(0);
});

it('reverses an entry once; balances go back to zero', async () => {
  const entry = await sale();
  const rev = await ledger.reverseEntry(entry.id, { date: '2026-12-05', memo: 'Void INV-1001' });
  expect(rev.reversesId).toBe(entry.id);
  const b = await bal();
  expect(b['1100']).toBe('0.00');
  expect(b['4000']).toBe('0.00');
  await expect(ledger.reverseEntry(entry.id, { date: '2026-12-06' })).rejects.toThrow(/already reversed/i);
  await expect(ledger.reverseEntry(rev.id, { date: '2026-12-06' })).rejects.toThrow(/reversal/i);
});

it('never changes or deletes an entry or a line', async () => {
  const entry = await sale();
  await expect(entry.update({ memo: 'changed' })).rejects.toThrow(/never changed/i);
  await expect(entry.destroy()).rejects.toThrow(/never changed/i);
  const line = await models.LedgerLine.findOne({ where: { entryId: entry.id } });
  await expect(line.update({ debit: '1.00' })).rejects.toThrow(/never changed/i);
  await expect(line.destroy()).rejects.toThrow(/never changed/i);
});

it('filters balances by company and by date', async () => {
  const beta = await makeCompany(w.admin, { name: 'Beta Law' });
  await sale();
  await sale({ companyId: beta.id, date: '2027-01-01' });
  expect((await bal({ companyId: alpha.id }))['1100']).toBe('108.25');
  expect((await bal({}))['1100']).toBe('216.50');
  expect((await bal({ to: '2026-12-31' }))['1100']).toBe('108.25');
  expect((await bal({ from: '2027-01-01' }))['1100']).toBe('108.25');
});

it('migration 103 rolls back and forward', async () => {
  const qi = sequelize.getQueryInterface();
  await downFrom('20260101000103');
  const names = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  expect(names).not.toContain('LedgerEntries');
  expect(names).not.toContain('LedgerAccounts');
  await upFrom('20260101000103');
  expect(await models.LedgerAccount.count()).toBeGreaterThanOrEqual(19);
});

it('merging companies moves the merged-away company\'s entries to the one kept', async () => {
  const { API, expectOk } = require('./fixtures');
  const beta = await makeCompany(w.admin, { name: 'Beta Law' });
  await sale({ companyId: beta.id });
  expectOk(await w.admin.agent.post(`${API}/companies/${beta.id}/merge`).send({ intoCompanyId: alpha.id }));
  expect((await bal({ companyId: alpha.id }))['1100']).toBe('108.25');
});
