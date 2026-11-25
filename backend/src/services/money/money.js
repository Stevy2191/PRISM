// Exact money (Phase 3). Every amount goes through here, never a JS float:
// decimal.js on its own constructor, rounding half up. Unit prices and costs
// keep 4 places (cable by the foot); final amounts round to cents.
const Decimal = require('decimal.js');

const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

// A Decimal from a string, number or Decimal. Anything else (empty, NaN,
// Infinity, text) is a TypeError: a bad amount never becomes 0 by accident.
function D(value) {
  if (value instanceof Money) return value;
  if (value instanceof Decimal) return new Money(value.toString());
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Not an amount');
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) throw new TypeError('Not an amount');
  let d;
  try { d = new Money(typeof value === 'string' ? value.trim() : value); } catch { throw new TypeError('Not an amount'); }
  if (!d.isFinite()) throw new TypeError('Not an amount');
  return d;
}

const cents = (value) => D(value).toFixed(2, Money.ROUND_HALF_UP);
const unit = (value) => D(value).toFixed(4, Money.ROUND_HALF_UP);
const sum = (values) => values.reduce((acc, v) => acc.plus(D(v)), new Money(0));
const percent = (amount, pct) => D(amount).times(D(pct)).div(100);
const isZero = (value) => D(value).isZero();

module.exports = {
  D, cents, unit, sum, percent, isZero,
};
