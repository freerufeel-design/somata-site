'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/core/self-test.js'),'utf8');
assert(src.includes('window.__somataRecoverySoakSmokeTest'),'Recovery soak API must exist');
assert(src.includes('backend hand-off')&&src.includes('resize recovery')&&src.includes('visibility recovery'),'Recovery soak must cover backend, resize and visibility boundaries');
assert(src.includes('suite.recovery=await window.__somataRecoverySoakSmokeTest'),'Release certification must include recovery soak');
assert(src.includes("const names=['Радуга','Мозголом','Секс','Fucking freak 3','Святой','Искры','4 Galaxy']"),'Recovery fixtures must cover Morph/Web/Corridor/rotation heavy projects');
console.log('Session recovery invariants: PASS');
