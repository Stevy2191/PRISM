// Contractor and supplier reports (Phase 3, step 2): paid per vendor in a
// year, 1099 totals, and open bills by age. money.bills.manage or
// money.books.view. Each also as CSV (?format=csv).
const { Op } = require('sequelize');
const { Bill, Company } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { sendCsv } = require('../reports/shared');
const { orgToday } = require('../../utils/orgTime');
const { moneyConfig } = require('../../services/money/config');
const { D, cents, sum } = require('../../services/money/money');

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
function yearOf(q) {
  const y = Number(q.year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new ApiError(400, 'Choose a year like 2026', 'VALIDATION_ERROR');
  return y;
}

// One row per vendor with a bill entered (billDate) or paid (paidOn) in the year.
async function paidByVendor(year) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const rows = await Bill.findAll({
    where: {
      status: { [Op.in]: ['entered', 'paid'] },
      [Op.or]: [{ billDate: { [Op.between]: [from, to] } }, { paidOn: { [Op.between]: [from, to] } }],
    },
    include: [{ model: Company, as: 'vendor', attributes: ['id', 'name', 'is1099'] }],
  });
  const by = new Map();
  for (const b of rows) {
    const r = by.get(b.vendorCompanyId) || {
      vendorCompanyId: b.vendorCompanyId, vendor: b.vendor.name, is1099: b.vendor.is1099, billed: [], paid: [], bills: 0,
    };
    if (b.billDate >= from && b.billDate <= to) { r.billed.push(b.total); r.bills += 1; }
    if (b.status === 'paid' && b.paidOn >= from && b.paidOn <= to) r.paid.push(b.total);
    by.set(b.vendorCompanyId, r);
  }
  return [...by.values()]
    .map((r) => ({ ...r, billed: cents(sum(r.billed)), paid: cents(sum(r.paid)) }))
    .sort((x, y) => D(y.paid).comparedTo(D(x.paid)) || x.vendor.localeCompare(y.vendor));
}

const VENDOR_COLUMNS = [
  { key: 'vendor', label: 'Vendor' }, { key: 'is1099', label: 'Gets a 1099' }, { key: 'bills', label: 'Bills' },
  { key: 'billed', label: 'Billed' }, { key: 'paid', label: 'Paid' },
];

const paid = asyncHandler(async (req, res) => {
  const year = yearOf(req.query);
  const vendors = await paidByVendor(year);
  if (req.query.format === 'csv') return sendCsv(res, `paid-by-vendor-${year}`, VENDOR_COLUMNS, vendors.map((v) => ({ ...v, is1099: v.is1099 ? 'yes' : 'no' })));
  return res.json({ year, vendors });
});

const form1099 = asyncHandler(async (req, res) => {
  const year = yearOf(req.query);
  const threshold = (await moneyConfig()).form1099Threshold;
  const vendors = (await paidByVendor(year)).filter((v) => v.is1099 && D(v.paid).greaterThanOrEqualTo(D(threshold)));
  if (req.query.format === 'csv') {
    return sendCsv(res, `1099-${year}`, [{ key: 'vendor', label: 'Vendor' }, { key: 'paid', label: `Paid in ${year}` }], vendors);
  }
  return res.json({ year, threshold, vendors });
});

const BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'];
const bucketOf = (days) => (days <= 0 ? 'current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+');
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

const openBills = asyncHandler(async (req, res) => {
  const asOf = isDate(req.query.asOf) ? req.query.asOf : await orgToday();
  const rows = await Bill.findAll({
    where: { status: 'entered' },
    include: [{ model: Company, as: 'vendor', attributes: ['id', 'name'] }],
    order: [['dueDate', 'ASC'], ['billDate', 'ASC']],
  });
  const bills = rows.map((b) => {
    const due = b.dueDate || b.billDate; // no due date: due on receipt
    const daysOverdue = daysBetween(due, asOf);
    return {
      id: b.id, vendorCompanyId: b.vendorCompanyId, vendor: b.vendor.name, billNumber: b.billNumber, billDate: b.billDate, dueDate: due, externalRef: b.externalRef, total: cents(b.total), daysOverdue, bucket: bucketOf(daysOverdue),
    };
  });
  const totals = Object.fromEntries(BUCKETS.map((k) => [k, cents(sum(bills.filter((b) => b.bucket === k).map((b) => b.total)))]));
  totals.all = cents(sum(bills.map((b) => b.total)));
  if (req.query.format === 'csv') {
    return sendCsv(res, `open-bills-${asOf}`, [
      { key: 'vendor', label: 'Vendor' }, { key: 'billNumber', label: 'Bill' }, { key: 'externalRef', label: 'Reference' }, { key: 'billDate', label: 'Bill date' },
      { key: 'dueDate', label: 'Due' }, { key: 'daysOverdue', label: 'Days overdue' }, { key: 'bucket', label: 'Age' }, { key: 'total', label: 'Amount' },
    ], bills);
  }
  return res.json({ asOf, bills, totals });
});

module.exports = { paid, form1099, openBills };
