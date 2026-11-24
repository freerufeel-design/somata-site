import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importModule } from './helpers/app-env.mjs';

const root = { a: 2, b: 0, c: 0, d: 2, e: 400, f: 300 };

test('reference guide remains visible with no line or skeleton paths, and clears independently', async () => {
  const { state } = await importModule('js/core/state.js');
  const { getFrameReferenceRadius } = await importModule('js/geometry/reference-circle.js');
  const calls = [];
  const ctx = new Proxy({}, { get: (_, key) => (...args) => calls.push([key, ...args]) });
  const source = { width: 800, height: 600, style: { visibility: 'hidden' } };
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx };
  const oldGet = document.getElementById;
  const old = { showBoundingCircle: state.showBoundingCircle, showLines: state.showLines, layers: state.layers, zoom: state.zoom };
  document.getElementById = id => id === 'skeletonOverlayCanvas' ? canvas : id === 'mainCanvas' ? source : oldGet(id);
  try {
    const layer = { radius: 200, visible: true, lineVisible: true, testMorph: { showSkeleton: false } };
    state.layers = [layer];
    state.zoom = 1;
    state.showBoundingCircle = true;
    const overlay = window.SomataSkeletonOverlay;
    for (const visible of [true, false, true, false]) {
      layer.lineVisible = state.showLines = visible;
      overlay.begin();
      calls.length = 0;
      overlay.captureReferenceCircle(getFrameReferenceRadius({ layer, combinedScale: 1.5 }), root);
      overlay.present();
      assert.equal(canvas.style.display, 'block');
      assert.deepEqual(calls.filter(c => c[0] === 'arc'), [['arc', 0, 0, 300, 0, Math.PI * 2]]);
      assert.ok(calls.some(c => c[0] === 'setTransform' && c.slice(1).join(',') === '2,0,0,2,400,300'));
      assert.equal(source.style.visibility, 'hidden');
      assert.equal(canvas.width, 800);
    }
    // Turning the guide off must clear it, even before the next capture.
    state.showBoundingCircle = false;
    calls.length = 0;
    overlay.present();
    assert.equal(canvas.style.display, 'none');
    assert.ok(calls.some(c => c[0] === 'clearRect'));
    assert.ok(!calls.some(c => c[0] === 'arc'));
    // A new frame cannot accidentally present a stale radius.
    state.showBoundingCircle = true;
    overlay.begin();
    overlay.present();
    assert.equal(canvas.style.display, 'none');
  } finally {
    Object.assign(state, old);
    document.getElementById = oldGet;
  }
});

test('viewport reference guide is captured for the separate overlay and does not block GPU scene admission', () => {
  const read = path => readFileSync(new URL('../js/' + path, import.meta.url), 'utf8');
  const main = read('render/main-pipeline.js');
  const viewport = main.slice(main.indexOf('function renderMainViewportEffects'), main.indexOf('function recoverMainRenderError'));
  assert.match(viewport, /captureReferenceCircle\?\.\(maxR, mainCtx\.getTransform\(\)\)/);
  assert.doesNotMatch(viewport, /mainCtx\.arc\(/);
  assert.ok(main.indexOf('WebGPUFinalCompositeRenderer.render(renderFrame)') < main.indexOf('SomataSkeletonOverlay?.present?.()'));
  for (const path of ['gpu/final-composite-renderer.js', 'render/compositor-policy.js', 'render/geometry-scene-routing.js']) {
    assert.doesNotMatch(read(path), /state\.showBoundingCircle/);
  }
});
