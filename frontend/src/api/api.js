import axios from 'axios';

// Central Axios client. All requests go to /api/v1 (same-origin; proxied to the
// backend by Vite in dev and by nginx in production). Session cookie is sent
// automatically via withCredentials.
const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// On a 401, drop the user back to the login screen (unless we're already there,
// or the failing call is the auth probe itself).
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || '';
    const isAuthProbe = url.includes('/auth/me') || url.includes('/auth/login');
    if (status === 401 && !isAuthProbe && window.location.pathname !== '/login') {
      window.location.assign('/login');
    }
    return Promise.reject(error);
  }
);

// Normalize backend error shape { error, message, code } into a readable string.
export function errMessage(error, fallback = 'Something went wrong') {
  return error?.response?.data?.message || error?.message || fallback;
}

export default api;
