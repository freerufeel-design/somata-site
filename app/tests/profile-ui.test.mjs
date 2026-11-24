import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../../index.html');
const group = html.slice(html.indexOf('id="profileSettingsGroup"'), html.indexOf('</aside>', html.indexOf('id="profileSettingsGroup"')));
const sync = read('../js/ui/sidebar-sync.js');
const bindings = read('../js/ui/controls/profile-and-layers.js');
test('closure checkboxes sit in the profile library row before tabs', () => {
  const row = group.slice(group.indexOf('class="control-row profile-library-controls"'), group.indexOf('id="profileLibraryTabs"'));
  for (const id of ['paramClosedLoop', 'paramSpiralRoundSeams']) {
    assert.match(row, new RegExp(`<input type="checkbox" id="${id}"`));
    assert.equal(html.split(`id="${id}"`).length, 2);
  }
  assert.match(row, /Смыкать профиль/);
  assert.match(row, /Скругление замыканий/);
});
test('profile point count and phase slider share an always-visible row', () => {
  const row = group.match(/<div id="profileModeTransitionPercentRow"[^>]*>[\s\S]*?<\/div>/)?.[0];
  assert.ok(row);
  assert.match(row, /class="profile-phase-points-row"/);
  assert.match(row, /id="profileModeTransitionPercent" type="range"/);
  assert.match(row, /id="profileSplinePointCount" type="number"/);
  assert.doesNotMatch(sync, /transitionPctRow|profileModeTransitionPercentRow/);
  assert.match(bindings, /getElementById\('profileSplinePointCount'\)/);
  assert.match(bindings, /getElementById\('profileModeTransitionPercent'\)/);
  assert.doesNotMatch(html, /data-spline-render-mode|id="profileSplineRenderRow"/);
  assert.doesNotMatch(bindings, /data-spline-render-mode/);
});
test('root Windows launcher starts its own local copy', () => {
  const root = new URL('../../', import.meta.url);
  const launches = readdirSync(root).filter(name => /\.(exe|bat|lnk|cmd)$/i.test(name));
  assert.deepEqual(launches, ['Somata_Start.exe']);
  const exe = readFileSync(new URL('Somata_Start.exe', root));
  assert.equal(exe.subarray(0, 2).toString(), 'MZ');
  assert.match(read('../tools/somata-launcher.c'), /GetModuleFileNameW\(0, directory,/);
  assert.match(read('../tools/somata-launcher.c'), /L"app\\\\start\.bat"/);
  assert.match(read('../tools/somata-launcher.c'), /ShellExecuteW\(0, L"open", script, 0, directory,/);
  assert.match(read('../start.bat'), /%~dp0serve\.ps1/);
});
