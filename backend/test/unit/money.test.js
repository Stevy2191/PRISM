const {
  D, cents, unit, sum, percent, isZero,
} = require('../../src/services/money/money');

// Phase 3, step 1: money is exact (never a JS float).

it('rounds to cents half up, also for negatives', () => {
  expect(cents('0.105')).toBe('0.11');
  expect(cents('0.104')).toBe('0.10');
  expect(cents('-0.005')).toBe('-0.01');
  expect(cents('1e3')).toBe('1000.00');
});

it('adds without float error', () => {
  expect(cents(D('0.1').plus('0.2'))).toBe('0.30');
  expect(sum(['0.10', '0.20', '0.30']).toFixed(2)).toBe('0.60');
  expect(sum([]).toFixed(2)).toBe('0.00');
});

it('keeps unit prices to 4 places', () => {
  expect(unit('0.18')).toBe('0.1800');
  expect(unit(D('180').div('1000'))).toBe('0.1800');
  expect(unit('0.20699')).toBe('0.2070');
});

it('takes a percentage', () => {
  expect(percent('100', '8.25').toFixed(2)).toBe('8.25');
  expect(percent('80', '8.25').toFixed(2)).toBe('6.60');
});

it('refuses what is not a number', () => {
  expect(() => D('')).toThrow(TypeError);
  expect(() => D(NaN)).toThrow(TypeError);
  expect(() => D(Infinity)).toThrow(TypeError);
  expect(() => D('abc')).toThrow(TypeError);
  expect(() => D(null)).toThrow(TypeError);
});

it('knows zero', () => {
  expect(isZero('0.00')).toBe(true);
  expect(isZero('0.001')).toBe(false);
});
