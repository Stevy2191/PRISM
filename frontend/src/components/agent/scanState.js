// Where a Scan now request stands: none, waiting for the computer's next
// check-in, or late (no answer after 15 minutes: three missed check-ins).
export const SCAN_LATE_MS = 15 * 60 * 1000;

export function scanState(device, now = Date.now()) {
  if (!device || !device.scanRequestedAt) return 'none';
  return now - new Date(device.scanRequestedAt).getTime() > SCAN_LATE_MS ? 'late' : 'waiting';
}

// While a scan is pending, how often a page asks PRISM again (so the new
// details show up without a refresh); null when nothing is pending.
export const scanPollMs = (device) => (scanState(device) === 'waiting' ? 20 * 1000 : null);
