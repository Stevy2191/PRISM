const { parsePagination, paginated, DEFAULT_LIMIT, MAX_LIMIT, MAX_LIMIT_ALL } = require('../../src/utils/pagination');

const req = (query) => ({ query: query || {} });

describe('parsePagination', () => {
  test('defaults to page 1 at the default limit', () => {
    expect(parsePagination(req())).toEqual({ page: 1, limit: DEFAULT_LIMIT, offset: 0, all: false });
  });

  test('computes offset from page and limit', () => {
    expect(parsePagination(req({ page: '3', limit: '20' })))
      .toEqual({ page: 3, limit: 20, offset: 40, all: false });
  });

  test('clamps limit to the maximum', () => {
    expect(parsePagination(req({ limit: '99999' })).limit).toBe(MAX_LIMIT);
  });

  test('clamps nonsense page and limit values up to the minimum', () => {
    expect(parsePagination(req({ page: '0', limit: '0' }))).toEqual({ page: 1, limit: 1, offset: 0, all: false });
    expect(parsePagination(req({ page: '-5', limit: '-5' }))).toEqual({ page: 1, limit: 1, offset: 0, all: false });
    expect(parsePagination(req({ page: 'abc', limit: 'abc' })))
      .toEqual({ page: 1, limit: DEFAULT_LIMIT, offset: 0, all: false });
  });

  test('honours a per-endpoint default limit', () => {
    expect(parsePagination(req(), { defaultLimit: 10 }).limit).toBe(10);
  });

  test('honours a per-endpoint max limit', () => {
    expect(parsePagination(req({ limit: '500' }), { maxLimit: 200 }).limit).toBe(200);
  });

  test('limit=all opts out, capped at the escape-hatch ceiling', () => {
    const p = parsePagination(req({ limit: 'all' }));
    expect(p.all).toBe(true);
    expect(p.page).toBe(1);
    expect(p.offset).toBe(0);
    expect(p.limit).toBe(MAX_LIMIT_ALL);
  });

  test('limit=all can be refused by an endpoint', () => {
    expect(parsePagination(req({ limit: 'all' }), { allowAll: false }).all).toBe(false);
    expect(parsePagination(req({ limit: 'all' }), { allowAll: false }).limit).toBe(DEFAULT_LIMIT);
  });
});

describe('paginated', () => {
  test('wraps rows under the given key with page metadata', () => {
    const out = paginated('tickets', { rows: [{ id: 1 }], count: 91 }, { page: 2, limit: 10 });
    expect(out).toEqual({
      tickets: [{ id: 1 }], page: 2, limit: 10, total: 91, totalPages: 10,
    });
  });

  test('reports at least one page for an empty result', () => {
    expect(paginated('tickets', { rows: [], count: 0 }, { page: 1, limit: 25 }).totalPages).toBe(1);
  });

  test('counts a partial final page', () => {
    expect(paginated('x', { rows: [], count: 101 }, { page: 1, limit: 25 }).totalPages).toBe(5);
  });

  test('accepts a plain array count from findAndCountAll with group', () => {
    const out = paginated('x', { rows: [], count: [{ id: 1 }, { id: 2 }] }, { page: 1, limit: 25 });
    expect(out.total).toBe(2);
  });
});
