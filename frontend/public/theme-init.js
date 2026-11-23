// Apply the saved light/dark/system preference before paint, via the
// data-theme attribute, to avoid a flash of the wrong base theme. Falls back
// to "dark" (the app's default) if nothing is stored. A file of its own, not
// an inline script, so the Content-Security-Policy can refuse inline scripts.
(function () {
  try {
    var t = localStorage.getItem('prism.theme') || 'dark';
    var resolved = t === 'dark' || t === 'light'
      ? t
      : ((window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', resolved);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
