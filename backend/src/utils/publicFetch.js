// GET a URL that a user typed (an iCal feed) without letting it reach
// anything but the public internet: no loopback, private networks,
// link-local (the cloud metadata address), CGNAT, or the IPv6 forms that
// carry one of those inside (IPv4-mapped, NAT64, 6to4).
//
// The address is checked when the connection is made, on the address the
// connection actually uses (a lookup hook), not by a separate lookup
// beforehand, so a name that resolves to a public address for the check and
// a private one for the fetch (DNS rebinding) is refused. Every redirect hop
// is checked the same way. Bounded in time and size.
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');

const blocked = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].forEach(([a, bits]) => blocked.addSubnet(a, bits, 'ipv4'));
[
  ['::', 128], ['::1', 128], ['::', 96], // unspecified, loopback, IPv4-compatible
  ['64:ff9b::', 96], ['64:ff9b:1::', 48], // NAT64
  ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], // discard, IETF, docs, 6to4
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
].forEach(([a, bits]) => blocked.addSubnet(a, bits, 'ipv6'));

function isDisallowedIp(ip) {
  if (net.isIPv4(ip)) return blocked.check(ip, 'ipv4');
  if (net.isIPv6(ip)) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return isDisallowedIp(mapped[1]);
    // ::ffff:7f00:1, the hex spelling of an IPv4-mapped address.
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
    if (hex) {
      const n = (parseInt(hex[1], 16) << 16 | parseInt(hex[2], 16)) >>> 0;
      return isDisallowedIp([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
    }
    return blocked.check(ip, 'ipv6');
  }
  return true; // not an address: fail closed
}

const PRIVATE_MESSAGE = 'That URL resolves to a private or internal address, which is not allowed';

// dns.lookup, refusing a private address (all of them, when asked for all).
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some((a) => isDisallowedIp(a.address))) {
      const refused = new Error(PRIVATE_MESSAGE);
      refused.code = 'EPRIVATEADDRESS';
      return callback(refused);
    }
    if (options && options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

// { status, ok, headers: { get }, text() } for a GET of url, following up to
// `redirects` redirects. Throws on a refused address, a timeout, or a body
// over maxBytes.
async function publicGet(inputUrl, {
  headers = {}, timeoutMs = 15000, maxBytes = 5 * 1024 * 1024, redirects = 5,
} = {}) {
  const url = new URL(inputUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http:// and https:// URLs are allowed');
  if (url.username || url.password) throw new Error('URLs with a user name or password are not allowed');
  // A literal address never goes through the lookup hook.
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(literal) && isDisallowedIp(literal)) throw new Error(PRIVATE_MESSAGE);

  const res = await new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, {
      method: 'GET', headers, lookup: guardedLookup, agent: false, timeout: timeoutMs,
    }, (response) => {
      const status = response.statusCode;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.resume();
        return resolve({ redirect: response.headers.location || '', status });
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          response.destroy();
          reject(new Error(`The response is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ status, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
      return undefined;
    });
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
    req.end();
  });

  if ('redirect' in res) {
    if (!res.redirect) throw new Error('Redirect response is missing a Location header');
    if (redirects <= 0) throw new Error('Too many redirects');
    return publicGet(new URL(res.redirect, url).toString(), {
      headers, timeoutMs, maxBytes, redirects: redirects - 1,
    });
  }
  return {
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    headers: { get: (name) => res.headers[String(name).toLowerCase()] ?? null },
    text: async () => res.body.toString('utf8'),
  };
}

module.exports = { publicGet, isDisallowedIp };
