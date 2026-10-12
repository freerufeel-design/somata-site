'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const self=fs.readFileSync(path.join(root,'js/core/self-test.js'),'utf8');
assert(self.includes('window.__somataPlaylistVariantVisualSmokeTest=async'),'variant visual API missing');
assert(self.includes('window.__somataTemporalSoakSmokeTest=async'),'temporal soak API missing');
for(const token of [
  'sweep:lightning:perPath','sweep:lightning:everyNth','sweep:lightning:whole','sweep:glint:whole',
  'lamps:key','lamps:arbitrary:raster','lamps:key:raster','lamps:hd:rainbow','lamps:morph','lamps:arbitrary',
  'corridor:fill','corridor:glow','web:topology-morph'
]) assert(self.includes(token),`variant fixture missing: ${token}`);
for(const project of ['Радуга','Мозголом','Святой','ярко1','Секс','Fucking freak 3']) assert(self.includes(`'${project}'`),`temporal fixture missing: ${project}`);
assert(self.includes('pixelDiff(before,after)'),'variant/temporal suites must compare actual Canvas pixels');
assert(self.includes('validateModeStatus(entries[index]'),'temporal soak must re-check Morph/Corridor scheduler ownership');
assert(self.includes('scheduler paint error count increased'),'temporal soak must detect scheduler paint regressions');
console.log('Playlist variant / temporal soak invariants: PASS');
