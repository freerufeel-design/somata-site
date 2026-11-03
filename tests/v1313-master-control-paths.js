'use strict';
// DOM-independent Master parameter resolution; protects no-op assignments.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const window={};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/ui/master-broadcast-core.js'),'utf8'),{window});
const core=window.SomataMasterBroadcastCore;
const source={glow:9,glowIntensity:60,strokeWidth:3,fill:true,fillColor:'#ff000044',fillRule:'evenodd',fillType:'dense',
  roundingMode:'standard',splineRenderMode:'smooth',lineProfile:'round',lineProfileStroke:'round',lineProfileApplication:'stroke',
  geometryCircles:{enabled:false,keyPoints:false},showWeb:false,sweep:{glow:14,glintEnabled:true,lightningEnabled:false},
  web:{width:.9},particles:{density:50},lamps:{brightness:80},sprite:{enabled:false,type:'star'}};
const eq=(id,expected,dataset)=>assert.deepEqual([...core.controlPaths(id,source,dataset)],expected,`Wrong fields for ${id}`);
eq('paramGlow',['glow']);
eq('numGlow',['glow']);
eq('btnIncGlow',['glow']);
eq('paramGlowIntensity',['glowIntensity']);
eq('paramStrokeWidth',['strokeWidth']);
eq('paramFillOpacity',['fillColor']);
eq('paramFillMode',['fillType','fillRule']);
eq('paramGeometryCircles',['geometryCircles.enabled']);
eq('circleModeKeyPoints',['geometryCircles.keyPoints']);
eq('showSweep',['sweep.glintEnabled']);
eq('webWidth',['web.width']);
eq('sweepGlow',['sweep.glow']);
eq('particleDensity',['particles.density']);
eq('lampBrightness',['lamps.brightness']);
eq('buttonWithNoId',['roundingMode'],{roundingMode:'standard'});
eq('buttonWithNoId',['lineProfileApplication','lineProfile','lineProfileStroke','sprite.enabled'],{lineMainMode:'point'});
eq('btnUnrelated',[]);
eq('paramBgColor',[]);
const original={sweep:{glow:3,enabled:false},glow:5},dest=core.clone(original);
core.applyPath(dest,'sweep.glow',14);
assert.equal(dest.sweep.glow,14);
assert.equal(original.sweep.glow,3);
assert(core.equal(dest,{sweep:{glow:14,enabled:false},glow:5}));
console.log('PASS Master field resolver and exact-path clone are independent of DOM/rendering');
