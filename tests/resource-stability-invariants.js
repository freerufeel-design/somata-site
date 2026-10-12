'use strict';
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const self=fs.readFileSync(path.join(root,'js/core/self-test.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const motion=fs.readFileSync(path.join(root,'js/effects/motion.js'),'utf8');
const checks=[
  ['resource stability API exists',/window\.__somataResourceStabilitySoakTest=async/.test(self)],
  ['resource stability cert gate exists',/suite\.resourceStability=await window\.__somataResourceStabilitySoakTest/.test(self)],
  ['heavy project fixtures covered',/\['Радуга','Мозголом','Секс','Fucking freak 3','Святой','Искры','4 Galaxy'\]/.test(self)],
  ['resource limit enforcement exists',/value>limit/.test(self)&&/limitIssues/.test(self)],
  ['monotonic retained growth detection exists',/monotonic growth/.test(self)&&/growthIssues/.test(self)],
  ['bounded LRU warm-up uses published limit rather than false leak detection',/const bounded=cycleSnapshots\.some/.test(self)&&/if\(bounded\)continue/.test(self)],
  ['scheduler paint errors guarded',/scheduler paintErrors/.test(self)],
  ['GPU diagnostic growth guarded',/GPU diagnostic errors/.test(self)],
  ['release identity 7.3.20',/version:'7\.3\.20'/.test(self)&&/<title>Somata 7\.3\.20<\/title>/.test(html)],
  ['cache epoch v7320',/v=20261012-v7320/.test(html)],
  ['shared geometry structural key excludes version serial',motion.includes('geometryVersion is an invalidation signal, not part of structural identity.')&&!motion.includes('|gv:${geometryVersion}')],
  ['transient Morph/frame layers excluded from shared LRU',motion.includes('const sharedEligible=Array.isArray(state?.layers)&&state.layers.includes(layer);')&&motion.includes('if(sharedEligible)sharedLayerDrawDataPut(sharedKey,cached)')]
];
let fail=0;
for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)fail++;}
process.exitCode=fail?1:0;
