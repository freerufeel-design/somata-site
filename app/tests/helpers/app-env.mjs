// Loads the whole application in Node for integration-style tests.
//
// There is no DOM or GPU in Node, so a permissive stub stands in for `document`, canvases and
// friends: every unknown property is a callable, chainable stub. Rendering does nothing; the
// geometry, morph and state code runs for real. The `load` event never fires, so the boot
// sequence in js/app/boot.js does not run — tests that need booted state set it explicitly.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function stub(name = 'stub') {
  const store = new Map();
  return new Proxy(function () {}, {
    get(_t, k) {
      if (k === Symbol.toPrimitive) return (hint) => (hint === 'number' ? 0 : '');
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;
      if (k === 'length') return 0;
      if (k === 'style' || k === 'dataset') {
        if (!store.has(k)) store.set(k, {});
        return store.get(k);
      }
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'getContext') return () => null;
      if (k === 'querySelectorAll' || k === 'getElementsByClassName' || k === 'getElementsByTagName')
        return () => [];
      if (k === 'getBoundingClientRect')
        return () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 });
      if (['width', 'height', 'clientWidth', 'clientHeight', 'offsetWidth', 'offsetHeight'].includes(k))
        return store.has(k) ? store.get(k) : 300;
      if (store.has(k)) return store.get(k);
      const s = stub(String(k));
      store.set(k, s);
      return s;
    },
    set(_t, k, v) {
      store.set(k, v);
      return true;
    },
    apply: () => stub(name + '()'),
    construct: () => stub('new ' + name),
    has: () => true,
  });
}

function installBrowserStubs() {
  const g = globalThis;
  if (g.__somataNodeStubs) return;
  g.__somataNodeStubs = true;
  g.window = g;
  g.self = g;
  g.document = stub('document');
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  g.dispatchEvent = () => true;
  g.requestAnimationFrame = () => 0;
  g.cancelAnimationFrame = () => {};
  g.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
  });
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.sessionStorage = g.localStorage;
  for (const c of ['HTMLElement', 'HTMLCanvasElement', 'Element', 'Node', 'Image']) g[c] = class {};
  g.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  g.MutationObserver = g.ResizeObserver;
  g.IntersectionObserver = g.ResizeObserver;
  g.getComputedStyle = () => stub('computedStyle');
  g.innerWidth = 1400;
  g.innerHeight = 900;
  g.devicePixelRatio = 1;
  g.location = {
    href: 'http://localhost/index.html',
    search: '',
    hash: '',
    pathname: '/index.html',
    origin: 'http://localhost',
  };
  g.alert = () => {};
  g.confirm = () => false;
  g.prompt = () => null;
  Object.defineProperty(g, 'navigator', {
    value: { userAgent: 'node', platform: 'node', maxTouchPoints: 0, hardwareConcurrency: 2, language: 'ru' },
    configurable: true,
  });
}

let appPromise = null;
/** Imports js/main.js once and returns the debug API (window.__somataDebugApi). */
export function loadApp({ quiet = true } = {}) {
  if (!appPromise) {
    installBrowserStubs();
    const restore = { warn: console.warn, error: console.error, log: console.log };
    if (quiet) {
      console.warn = () => {};
      console.error = () => {};
      console.log = () => {};
    }
    appPromise = import(pathToFileURL(path.join(ROOT, 'js/main.js')).href).then(
      () => {
        if (!quiet) Object.assign(console, restore);
        return globalThis.__somataDebugApi;
      },
      (e) => {
        Object.assign(console, restore);
        throw e;
      },
    );
  }
  return appPromise;
}

/** Imports one application module (after loading the whole app, so its dependencies are initialised). */
export async function importModule(rel) {
  await loadApp();
  return import(pathToFileURL(path.join(ROOT, rel)).href);
}
