import test from 'node:test';
import assert from 'node:assert/strict';
import {importModule} from './helpers/app-env.mjs';
import {readFileSync} from 'node:fs';
const {state}=await importModule('js/core/state.js');
const {createLayer}=await importModule('js/core/defaults-layers.js');
const {FillMeshPreparer}=await importModule('js/render/fill-plan.js');
const {spiralFillTransitionProgress}=await importModule('js/morph-runtime/blue/fill-lookahead.js');
const layer={...createLayer(),id:'mask-test',spiralEnabled:true,spiralOrder:1,spiralClosed:true,spiralFillEnabled:true,spiralFillType:'chopped'};
const circle=(r,i)=>({closed:true,spiralBranchIndex:i,alpha:1,points:Array.from({length:129},(_,j)=>({x:r*Math.cos(j*Math.PI/64),y:r*Math.sin(j*Math.PI/64)}))});
let fid=0;
const frame=(over={})=>({layer,frameId:++fid,geometryPlan:{dynamic:false},...over});
// Emulate the parity/nonzero stencil by counting signed ray crossings
// of the real contour edges in the emitted triangle fan.
function winding(mesh,x,y,group=null){let w=0; const f=mesh.fanData;const lo=group?group.start*6:0,hi=group?(group.start+group.count)*6:mesh.fanFloatCount;for(let i=lo;i<hi;i+=6){const ax=f[i+2],ay=f[i+3],bx=f[i+4],by=f[i+5];if((ay>y)===(by>y))continue;if(x<(bx-ax)*(y-ay)/(by-ay)+ax)w+=by>ay?1:-1;}return w;}
test('chopped fills adjacent pairs for odd and even turn counts; no exterior leakage',()=>{
 for(const n of [3,4,5,6,7]){const rails=Array.from({length:n},(_,i)=>circle(10*(i+1),i)); const m=FillMeshPreparer.prepareSpiralMaskFill(frame(),rails,false,false);assert.ok(m?.nativeComplete);assert.equal(winding(m,10*n+1,.123),0);for(let k=1;k<n;k++){const filled=winding(m,k*10+5,.123)!==0;assert.equal(filled,(n-k)%2===1,`N=${n},band=${k}`);} assert.equal(winding(m,5,.123),0);}
});
test('mathematical masks invert on every overlap, including coincident contours',()=>{
 layer.spiralFillType='mathematical';const rails=[circle(10,0),circle(20,1),circle(30,2)]; const m=FillMeshPreparer.prepareSpiralMathematical(frame(),rails); assert.ok(m?.spiralMathematicalFill);assert.equal(Math.abs(winding(m,5,.123))%2,1);assert.equal(Math.abs(winding(m,15,.123))%2,0);assert.equal(Math.abs(winding(m,25,.123))%2,1);const dup=FillMeshPreparer.prepareSpiralMathematical(frame(),[circle(20,0),circle(20,1)]);assert.equal(Math.abs(winding(dup,5,.123))%2,0);
});
test('corridor turns share one geometry mask, not multiple alpha composites',()=>{
 layer.spiralFillType='chopped';const rails=[circle(10,0),circle(20,1),circle(30,2)];const m=FillMeshPreparer.prepareSpiralMaskFill(frame({visibleInstances:{copies:[{scale:1},{scale:4}],alphas:[1,1]}}),rails,true,false);assert.ok(m?.corridorBaked);assert.equal(m.fanGroups.length,1);assert.equal(winding(m,121,.123),0);assert.equal(winding(m,100,.123)!==0,true);assert.equal(winding(m,60,.123),0);
});
test('source/target masks use the actual selected phase window',()=>{
 const rails=[0,1,2,3].map(i=>({...circle(10*(i+1),i),sourceBranchIndex:i,targetBranchIndex:i,sourcePresent:i<3,targetPresent:true}));
 const expected=(mode,t)=>spiralFillTransitionProgress(t,{profileModeTransition:mode,profileModeTransitionPercent:20});
 assert.equal(expected('start',.1),.5);assert.equal(expected('start',.3),1);assert.equal(expected('end',.5),0);assert.ok(Math.abs(expected('end',.9)-.5)<1e-12);assert.equal(expected('phase',.5),.5);
 for(const mode of ['start','end','phase']){state.morph.profileModeTransition=mode;state.morph.profileModeTransitionPercent=20;const t=mode==='start'?.1:mode==='end'?.9:.5;const m=FillMeshPreparer.prepareSpiralMaskFill(frame({morphFrameActive:true,geometryPlan:{dynamic:true},blueMorphProvider:{linearProgress:t}}),rails,false,false);assert.ok(m?.spiralFillPhaseManaged);assert.equal(m.fanGroups.length,2);assert.ok(m.fanGroups.every(g=>Math.abs(g.power-.5)<1e-10));}
});
test('three menu modes, forced XOR for mathematical and union for layering',()=>{
 const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');const select=html.match(/<select id="paramSpiralFillType"[\s\S]*?<\/select>/)[0];assert.deepEqual([...select.matchAll(/value="([^"]+)"/g)].map(m=>m[1]),['chopped','bandXor','mathematical']);const gpu=readFileSync(new URL('../js/gpu/fill-mesh-renderer.js',import.meta.url),'utf8');assert.match(gpu,/mesh\.spiralMathematicalFill === true \|\|/);assert.match(gpu,/!mesh\.spiralChoppedFill/);
});

test('layering and new mathematical use identical ribbon boundaries but different overlap rules',()=>{
 const rail=(id,x,y)=>({spiralBranchIndex:id,alpha:1,points:[{x,y},{x:x+10,y}]});
 const rails=[rail(0,0,0),rail(1,0,4),rail(2,5,2),rail(3,5,6),rail(4,30,30)];
 const samples=[[2,1],[7,3],[12,5],[20,5],[30,31]];
 layer.spiralFillType='chopped';const a=FillMeshPreparer.prepareSpiralMaskFill(frame(),rails,false,false);
 const union=samples.map(([x,y])=>winding(a,x,y)!==0);
 layer.spiralFillType='bandXor';const b=FillMeshPreparer.prepareSpiralMaskFill(frame(),rails,false,false);
 const xor=samples.map(([x,y])=>Math.abs(winding(b,x,y))%2===1);
 assert.deepEqual(union,[true,true,true,false,false]);assert.deepEqual(xor,[true,false,true,false,false]);
 assert.equal(b.spiralMathematicalFill,true);assert.equal(b.spiralChoppedFill,false);
});
test('self-overlap of a ribbon is cancelled by parity, not by layering',()=>{
 const double=(r,i)=>({...circle(r,i),points:[...circle(r,i).points,...circle(r,i).points.slice(1)]});
 const rails=[double(20,0),double(10,1)];
 layer.spiralFillType='chopped';const a=FillMeshPreparer.prepareSpiralMaskFill(frame(),rails,false,false);
 assert.notEqual(winding(a,15,.12),0);
 layer.spiralFillType='bandXor';const b=FillMeshPreparer.prepareSpiralMaskFill(frame(),rails,false,false);
 assert.equal(Math.abs(winding(b,15,.12))%2,0);
});
test('open continuing arms: no center closure for ribbon; old flower stays distinct',()=>{
 const R=2;
 const rails=[0,1].map(i=>({spiralBranchIndex:i,alpha:1,points:Array.from({length:101},(_,j)=>{const t=j/100,a=t*Math.PI/2+i*Math.PI,r=10*Math.pow(R,t);return{x:r*Math.cos(a),y:r*Math.sin(a)};})}));
 // Four consecutive periods of a continuous two-arm logarithmic spiral.
 const copies=Array.from({length:5},(_,i)=>({scale:Math.pow(R,i),copyId:i,position:i,_spiralUntwistedAngle:i*Math.PI/2}));
 const old=state.tunnel.active;state.tunnel.active=true;
 try{
  layer.spiralFillType='chopped';const f=frame({visibleInstances:{copies,alphas:[1,1,1,1,1]}});
  const a=FillMeshPreparer.prepareSpiralMaskFill(f,rails,true,false);assert.ok(a?.nativeComplete);
  // Opposite radial regions between true spiral lines alternate; a few
  // representative interior probes are enough to detect an all-empty mask.
  const probes=Array.from({length:40},(_,i)=>[40*Math.cos(i*.157),40*Math.sin(i*.157)]);
  const mask=probes.map(([x,y])=>winding(a,x,y)!==0);
  assert.ok(mask.some(Boolean)&&mask.some(v=>!v));
  layer.spiralFillType='bandXor';const b=FillMeshPreparer.prepareSpiralMaskFill(frame({visibleInstances:{copies,alphas:[1,1,1,1,1]}}),rails,true,false);
  assert.deepEqual(probes.map(([x,y])=>Math.abs(winding(b,x,y))%2===1),mask);
  layer.spiralFillType='mathematical';const flower=FillMeshPreparer.prepareSpiralMaskFill(frame({visibleInstances:{copies,alphas:[1,1,1,1,1]}}),rails,true,true);
  assert.ok(flower?.nativeComplete);assert.notDeepEqual(probes.map(([x,y])=>Math.abs(winding(flower,x,y))%2===1),mask);
 }finally{state.tunnel.active=old;}
});
test('a degenerate pair of collinear open arms never paints an artificial half disk',()=>{
 const rails=[{spiralBranchIndex:0,points:[{x:10,y:0},{x:20,y:0}]},{spiralBranchIndex:1,points:[{x:-10,y:0},{x:-20,y:0}]}];
 const copies=[{scale:1},{scale:2},{scale:4}];layer.spiralFillType='chopped';const f=frame({visibleInstances:{copies,alphas:[1,1,1]}});
 assert.equal(FillMeshPreparer.prepareSpiralMaskFill(f,rails,true,false),null);assert.equal(f._spiralRibbonFillEmpty.reason,'no-ribbon-area');
});
