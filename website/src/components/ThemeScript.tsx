const THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('paperkite-theme');
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.setAttribute('data-theme', stored);
    }
  } catch (e) {}
})();
`;

/** Applies a saved theme override before first paint, so toggling
 *  Light/Dark doesn't flash back to the system default on reload. */
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
