// Small display helpers shared by the portal pages.
export const ticketNo = (id) => `#${String(id).padStart(5, '0')}`;

export const statusTone = (behavior) => ({ on_hold: 'waiting', closed: 'neutral' }[behavior] || 'info');

// "Today, 9:31 AM", "Yesterday", "Oct 24", "Oct 24, 2025".
export function fmtUpdated(value) {
  if (!value) return '';
  const d = new Date(value);
  const now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return `Today, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  if (diff === 1) return 'Yesterday';
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

export const fmtDateTime = (value) => (value
  ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  : '');

export function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Files go one per request (the server scans each like a staff upload).
// Returns the names that failed, with why.
export async function uploadFiles(portalApi, ticketId, files, commentId) {
  const failed = [];
  for (const file of files) {
    const body = new FormData();
    if (commentId) body.append('commentId', String(commentId));
    body.append('file', file);
    try {
      // eslint-disable-next-line no-await-in-loop
      await portalApi.post(`/tickets/${ticketId}/attachments`, body, { headers: { 'Content-Type': 'multipart/form-data' } });
    } catch (err) {
      failed.push(`${file.name}: ${err?.response?.data?.message || 'could not be uploaded'}`);
    }
  }
  return failed;
}
