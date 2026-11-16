// Errors the application deliberately tolerates: optional GPU subsystems that may be missing,
// best-effort cleanup, DOM elements that may not exist in a given layout.
//
// They used to disappear in empty `catch` blocks. Every such block now reports here, so the
// behaviour is unchanged but the errors are countable and, when needed, visible:
//   * add `?debugErrors` to the page URL, or
//   * run `localStorage.setItem('somata.debugSuppressedErrors', '1')` and reload,
// and each suppressed error is printed with `console.warn`.
// `window.__somataSuppressedErrors()` returns counts per place and the most recent messages.

const RECENT_LIMIT = 64;
const countsByScope = new Map();
const recent = [];

const debugEnabled = (() => {
  try {
    return (
      new URLSearchParams(globalThis.location?.search || '').has('debugErrors') ||
      globalThis.localStorage?.getItem('somata.debugSuppressedErrors') === '1'
    );
  } catch (error) {
    return false;
  }
})();

export function noteSuppressedError(scope, error) {
  countsByScope.set(scope, (countsByScope.get(scope) || 0) + 1);
  if (recent.length >= RECENT_LIMIT) recent.shift();
  recent.push({ scope, message: String(error?.message ?? error) });
  if (debugEnabled) console.warn(`[Somata suppressed] ${scope}:`, error);
}

export function suppressedErrorReport() {
  return {
    debugEnabled,
    total: [...countsByScope.values()].reduce((sum, n) => sum + n, 0),
    byScope: Object.fromEntries([...countsByScope.entries()].sort((a, b) => b[1] - a[1])),
    recent: recent.slice(),
  };
}

if (typeof window !== 'undefined') window.__somataSuppressedErrors = suppressedErrorReport;
