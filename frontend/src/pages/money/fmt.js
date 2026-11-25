// Money formatting for the Money pages (Phase 3). Amounts arrive as strings
// ("1250.00"); they're shown, never computed with, here.
export const usd = (v) => (v === null || v === undefined || v === '' ? '—'
  : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
// A quantity without trailing zeros: "300.0000" → "300".
export const qty = (v) => String(v ?? '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
export const today = () => new Date().toLocaleDateString('en-CA');
export const EXPENSE_ACCOUNTS = [['6100', 'Office and software'], ['6200', 'Vehicle and fuel'], ['6300', 'Tools and equipment'], ['6900', 'Other expenses']];
export const accountName = (code) => (EXPENSE_ACCOUNTS.find(([c]) => c === code) || [code, code])[1];

// Downloads a file the API sends as an attachment (a bill's PDF, a CSV).
export async function download(api, url, filename, params) {
  const res = await api.get(url, { params, responseType: 'blob' });
  const href = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}
