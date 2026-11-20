// Корень приложения (URL сборки) и подпись значений сайдбара.
import '../ui/master-broadcast-core.js'; // initialisation order: this module runs after it
import { noteSuppressedError } from '../core/suppressed-errors.js';

const SOMATA_APP_ROOT_URL = (() => {
  try {
    const scriptUrl = document.currentScript?.src;
    if (scriptUrl) return new URL('../../', scriptUrl);
  } catch (error) {
    noteSuppressedError('app/app-paths', error);
  }
  try {
    return new URL('./', window.location.href);
  } catch (_) {
    return null;
  }
})();
function somataRootFileUrl(name) {
  const safeName = String(name || '').replace(/^\/+/, '');
  if (SOMATA_APP_ROOT_URL) return new URL(safeName, SOMATA_APP_ROOT_URL).href;
  return new URL(safeName, document.baseURI || window.location.href).href;
}
function setSidebarValueText(id, text) {
  const el = document.getElementById(id);
  if (el && document.activeElement !== el) el.textContent = text;
}

export { setSidebarValueText, somataRootFileUrl };
