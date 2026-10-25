const { CATALOG } = require('../../src/services/email/catalog');
const { renderTemplate, TRUSTED_HTML } = require('../../src/services/email/templates');

// Email templates: placeholders come from each key's whitelist, values are
// escaped unless the placeholder is server-built HTML, and every email gets
// the branded layout and a text part derived from the HTML.

const source = (subject, bodyHtml, placeholders) => ({ subject, bodyHtml, placeholders });
const P = (...names) => names.map((name) => ({ name, description: name }));
const brand = { orgName: 'Acme IT', hasLogo: false };

it('replaces whitelisted placeholders', () => {
  const out = renderTemplate(
    source('Ticket #{{ticket.number}}', '<p>Hi {{ contact.firstName }}, about {{ticket.title}}</p>', P('ticket.number', 'ticket.title', 'contact.firstName')),
    { ticket: { number: '00012', title: 'Printer' }, contact: { firstName: 'Ann' } },
    brand
  );
  expect(out.subject).toBe('Ticket #00012');
  expect(out.html).toContain('<p>Hi Ann, about Printer</p>');
});

it('unknown placeholders render empty', () => {
  const out = renderTemplate(
    source('{{ticket.secret}}x{{nope}}', '<p>[{{contact.email}}][{{ticket.title}}]</p>', P('ticket.title')),
    { ticket: { secret: 's3cret', title: 'T' }, contact: { email: 'a@b.c' } },
    brand
  );
  expect(out.subject).toBe('x');
  expect(out.html).toContain('<p>[][T]</p>');
  expect(out.html).not.toContain('s3cret');
});

it('escapes values unless the placeholder is html', () => {
  const placeholders = [...P('ticket.title', 'comment.body'), { name: 'signature', description: 's', html: true }];
  const out = renderTemplate(
    source('{{ticket.title}}', '<p>{{ticket.title}}|{{signature}}|{{comment.body}}</p>', placeholders),
    { ticket: { title: '<b>x</b> & "y"' }, signature: '<p><strong>Tech</strong></p>', comment: { body: '<img src=x onerror=alert(1)>' } },
    brand
  );
  expect(out.html).toContain('<p>&lt;b&gt;x&lt;/b&gt; &amp; "y"|<p><strong>Tech</strong></p>|&lt;img src=x onerror=alert(1)&gt;</p>');
  // The subject is plain text: not escaped.
  expect(out.subject).toBe('<b>x</b> & "y"');
});

it('trusted html only comes from the server-side symbol key', () => {
  const placeholders = P('comment.body');
  const fromJson = renderTemplate(source('s', '{{comment.body}}', placeholders),
    JSON.parse('{"comment":{"body":"<i>a</i>"},"__html":{"comment.body":"<b>raw</b>"}}'), brand);
  expect(fromJson.html).toContain('&lt;i&gt;a&lt;/i&gt;');
  expect(fromJson.html).not.toContain('<b>raw</b>');
  const trusted = renderTemplate(source('s', '{{comment.body}}', placeholders),
    { comment: { body: 'x' }, [TRUSTED_HTML]: { 'comment.body': 'a<br>b' } }, brand);
  expect(trusted.html).toContain('a<br>b');
});

it('strips CR/LF from the subject', () => {
  const out = renderTemplate(source('Re: {{ticket.title}}\r\nBcc: x@evil.com', '<p>b</p>', P('ticket.title')),
    { ticket: { title: 'one\r\ntwo\nthree' } }, brand);
  expect(out.subject).toBe('Re: one two three Bcc: x@evil.com');
  expect(out.subject).not.toMatch(/[\r\n]/);
});

it('text part is derived from the html', () => {
  const out = renderTemplate(source('s', '<p>Hello {{contact.firstName}}</p><p>See <a href="https://x.example/t/1">ticket</a></p>', P('contact.firstName')),
    { contact: { firstName: 'Ann' } }, brand);
  expect(out.text).toContain('Hello Ann\n\nSee ticket (https://x.example/t/1)');
  expect(out.text).not.toMatch(/<[a-z]/i);
});

it('layout carries the org name and a cid logo only when hasLogo', () => {
  const plain = renderTemplate(source('s', '<p>b</p>', []), {}, { orgName: 'Acme <IT>', hasLogo: false });
  expect(plain.html).toContain('Acme &lt;IT&gt;');
  expect(plain.html).not.toContain('<img');
  const logo = renderTemplate(source('s', '<p>b</p>', []), {}, { orgName: 'Acme', hasLogo: true });
  expect(logo.html).toContain('src="cid:org-logo"');
  expect(logo.html).not.toMatch(/src="https?:/);
});

it('every catalogue default only uses its own placeholders', () => {
  const keys = Object.keys(CATALOG);
  expect(keys.sort()).toEqual([
    'contact_auto_reply', 'contact_csat_survey', 'contact_resolved', 'contact_tech_reply',
    'staff_assigned', 'staff_budget_reached', 'staff_budget_warning', 'staff_new_in_queue', 'staff_reply', 'staff_sla_breached',
    'staff_sla_warning', 'staff_task_added', 'staff_task_unblocked', 'staff_watcher_update',
  ]);
  expect(Object.isFrozen(CATALOG)).toBe(true);
  for (const key of keys) {
    const t = CATALOG[key];
    const allowed = new Set(t.placeholders.map((p) => p.name));
    const used = [...`${t.subject} ${t.bodyHtml}`.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);
    expect({ key, unknown: used.filter((u) => !allowed.has(u)) }).toEqual({ key, unknown: [] });
    // Project notifications (sub-project 6) name the project instead of a ticket.
    expect(t.subject).toContain(/^staff_(task_|budget_)/.test(key) ? '[{{project.name}}]' : '[Ticket #{{ticket.number}}]');
    expect(['contact', 'staff']).toContain(t.audience);
    const htmlOnes = t.placeholders.filter((p) => p.html).map((p) => p.name);
    expect(htmlOnes.every((n) => ['signature', 'survey.starLinks'].includes(n))).toBe(true);
  }
  expect(CATALOG.contact_resolved.defaultEnabled).toBe(false);
  expect(CATALOG.contact_tech_reply.defaultEnabled).toBe(true);
});

it('a value cannot turn a link into javascript: or break out into markup', () => {
  const placeholders = [...P('ticket.title'), { name: 'signature', description: 's', html: true }];
  const out = renderTemplate(
    source('s', '<p><a href="{{ticket.title}}">x</a><a href="{{signature}}">y</a>{{signature}}</p>', placeholders),
    { ticket: { title: 'javascript:alert(1)' }, signature: '<b>sig</b>' },
    brand
  );
  expect(out.html).not.toMatch(/javascript:/i);
  // Trusted HTML lands only in text, never inside an attribute.
  expect(out.html).toMatch(/<a (href="" )?target="_blank" rel="noopener noreferrer nofollow">y<\/a><b>sig<\/b>/);
  expect(out.html.match(/<b>sig<\/b>/g)).toHaveLength(1);
});
