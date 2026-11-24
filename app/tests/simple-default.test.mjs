import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadApp } from './helpers/app-env.mjs';
import defaults from '../../project-defaults.js';

test('Simple 16.4.2d is the new project and layer default', async () => {
  await loadApp();
  const {createLayer,createUserAddedLayer} = await import('../js/core/defaults-layers.js');
  assert.equal(createLayer().roundingCornerType,'simple');
  assert.equal(createUserAddedLayer('new').roundingCornerType,'simple');
  assert.ok(defaults.layers.length > 0);
  assert.ok(defaults.layers.every(l=>l.roundingCornerType==='simple'));
  const html = fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  assert.match(html,/<select id="paramRoundingCornerType"/);
  assert.match(html,/<option value="simple" selected>Простой<\/option>/);
  // Loader's established compatibility policy is not changed by the new-layer default.
  const loader=fs.readFileSync(new URL('../js/project/project-loader.js',import.meta.url),'utf8');
  assert.match(loader,/roundingCornerType: \['local', 'classic', 'fourier', 'simple'\]\.includes\(l\.roundingCornerType\)\s*\? l\.roundingCornerType\s*: 'classic'/);
});

 test('MonoRadius is enabled for new layers and startup but legacy imports retain standard fallback', async () => {
  await loadApp();
  const {createLayer,createUserAddedLayer} = await import('../js/core/defaults-layers.js');
  assert.equal(createLayer().roundingMode,'monoradius');
  assert.equal(createUserAddedLayer('new').roundingMode,'monoradius');
  assert.ok(defaults.layers.every(l=>l.roundingMode==='monoradius'));
  const html=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  assert.match(html,/id="paramMonoradiusCheck" type="checkbox" checked/);
  assert.match(html,/<option value="monoradius" selected>/);
  const loader=fs.readFileSync(new URL('../js/project/project-loader.js',import.meta.url),'utf8');
  assert.equal([...loader.matchAll(/const defaults = \{ \.\.\.createLayer\(\), roundingMode: 'standard' \};/g)].length,2);
  assert.equal([...loader.matchAll(/\.\.\.defaults,\s*\.\.\.l,/g)].length,2);
});
