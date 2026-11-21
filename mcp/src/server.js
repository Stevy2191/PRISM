// Builds the MCP server and the two ways to run it.
//
//   stdio — Claude Desktop / Claude Code start this program themselves; the
//           API key comes from PRISM_API_KEY in its environment.
//   http  — Streamable HTTP for clients that connect by URL. Each request
//           carries its own PRISM API key as "Authorization: Bearer <key>",
//           so the server holds no credential and every caller acts as
//           themselves. It never falls back to PRISM_API_KEY: an HTTP
//           endpoint that answered without a key would hand that key's
//           access to anyone who can reach the port.
import http from 'node:http';
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { PrismClient } from './prismClient.js';
import { registerTools } from './tools.js';

const { version } = createRequire(import.meta.url)('../package.json');

const INSTRUCTIONS = [
  'These tools work with PRISM, a help desk and project management system for IT teams and managed service providers.',
  'Every call acts as the PRISM user who owns the API key, with exactly their permissions.',
  'Tickets are referred to by id or by company ticket number (for example LITS-T0042).',
  'A ticket "reply" is emailed to the customer: show the user the text and get their go-ahead before sending one.',
  'Prefer a private note for internal reasoning, and do not change a ticket the user did not ask you to change.',
].join(' ');

export function createMcpServer(client, { readOnly = false } = {}) {
  const server = new McpServer({ name: 'prism', version }, { instructions: INSTRUCTIONS });
  registerTools(server, client, { readOnly });
  return server;
}

export function configFromEnv(env = process.env) {
  return {
    url: env.PRISM_URL,
    apiKey: env.PRISM_API_KEY,
    readOnly: /^(1|true|yes)$/i.test(env.PRISM_MCP_READ_ONLY || ''),
    host: env.PRISM_MCP_HOST || '127.0.0.1',
    port: parseInt(env.PRISM_MCP_PORT || '8787', 10),
    allowedOrigins: (env.PRISM_MCP_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

export async function runStdio(config) {
  const client = new PrismClient({ url: config.url, apiKey: config.apiKey });
  const server = createMcpServer(client, { readOnly: config.readOnly });
  await server.connect(new StdioServerTransport());
  // stdout is the protocol channel; anything for people goes to stderr.
  process.stderr.write(`prism-mcp ${version}: connected to ${client.base}${config.readOnly ? ' (read-only)' : ''}\n`);
}

const MAX_BODY_BYTES = 1024 * 1024;

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function rpcError(res, status, message, headers) {
  sendJson(res, status, { jsonrpc: '2.0', error: { code: -32000, message }, id: null }, headers);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('Body is not valid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

export function bearerToken(header) {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header || '');
  return m ? m[1] : null;
}

// A browser page on another site must not be able to drive this server with
// a key the browser happens to hold. Requests without an Origin (Claude
// Code, Claude Desktop, server-side clients) are fine; ones with an Origin
// must be on the allow list.
export function originAllowed(origin, allowedOrigins) {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}

export function createHttpServer(config, { clientFactory = (apiKey) => new PrismClient({ url: config.url, apiKey }) } = {}) {
  // Fail at start-up, not on the first request, if PRISM_URL is wrong.
  new PrismClient({ url: config.url, apiKey: 'startup-check' });

  return http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, service: 'prism-mcp', version });
    }
    if (path !== '/mcp') return sendJson(res, 404, { error: 'Not found. The MCP endpoint is /mcp.' });

    if (!originAllowed(req.headers.origin, config.allowedOrigins)) {
      return rpcError(res, 403, 'Origin not allowed');
    }
    // Stateless: no sessions to resume, so no GET stream or DELETE.
    if (req.method !== 'POST') {
      return rpcError(res, 405, 'Method not allowed', { Allow: 'POST' });
    }
    const apiKey = bearerToken(req.headers.authorization);
    if (!apiKey) {
      return rpcError(res, 401, 'Send your PRISM API key as "Authorization: Bearer <key>"', {
        'WWW-Authenticate': 'Bearer realm="prism-mcp"',
      });
    }

    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return rpcError(res, err.status || 400, err.message);
    }

    // A fresh server and transport per request: nothing from one caller's
    // request (their key, their client) can reach another's.
    const server = createMcpServer(clientFactory(apiKey), { readOnly: config.readOnly });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      process.stderr.write(`prism-mcp: request failed: ${err && err.message}\n`);
      if (!res.headersSent) rpcError(res, 500, 'Internal server error');
    }
    return undefined;
  });
}

export async function runHttp(config) {
  const server = createHttpServer(config);
  await new Promise((resolve) => server.listen(config.port, config.host, resolve));
  const where = `http://${config.host}:${config.port}/mcp`;
  process.stderr.write(`prism-mcp ${version}: listening on ${where}${config.readOnly ? ' (read-only)' : ''}\n`);
  if (config.host !== '127.0.0.1' && config.host !== 'localhost' && config.host !== '::1') {
    process.stderr.write('prism-mcp: listening beyond this machine. Put it behind HTTPS (a reverse proxy) so API keys are never sent in the clear.\n');
  }
  return server;
}
