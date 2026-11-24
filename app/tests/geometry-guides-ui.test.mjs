import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readGeometryGuides, setGeometryGuide } from '../js/ui/geometry-guides.js';
import { profileModeLiveLabel } from '../js/ui/profile-mode-live.js';

const makeState = () => ({ layers: [{ testMorph: { enabled: true, mode: 'circleSlide' } }, {}], showLines: false, showBoundingCircle: false, roundingGuidesOverlayEnabled: false, showRoundingGuides: false });
test('global geometry control toggles all three overlays without changing line visibility or morph configuration', () => {
  const state = makeState();
  assert.equal(readGeometryGuides(state).any, false);
  setGeometryGuide(state, 'all', !readGeometryGuides(state).all);
  assert.equal(readGeometryGuides(state).all, true);
  assert.ok(state.layers.every(l => l.testMorph.showSkeleton));
  assert.equal(state.layers[0].testMorph.mode, 'circleSlide');
  assert.equal(state.layers[0].testMorph.enabled, true);
  assert.equal(state.showLines, false);
  assert.equal(state.showRoundingGuides, false);
  setGeometryGuide(state, 'all', !readGeometryGuides(state).all);
  assert.equal(readGeometryGuides(state).any, false);
});
test('each context-menu option is independent and a partial group can be enabled together', () => {
  const state = makeState();
  state.layers[0].testMorph.showSkeleton = true;
  assert.equal(readGeometryGuides(state).someSkeleton, true);
  assert.equal(readGeometryGuides(state).skeleton, false);
  setGeometryGuide(state, 'circle', true);
  assert.equal(readGeometryGuides(state).extensions, false);
  assert.equal(readGeometryGuides(state).someSkeleton, true);
  setGeometryGuide(state, 'extensions', true);
  assert.equal(state.showRoundingGuides, false);
  setGeometryGuide(state, 'skeleton', false);
  assert.equal(readGeometryGuides(state).circle, true);
  assert.equal(readGeometryGuides(state).extensions, true);
  assert.equal(readGeometryGuides(state).someSkeleton, false);
  setGeometryGuide(state, 'all', !readGeometryGuides(state).all);
  assert.equal(readGeometryGuides(state).all, true);
});
test('profile status displays all four mode combinations and an idle value', () => {
  for (const [from, fromName] of [['segments','Отрезки'], ['spline','Сплайн']]) {
    for (const [to, toName] of [['segments','Отрезки'], ['spline','Сплайн']]) {
      const opts = { current: from, from, to, progress: .42 };
      if (from !== to) opts.weight = .23;
      assert.equal(profileModeLiveLabel(opts), `${fromName} → ${toName} · ${from === to ? 42 : 23}%`);
    }
  }
  assert.equal(profileModeLiveLabel({ current: 'spline' }), 'Сплайн → Сплайн · 100%');
});
test('guide toggles exist only in the popup; live status is below phase fraction and not hidden', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const menu = html.slice(html.indexOf('id="geometryGuidesMenu"'), html.indexOf('id="floatingViewportControls"'));
  for (const id of ['testMorphSkeleton', 'paramShowBoundingCircle', 'paramShowRoundingGuides', 'paramRoundingGuidesDashed', 'paramRoundingGuideColor', 'paramRoundingGuideOpacity']) {
    assert.ok(menu.includes(`id="${id}"`));
    assert.equal(html.split(`id="${id}"`).length, 2);
  }
  const profile = html.slice(html.indexOf('id="profileSettingsGroup"'), html.indexOf('</aside>', html.indexOf('id="profileSettingsGroup"')));
  assert.ok(profile.indexOf('id="profileModeLive"') > profile.indexOf('id="profileModeTransitionPercentRow"'));
  assert.doesNotMatch(profile.match(/<div id="profileModeLive"[^>]*>/)[0], /hidden/);
});
