// The install page's first guess at the visitor's system (8d): Windows, Mac
// or Linux; Windows when unsure. Phones and tablets get Windows too (they
// can't install the agent; the page lets the visitor pick).
export function detectSystem(nav) {
  const platform = String((nav && nav.userAgentData && nav.userAgentData.platform) || (nav && nav.platform) || '');
  const ua = String((nav && nav.userAgent) || '');
  const all = `${platform} ${ua}`;
  if (/iPhone|iPad|Android/i.test(all)) return 'windows';
  if (/Mac/i.test(all)) return 'macos';
  if (/Linux|X11|CrOS/i.test(all)) return 'linux';
  return 'windows';
}
