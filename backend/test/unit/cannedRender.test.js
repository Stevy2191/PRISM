const { renderPlainText } = require('../../src/services/email/templates');

// Canned responses are plain text: placeholders filled, nothing escaped (the
// text goes into the reply box; the reply is escaped when it is emailed).

it('renderPlainText fills allowed placeholders, blanks unknown ones, does not escape', () => {
  const ctx = { ticket: { number: '00042', title: 'A <b>bold</b> & "quoted" title' }, contact: { firstName: 'Ann' } };
  const out = renderPlainText('Hi {{contact.firstName}}, re #{{ ticket.number }}: {{ticket.title}} {{secret.thing}}{{ticket.missing}}.', ctx, [
    'contact.firstName', 'ticket.number', 'ticket.title', 'ticket.missing',
  ]);
  expect(out).toBe('Hi Ann, re #00042: A <b>bold</b> & "quoted" title .');
});

it('renderPlainText never reads outside the allowed names or into objects', () => {
  expect(renderPlainText('{{ticket}}|{{constructor.name}}|{{__proto__}}', { ticket: { a: 1 } }, ['ticket', 'constructor.name', '__proto__']))
    .toBe('||');
});
