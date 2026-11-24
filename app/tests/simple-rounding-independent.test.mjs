import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { importModule } from './helpers/app-env.mjs';
const record=fn=>{const cmds=[];fn(new Proxy({}, {get:(_,k)=>(...args)=>cmds.push([k,...args])}));return cmds;};
test('Simple spline uses its own spline renderer even at zero rounding', async()=>{
 const {somataDrawSplineCornerMode}=await importModule('js/geometry/spline-corner-mode.js');
 const {drawSimpleSpline}=await importModule('js/geometry/spline-rounding.js');
 const pts=[{x:0,y:0},{x:20,y:30},{x:90,y:0},{x:60,y:-40},{x:0,y:-20}];
 const flags=[true,false,true,false,true];
 for(const value of [0,.01,.65,1,1.65,2]) for(const closed of [false,true]) {
   const layer={roundingCornerType:'simple',profileMode:'spline',splineRenderMode:'smooth'};
   const expected=record(ctx=>drawSimpleSpline(ctx,pts,closed,value,flags));
   const actual=record(ctx=>somataDrawSplineCornerMode(ctx,pts,closed,value,{layer,baseSplineBlend:1,cornerFlags:flags,sharpJunctions:true}));
   assert.deepEqual(actual,expected);
   assert.ok(actual.some(c=>c[0]==='bezierCurveTo'));
 }
});
test('Compact selector retains four distinct saved values and Simple default',()=>{
 const html=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
 const method=html.match(/<select id="paramRoundingCornerType"[^>]*>(.*?)<\/select>/s)?.[1];
 assert.deepEqual([...method.matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]),['simple','fourier','local','classic']);
 assert.match(method,/<option value="simple" selected>/);
 assert.match(html,/id="roundingPrevMethod"/);assert.match(html,/id="roundingNextMethod"/);
 assert.match(html,/id="paramMonoradiusCheck" type="checkbox"/);
});
test('Simple drawing commands match the original 6.7 algorithms on 48 open/closed cases',async()=>{
 const {drawSimpleSpline}=await importModule('js/geometry/spline-rounding.js');
 const {drawSimplePolyline}=await importModule('js/geometry/polyline-rounding.js');
 const golden=JSON.parse(fs.readFileSync(new URL('./simple-rounding-6.7-golden.json',import.meta.url),'utf8'));
 for(const {kind,closed,value,pts,flags,commands} of golden){
  const actual=record(ctx=>(kind==='spline'?drawSimpleSpline:drawSimplePolyline)(ctx,pts,closed,value,flags));
  const label=`${kind} closed=${closed} value=${value} flags=${flags.length}`;
  assert.equal(actual.length,commands.length,label);
  for(let i=0;i<commands.length;i++){
   assert.equal(actual[i][0],commands[i][0],label);
   assert.equal(actual[i].length,commands[i].length,label);
   for(let k=1;k<commands[i].length;k++)assert.ok(Math.abs(actual[i][k]-commands[i][k])<1e-9,`${label} command ${i}:${k} ${actual[i][k]} != ${commands[i][k]}`);
  }
 }
});
