import axios from 'axios';

// The client portal's API client: its own base path and session (the portal
// session cookie lives on /api/v1/portal only), never the staff client, so a
// portal 401 never bounces anyone to the staff /login.
const portalApi = axios.create({
  baseURL: '/api/v1/portal',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

const SIGNED_OUT_PAGES = ['/portal/sign-in', '/portal/forgot', '/portal/reset', '/portal/welcome'];

// Only a portal path may be a "come back here after signing in" target.
export function safeNext(raw) {
  return typeof raw === 'string' && /^\/portal\/[^/\\]/.test(raw) && !raw.startsWith('//') ? raw : '/portal/tickets';
}

export function signInUrl() {
  const here = `${window.location.pathname}${window.location.search}`;
  return `/portal/sign-in?next=${encodeURIComponent(safeNext(here))}`;
}

// A session that ended (signed out elsewhere, access removed) sends the
// contact back to sign in, except from the signed-out pages themselves.
portalApi.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || '';
    const probe = url === '/me' || url.startsWith('/auth/');
    if (status === 401 && !probe && !SIGNED_OUT_PAGES.some((p) => window.location.pathname.startsWith(p))) {
      window.location.assign(signInUrl());
    }
    return Promise.reject(error);
  }
);

export function errMessage(error, fallback = 'Something went wrong') {
  return error?.response?.data?.message || fallback;
}

export default portalApi;
