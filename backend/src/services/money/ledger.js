// The ledger (Phase 3, step 1): every money record posts here as a balanced
// double-entry entry. Entries are never changed; reverseEntry() corrects one.
const { Op } = require('sequelize');
const {
  LedgerAccount, LedgerEntry, LedgerLine, sequelize,
} = require('../../models');
const { D, cents, sum } = require('./money');

const NORMAL_DEBIT = new Set(['asset', 'expense']);

async function accountByCode(code, { transaction } = {}) {
  return LedgerAccount.findOne({ where: { code: String(code) }, transaction });
}

// A line's side as a Decimal, refusing a negative or two-sided line.
function sides(line) {
  const debit = line.debit === undefined || line.debit === null ? D(0) : D(line.debit);
  const credit = line.credit === undefined || line.credit === null ? D(0) : D(line.credit);
  if (debit.isNegative() || credit.isNegative()) throw new Error('A ledger line cannot be negative');
  if (!debit.isZero() && !credit.isZero()) throw new Error('A ledger line is a debit or a credit, not both');
  return { debit: D(cents(debit)), credit: D(cents(credit)) };
}

// → the LedgerEntry. Throws (writing nothing) unless the lines balance, are
// not all zero, and name known, active accounts.
async function postEntry({
  date, memo = null, sourceType, sourceId = null, companyId = null, lines, reversesId = null,
}, { transaction = null, userId = null } = {}) {
  if (!sourceType) throw new Error('A ledger entry needs a source');
  if (!Array.isArray(lines) || !lines.length) throw new Error('A ledger entry cannot be empty');
  const parsed = lines.map((l) => ({ account: l.account, ...sides(l) }));
  const debits = sum(parsed.map((l) => l.debit));
  const credits = sum(parsed.map((l) => l.credit));
  if (debits.isZero()) throw new Error('A ledger entry cannot be zero');
  if (!debits.equals(credits)) throw new Error(`A ledger entry must balance (debits ${cents(debits)}, credits ${cents(credits)})`);

  const write = async (t) => {
    const accounts = new Map();
    for (const l of parsed) {
      if (!accounts.has(l.account)) {
        // eslint-disable-next-line no-await-in-loop
        const account = await accountByCode(l.account, { transaction: t });
        if (!account || !account.active) throw new Error(`Unknown ledger account ${l.account}`);
        accounts.set(l.account, account);
      }
    }
    const entry = await LedgerEntry.create({
      entryDate: date, memo, sourceType, sourceId, companyId, reversesId, createdBy: userId,
    }, { transaction: t });
    await LedgerLine.bulkCreate(parsed.filter((l) => !(l.debit.isZero() && l.credit.isZero())).map((l) => ({
      entryId: entry.id, accountId: accounts.get(l.account).id, debit: cents(l.debit), credit: cents(l.credit),
    })), { transaction: t });
    return entry;
  };
  return transaction ? write(transaction) : sequelize.transaction(write);
}

// The mirror of an entry, dated `date`. An entry is reversed at most once,
// and a reversal is not itself reversed.
async function reverseEntry(entryId, {
  date, memo = null, transaction = null, userId = null,
} = {}) {
  const run = async (t) => {
    const entry = await LedgerEntry.findByPk(entryId, {
      include: [{ model: LedgerLine, as: 'lines', include: [{ model: LedgerAccount, as: 'account' }] }], transaction: t, lock: t.LOCK.UPDATE,
    });
    if (!entry) throw new Error('Ledger entry not found');
    if (entry.reversesId) throw new Error('A reversal cannot be reversed');
    if (await LedgerEntry.count({ where: { reversesId: entry.id }, transaction: t })) throw new Error('This entry is already reversed');
    return postEntry({
      date,
      memo: memo || `Reverses entry ${entry.id}`,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      companyId: entry.companyId,
      reversesId: entry.id,
      lines: entry.lines.map((l) => ({ account: l.account.code, debit: l.credit, credit: l.debit })),
    }, { transaction: t, userId });
  };
  return transaction ? run(transaction) : sequelize.transaction(run);
}

// → [{ code, name, type, debit, credit, balance }] for every account, over
// entries in [from, to] (dates, inclusive) and, if given, one company.
// The balance is debit-positive for assets and expenses, credit-positive
// for the rest.
async function balances({ from = null, to = null, companyId = null } = {}) {
  const entryWhere = {};
  if (from || to) entryWhere.entryDate = { ...(from ? { [Op.gte]: from } : {}), ...(to ? { [Op.lte]: to } : {}) };
  if (companyId) entryWhere.companyId = companyId;
  const [accounts, lines] = await Promise.all([
    LedgerAccount.findAll({ order: [['code', 'ASC']] }),
    LedgerLine.findAll({
      attributes: ['accountId', 'debit', 'credit'],
      include: [{ model: LedgerEntry, as: 'entry', attributes: [], where: entryWhere, required: true }],
      raw: true,
    }),
  ]);
  return accounts.map((a) => {
    const mine = lines.filter((l) => l.accountId === a.id);
    const debit = sum(mine.map((l) => l.debit));
    const credit = sum(mine.map((l) => l.credit));
    const balance = NORMAL_DEBIT.has(a.type) ? debit.minus(credit) : credit.minus(debit);
    return {
      code: a.code, name: a.name, type: a.type, debit: cents(debit), credit: cents(credit), balance: cents(balance),
    };
  });
}

module.exports = {
  postEntry, reverseEntry, balances, accountByCode,
};
