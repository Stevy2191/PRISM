const http = require('http');
const dns = require('dns');
const { publicGet, isDisallowedIp } = require('../../src/utils/publicFetch');

describe('isDisallowedIp', () => {
  test.each([
    '127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', '::', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', 'fe80::1', 'fd00::1',
    '64:ff9b::a9fe:a9fe', '2002:7f00:1::', 'ff02::1', 'not-an-ip',
  ])('refuses %s', (ip) => expect(isDisallowedIp(ip)).toBe(true));
  test.each(['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111', '::ffff:1.1.1.1'])(
    'allows %s', (ip) => expect(isDisallowedIp(ip)).toBe(false),
  );
});

describe('publicGet', () => {
  let server;
  let port;
  beforeAll(async () => {
    server = http.createServer((req, res) => res.end('secret'));
    await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
    ({ port } = server.address());
  });
  afterAll(() => new Promise((r) => { server.close(r); }));
  afterEach(() => jest.restoreAllMocks());

  test('refuses a private address written in the URL', async () => {
    await expect(publicGet(`http://127.0.0.1:${port}/`)).rejects.toThrow(/private or internal/);
    await expect(publicGet(`http://[::1]:${port}/`)).rejects.toThrow(/private or internal/);
  });

  test('refuses a name that resolves to a private address', async () => {
    await expect(publicGet(`http://localhost:${port}/`)).rejects.toThrow(/private or internal/);
  });

  test('checks the address the connection uses, not an earlier lookup (DNS rebinding)', async () => {
    // The name "resolves" to a public address the first time and to
    // loopback after: the connection's own lookup is the one checked.
    const real = dns.lookup;
    let calls = 0;
    jest.spyOn(dns, 'lookup').mockImplementation((host, opts, cb) => {
      calls += 1;
      if (host !== 'rebind.test') return real(host, opts, cb);
      const address = calls === 1 ? '93.184.216.34' : '127.0.0.1';
      return cb(null, opts && opts.all ? [{ address, family: 4 }] : address, 4);
    });
    dns.lookup('rebind.test', {}, () => {}); // a check made beforehand would pass
    await expect(publicGet(`http://rebind.test:${port}/`)).rejects.toThrow(/private or internal/);
  });

  test('only http and https, and no credentials in the URL', async () => {
    await expect(publicGet('file:///etc/passwd')).rejects.toThrow(/Only http/);
    await expect(publicGet('https://user:pw@example.com/')).rejects.toThrow(/user name or password/);
  });
});
