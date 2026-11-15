import axios from 'axios';

// The client portal's API client: its own base path and session (the portal
// session cookie lives on /api/v1/portal only), never the staff client, so a
// portal 401 never bounces anyone to the staff /login.
//
// Each company has its own portal (CS) at /portal/<slug>; its API is
// /api/v1/portal/c/<slug>. PortalApp sets the slug from the address before
// anything renders, and p() / apiPath() build paths within it.
const portalApi = axios.create({
  baseURL: '/api/v1/portal',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

let slug = '';
export function setPortalSlug(next) {
  slug = next || '';
  portalApi.defaults.baseURL = slug ? `/api/v1/portal/c/${encodeURIComponent(slug)}` : '/api/v1/portal';
}
export const portalSlug = () => slug;
// A page of this company's portal: p('/tickets') → /portal/acme/tickets.
export const p = (path = '') => `/portal/${encodeURIComponent(slug)}${path}`;
// This company's portal API, for links the browser follows itself.
export const apiPath = (path = '') => `/api/v1/portal/c/${encodeURIComponent(slug)}${path}`;
// Outside any company: the plain /portal address.
export const plainApi = axios.create({ baseURL: '/api/v1/portal', withCredentials: true, headers: { 'Content-Type': 'application/json' } });

const SIGNED_OUT_PAGES = ['/sign-in', '/forgot', '/reset', '/welcome'];

// Only a page of this company's portal may be a "come back here after
// signing in" target.
export function safeNext(raw) {
  const mine = p('/');
  return typeof raw === 'string' && raw.startsWith(mine) && raw.length > mine.length && !raw.includes('\\') && !raw.startsWith('//')
    ? raw : p('/tickets');
}

export function signInUrl() {
  const here = `${window.location.pathname}${window.location.search}`;
  return p(`/sign-in?next=${encodeURIComponent(safeNext(here))}`);
}

// A session that ended (signed out elsewhere, access removed) sends the
// contact back to sign in, except from the signed-out pages themselves.
portalApi.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || '';
    const probe = url === '/me' || url.startsWith('/auth/');
    if (status === 401 && !probe && !SIGNED_OUT_PAGES.some((page) => window.location.pathname.startsWith(p(page)))) {
      window.location.assign(signInUrl());
    }
    return Promise.reject(error);
  }
);

export function errMessage(error, fallback = 'Something went wrong') {
  return error?.response?.data?.message || fallback;
}

export default portalApi;
