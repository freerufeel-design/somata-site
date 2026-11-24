import test from 'node:test';
import assert from 'node:assert/strict';
import {importModule} from './helpers/app-env.mjs';
const {state} = await importModule('js/core/state.js');
const {createLayer} = await importModule('js/core/defaults-layers.js');
const {getCachedLayerDrawData} = await importModule('js/effects/motion.js');
const {SomataFillGeometryAdapter} = await importModule('js/render/fill-geometry-adapter.js');
const {FillMeshPreparer} = await importModule('js/render/fill-plan.js');
const {getLayerGeometryContract} = await importModule('js/geometry/kernel.js');
const {strokeVariableWidthSpiralPath} = await importModule('js/render/spiral-stroke.js');
const {getRoundingStrength} = await importModule('js/core/palette.js');
state.tunnel.active=false;
state.showRoundingGuides=false;
const make = (method='simple',mode='chopped') => ({...createLayer(),id:'fill',N:6,K:2,radius:200,spiralEnabled:true,spiralOrder:2,spiralClosed:true,spiralFillEnabled:true,spiralFillType:mode,roundingCornerType:method,roundingMode:'monoradius',rounding:57,fillColor:'#ff0000',profileMode:'spline',splineRenderMode:'smooth',profileNodes:[{x:0,y:0},{x:.35,y:.15},{x:1,y:0}]});
let fid=0;
function frame(layer, data, dynamic=false) {return {frameId:++fid,layerIndex:0,layer,staticDrawData:data,geometryPlan:{kind:dynamic?'blue-prepared':'static',dynamic,sourceData:dynamic?null:data,sourceLayer:layer,targetLayer:layer,sourceProfileMode:layer.profileMode,targetProfileMode:layer.profileMode,framePaths:dynamic?data.paths:null},__somataZeroOrderPrepared:dynamic,drawLayerInstances(){}};}
test('all static and coordinated fill modes read current independent branches, not parked GPU pair',()=>{
 const old=globalThis.getGpuSpiralBezierMorphAuxPaths; let calls=0; globalThis.getGpuSpiralBezierMorphAuxPaths=()=>{calls++;return [{points:[{x:9000,y:9000},{x:9100,y:9100}]}]};
 try {
 for(const method of ['simple','local','classic','fourier']) for(const mode of ['chopped','bandXor','mathematical']){
  const layer=make(method,mode); const data=getCachedLayerDrawData(layer);
  assert.ok(data.paths.length>=2);
  for(const dynamic of [false,true]){
   const f=frame(layer,data,dynamic);
   const mesh=SomataFillGeometryAdapter.query('directMesh',f);
   const status=globalThis.__somataSpiralFillRailStatus().last;
   assert.equal(status.source,dynamic?'current-prepared-line':'current-static-line',`${method}/${mode}`);
   assert.equal(status.pathCount,data.paths.length);
   const rails=f._spiralFillCurrentRails.paths;
   assert.ok(rails.every(p=>p.points.every(q=>Math.abs(q.x)<5000&&Math.abs(q.y)<5000)));
   if(mode==='chopped'){assert.ok(mesh?.nativeComplete,`${method}/${mode}/${dynamic}`);assert.equal(mesh.spiralChoppedFill,true)}
   if(mode==='mathematical'||mode==='bandXor'){assert.ok(mesh?.nativeComplete,`${method}/${mode}/${dynamic}`);assert.equal(mesh.spiralMathematicalFill,true);}
  }
 }
 assert.equal(calls,0);
 }finally{globalThis.getGpuSpiralBezierMorphAuxPaths=old}
});


test('valid separated interwinding rails produce a native cell mesh',()=>{
 const layer=make('simple','interwinding');
 const rails=[0,3,6].map((y,i)=>({spiralBranchIndex:i,branchPhase:i/3,points:Array.from({length:11},(_,x)=>({x:x*5,y})),alpha:1}));
 const f=frame(layer,{paths:rails});
 const mesh=FillMeshPreparer.prepareSpiralInterwinding(f,rails);
 assert.ok(mesh?.nativeComplete);
 assert.equal(mesh.spiralInterwindingFill,true);
 assert.equal(mesh.localCellCount,20);
 assert.equal(globalThis.__somataSpiralInterwindingFillStatus().last.pairedBands,2);
});

test('actual odd spiral orders use a valid mesh in both modes',()=>{
 for(const N of [3,5,7]) for(const mode of ['chopped','bandXor','mathematical']){
  const layer={...make('simple',mode),N,K:1,spiralOrder:2};const data=getCachedLayerDrawData(layer);const f=frame(layer,data);
  const mesh=SomataFillGeometryAdapter.query('directMesh',f);assert.ok(mesh?.nativeComplete,`${N}/${mode}`);
  const revision=mesh.revision;assert.equal(SomataFillGeometryAdapter.query('directMesh',f),mesh);assert.equal(mesh.revision,revision);
 }
});
