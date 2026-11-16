// The Light morph has a continuous phase: no per-frame `frameChange`, obsolete time-sampling code is
// gone, Fade percent controls exist, and both controllers drive the light keyframe continuously.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadApp } from './helpers/app-env.mjs';

const require = createRequire(import.meta.url);
const { read, listModules, moduleOf } = require('./helpers/source.cjs');
const compact = (s) => s.replace(/\s+/g, '');

test('light morph is continuous and obsolete controls are gone', async () => {
  await loadApp();
  assert.equal(globalThis.SomataMorphRegistry.get('light').frameChange, undefined);

  const sources = ['index.html', ...listModules()].map(read);
  for (const source of sources) assert.doesNotMatch(source, /lightFrameChange|SomataMorphTimeSampling/i);

  const html = read('index.html');
  assert.match(html, /id="morphFadePercent" type="range"/);
  assert.match(html, /id="testMorphFadePercent" type="range"/);

  // Blue Morph playback and the manual controller sample the light keyframe on every frame.
  const blue = compact(read(moduleOf('createMorphPlaybackModule')));
  assert.ok(
    blue.includes(compact('updateLightMorphKeyframe(t, runtimeState.morph.lightGeometryBucket === -1)')),
  );
  const manual = compact(read('js/morph-runtime/manual-morph.js'));
  assert.ok(manual.includes(compact('const visual = sample(r.from, r.to, t, activeCfg)')));
});
