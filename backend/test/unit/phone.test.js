const { normalizePhone, normalizePhoneLenient, formatPhone } = require('../../src/utils/phone');

// Every phone number is stored as 10 digits and shown (XXX) XXX-XXXX.

it('stores 10 digits whatever the typing, dropping a leading country code 1', () => {
  for (const typed of ['9792776200', '(979) 277-6200', '979.277.6200', '+1 979 277 6200', '1-979-277-6200']) {
    expect(normalizePhone(typed)).toBe('9792776200');
  }
  expect(normalizePhone('')).toBeNull();
  expect(normalizePhone(null)).toBeNull();
});

it('refuses anything that is not 10 digits; the lenient form gives null', () => {
  for (const bad of ['555-0100', '+44 20 7946 0958', '22345678901']) {
    expect(() => normalizePhone(bad)).toThrow('Phone number must be 10 digits');
    expect(normalizePhoneLenient(bad)).toBeNull();
  }
});

it('shows (XXX) XXX-XXXX, and anything else as it is', () => {
  expect(formatPhone('9792776200')).toBe('(979) 277-6200');
  expect(formatPhone('19792776200')).toBe('(979) 277-6200');
  expect(formatPhone('ext 12')).toBe('ext 12');
  expect(formatPhone(null)).toBe('');
});

it('an extension is 1 to 4 digits, and shows after the number', () => {
  const { normalizeExtension, normalizeExtensionLenient } = require('../../src/utils/phone'); // eslint-disable-line global-require
  expect(normalizeExtension('1234')).toBe('1234');
  expect(normalizeExtension('x 42')).toBe('42');
  expect(normalizeExtension('')).toBeNull();
  expect(() => normalizeExtension('12345')).toThrow('An extension is up to 4 digits');
  expect(normalizeExtensionLenient('12345')).toBeNull();
  expect(formatPhone('9792776200', '1234')).toBe('(979) 277-6200 ext. 1234');
});
