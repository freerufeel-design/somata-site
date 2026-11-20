// The spiral step limiter row sits between the morph-type selector and the slide row and is shown
// only for the phase-circle morph.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read, declarations } = require('./helpers/source.cjs');

const html = read('../index.html');
const start = html.indexOf('id="testMorphControls"');
const selector = html.indexOf('id="testMorphMode"');
const limiter = html.indexOf('id="spiralStepLimiterRow"');
const slide = html.indexOf('id="testMorphSlideRow"');
assert(start < selector && selector < limiter && limiter < slide);
assert.match(
  html.slice(limiter, slide),
  /class="spiral-settings-row hidden" data-morph-option="spiralStepLimiter"/,
);
for (const id of ['spiralStepLimiterRow', 'paramSpiralStepLimiterEnabled', 'paramSpiralStepLimiter'])
  assert.equal(html.split(`id="${id}"`).length, 2);
const modes = [
  ...html.slice(selector, html.indexOf('</select>', selector)).matchAll(/<option value="([^"]+)"/g),
].map((m) => m[1]);
assert(modes.includes('phaseCircle'));

let hidden = true;
const row = {
  dataset: { morphOption: 'spiralStepLimiter' },
  classList: {
    toggle(name, value) {
      assert.equal(name, 'hidden');
      hidden = value;
    },
  },
};
const context = {
  window: { SomataMorphRegistry: { get: () => ({}) } },
  state: {},
  document: { querySelectorAll: () => [row], getElementById: () => null },
  noteSuppressedError() {},
};
const sync = vm.runInNewContext(declarations('syncModeOptions') + '\nsyncModeOptions', context);
for (const mode of ['phaseCircle', ...modes, 'phaseCircle', 'coordinated']) {
  sync(mode);
  assert.equal(hidden, mode !== 'phaseCircle', mode);
}
console.log('PASS: spiral limiter placement and visibility');
