// Customer billing (Phase 3) is off until an Owner turns it on: while off,
// its routes answer as if they didn't exist.
const { moneyConfig } = require('../services/money/config');
const { ApiError } = require('./error');

async function requireCustomerBilling(req, res, next) {
  try {
    if (!(await moneyConfig()).customerBilling) throw new ApiError(404, 'Not found', 'NOT_FOUND');
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireCustomerBilling };
