import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { PrismClient, PrismApiError, apiBase, toQuery } from '../src/prismClient.js';
import { createMcpServer, createHttpServer, bearerToken, originAllowed } from '../src/server.js';
import { TOOLS, WRITE_TOOL_NAMES, formatResult, MAX_RESULT_CHARS } from '../src/tools.js';

const GOOD_KEY = 'prism_goodkey0123456789';

// A fake PRISM: records every request and answers a few endpoints.
let fake;
let fakeUrl;
const seen = [];

before(async () => {
  fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      seen.push({ method: req.method, path: url.pathname, query: url.searchParams, key: req.headers['x-api-key'], body: raw ? JSON.parse(raw) : undefined });
      const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (req.headers['x-api-key'] !== GOOD_KEY) return send(401, { error: true, message: 'Invalid or expired API key', code: 'INVALID_API_KEY' });
      const route = `${req.method} ${url.pathname}`;
      switch (route) {
        case 'GET /api/v1/auth/me': return send(200, { user: { id: 7, name: 'Tech' } });
        case 'GET /api/v1/tickets': return send(200, { tickets: [{ id: 42 }], page: 1, limit: 25, total: 1, totalPages: 1 });
        case 'GET /api/v1/tickets/LITS-T0042':
        case 'GET /api/v1/tickets/42': return send(200, { ticket: { id: 42, number: 'LITS-T0042', title: 'Printer' } });
        case 'GET /api/v1/tickets/LITS-T9999': return send(404, { error: true, message: 'Ticket not found', code: 'NOT_FOUND' });
        case 'GET /api/v1/tickets/42/comments': return send(200, { comments: [{ id: 1, body: 'hi' }] });
        case 'PATCH /api/v1/tickets/42': return send(200, { ticket: { id: 42, status: 'Resolved' } });
        case 'POST /api/v1/tickets/42/comments': return send(201, { comment: { id: 2 } });
        case 'POST /api/v1/tickets/42/time': return send(201, { entry: { id: 3 } });
        case 'GET /api/v1/html': res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html></html>');
        default: return send(404, { error: true, message: 'Not found', code: 'NOT_FOUND' });
      }
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  fakeUrl = `http://127.0.0.1:${fake.address().port}`;
});

after(() => fake.close());

function lastRequest() { return seen[seen.length - 1]; }

async function connect({ readOnly = false, key = GOOD_KEY } = {}) {
  const server = createMcpServer(new PrismClient({ url: fakeUrl, apiKey: key }), { readOnly });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const textOf = (result) => result.content[0].text;

test('apiBase accepts the site root or the API path', () => {
  assert.equal(apiBase('https://help.example.com'), 'https://help.example.com/api/v1');
  assert.equal(apiBase('https://help.example.com/'), 'https://help.example.com/api/v1');
  assert.equal(apiBase('https://help.example.com/api/v1/'), 'https://help.example.com/api/v1');
  assert.equal(apiBase('https://example.com/prism?x=1'), 'https://example.com/prism/api/v1');
  assert.throws(() => apiBase(''), /PRISM_URL is not set/);
  assert.throws(() => apiBase('ftp://x'), /https/);
  assert.throws(() => apiBase('not a url'), /not a valid URL/);
});

test('toQuery skips empty values and repeats arrays', () => {
  assert.equal(toQuery({ a: 1, b: undefined, c: '', d: null, s: ['x', 'y'] }), '?a=1&s=x&s=y');
  assert.equal(toQuery({}), '');
});

test('the client sends the key and turns PRISM errors into PrismApiError', async () => {
  const good = new PrismClient({ url: fakeUrl, apiKey: GOOD_KEY });
  assert.deepEqual(await good.get('/auth/me'), { user: { id: 7, name: 'Tech' } });
  assert.equal(lastRequest().key, GOOD_KEY);

  const bad = new PrismClient({ url: fakeUrl, apiKey: 'prism_wrong' });
  await assert.rejects(bad.get('/auth/me'), (err) => err instanceof PrismApiError && err.status === 401 && err.code === 'INVALID_API_KEY');
  await assert.rejects(good.get('/html'), /something other than JSON/);
  const down = new PrismClient({ url: 'http://127.0.0.1:1', apiKey: GOOD_KEY });
  await assert.rejects(down.get('/auth/me'), (err) => err.code === 'NETWORK_ERROR');
  assert.throws(() => new PrismClient({ url: fakeUrl }), /API key is required/);
});

test('every tool is listed, and read-only mode leaves out the ones that change things', async () => {
  const all = await connect();
  const names = (await all.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, TOOLS.map((t) => t.name).sort());

  const ro = await connect({ readOnly: true });
  const roNames = (await ro.listTools()).tools.map((t) => t.name);
  assert.ok(roNames.length > 0);
  for (const name of WRITE_TOOL_NAMES) assert.ok(!roNames.includes(name), `${name} should be hidden`);
  assert.ok(WRITE_TOOL_NAMES.has('prism_add_ticket_comment'));
  assert.ok(WRITE_TOOL_NAMES.has('prism_update_ticket'));
});

test('get_ticket reads by company number and includes the conversation', async () => {
  const client = await connect();
  const result = await client.callTool({ name: 'prism_get_ticket', arguments: { ticket: 'LITS-T0042' } });
  const data = JSON.parse(textOf(result));
  assert.equal(data.ticket.number, 'LITS-T0042');
  assert.equal(data.comments.length, 1);
  assert.equal(lastRequest().path, '/api/v1/tickets/42/comments');
});

test('list_tickets maps filters onto PRISM\'s query names', async () => {
  const client = await connect();
  await client.callTool({ name: 'prism_list_tickets', arguments: { status: ['not_closed', 'On Hold'], assigneeId: 5, myTickets: true, unassigned: false } });
  const q = lastRequest().query;
  assert.deepEqual(q.getAll('status'), ['not_closed', 'On Hold']);
  assert.equal(q.get('assignee'), '5');
  assert.equal(q.get('myTickets'), 'true');
  assert.equal(q.get('unassigned'), null);
  assert.equal(q.get('limit'), '25');
});

test('writes resolve a company number to the id the write endpoints need', async () => {
  const client = await connect();
  await client.callTool({ name: 'prism_update_ticket', arguments: { ticket: 'LITS-T0042', status: 'Resolved', assigneeId: null } });
  const req = lastRequest();
  assert.equal(req.method, 'PATCH');
  assert.equal(req.path, '/api/v1/tickets/42');
  assert.deepEqual(req.body, { status: 'Resolved', assigneeId: null });

  await client.callTool({ name: 'prism_log_ticket_time', arguments: { ticket: 42, durationMinutes: 30, note: 'Swapped toner' } });
  assert.deepEqual(lastRequest().body, { durationMinutes: 30, note: 'Swapped toner' });
});

test('comments default to a private note; a reply has to be asked for', async () => {
  const client = await connect();
  await client.callTool({ name: 'prism_add_ticket_comment', arguments: { ticket: 42, body: 'Checked the logs' } });
  assert.deepEqual(lastRequest().body, { body: 'Checked the logs', type: 'comment_private' });
  await client.callTool({ name: 'prism_add_ticket_comment', arguments: { ticket: 42, body: 'Fixed!', kind: 'reply' } });
  assert.equal(lastRequest().body.type, 'reply');
});

test('an update with nothing to change is refused before calling PRISM', async () => {
  const client = await connect();
  const before = seen.length;
  const result = await client.callTool({ name: 'prism_update_ticket', arguments: { ticket: 42 } });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /at least one field/);
  assert.equal(seen.length, before);
});

test('PRISM errors come back as tool errors with a hint, not crashes', async () => {
  const missing = await (await connect()).callTool({ name: 'prism_get_ticket', arguments: { ticket: 'LITS-T9999' } });
  assert.equal(missing.isError, true);
  assert.match(textOf(missing), /NOT_FOUND/);
  const badKey = await (await connect({ key: 'prism_wrong' })).callTool({ name: 'prism_whoami', arguments: {} });
  assert.equal(badKey.isError, true);
  assert.match(textOf(badKey), /revoked, expired/);
});

test('large results are cut with a note', () => {
  const text = textOf(formatResult({ big: 'x'.repeat(MAX_RESULT_CHARS * 2) }));
  assert.ok(text.length < MAX_RESULT_CHARS + 200);
  assert.match(text, /Cut at/);
});

test('bearerToken and originAllowed', () => {
  assert.equal(bearerToken('Bearer prism_abc'), 'prism_abc');
  assert.equal(bearerToken('bearer   prism_abc '), 'prism_abc');
  assert.equal(bearerToken('Basic abc'), null);
  assert.equal(bearerToken(undefined), null);
  assert.equal(originAllowed(undefined, []), true);
  assert.equal(originAllowed('https://evil.example', []), false);
  assert.equal(originAllowed('https://ok.example', ['https://ok.example']), true);
});

test('HTTP mode: each request acts with its own bearer key, and needs one', async () => {
  const httpServer = createHttpServer({ url: fakeUrl, readOnly: false, allowedOrigins: [] });
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${httpServer.address().port}`;
  try {
    const health = await fetch(`${base}/health`);
    assert.equal((await health.json()).ok, true);

    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } };
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

    const noKey = await fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify(init) });
    assert.equal(noKey.status, 401);
    assert.match(noKey.headers.get('www-authenticate'), /Bearer/);

    const evil = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${GOOD_KEY}`, Origin: 'https://evil.example' }, body: JSON.stringify(init) });
    assert.equal(evil.status, 403);

    const get = await fetch(`${base}/mcp`, { headers: { Authorization: `Bearer ${GOOD_KEY}` } });
    assert.equal(get.status, 405);

    const client = new Client({ name: 'http-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${GOOD_KEY}` } },
    }));
    const result = await client.callTool({ name: 'prism_whoami', arguments: {} });
    assert.equal(JSON.parse(textOf(result)).user.id, 7);
    assert.equal(lastRequest().key, GOOD_KEY);
    await client.close();
  } finally {
    httpServer.close();
  }
});
