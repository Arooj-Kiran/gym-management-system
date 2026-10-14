// Apply the saved theme before first paint to avoid a light/dark flash.
// Kept as an external file so the strict Content-Security-Policy (no inline scripts) holds.
try {
  var saved = localStorage.getItem('gms-theme');
  var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', dark);
} catch {
  /* storage unavailable: keep the light theme */
}
