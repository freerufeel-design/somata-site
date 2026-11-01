'use strict';
const fs=require('fs'),assert=require('node:assert/strict'),vm=require('node:vm'),path=require('node:path');
const text=fs.readFileSync(path.join(__dirname,'../js/render/main-pipeline.js'),'utf8');
const start=text.indexOf('function prepareMainLayerVectorMaster(frameCtx) {');
const end=text.indexOf('\nfunction prepareMainLayerFrame(',start);
assert(start>=0&&end>start,'could not extract main preparation');
function run({gpuReady,sceneReady,morph=false,glow=20}){
 let records=0,draws=0,routeCalls=0;
 const ctx={
  state:{tunnel:{active:false},lineOutline:{enabled:false},showRoundingGuides:false},
  SomataGeometryRoleService:{backendEligible:(_frame,engine)=>engine==='spiral'&&gpuReady,spiralRoute:frame=>{routeCalls++;assert.equal(frame.prepared,true);return{deferLayerScene:sceneReady,deferFrameScene:false};}},
  shouldPrepareDynamicVectorMaster:()=>true,
  createVectorRecordingContext:()=>{records++;return{commands:[],scale:()=>{}};}
 };
 vm.createContext(ctx);vm.runInContext(text.slice(start,end),ctx);
 const frame={morphFrameActive:morph,prepared:false,geometryMorphEnabled:true,layer:{strokeColor:'#ffffff'},visibleInstances:{copies:[{scale:1}],alphas:[1],maxScale:1},glow,strokeWidth:2,drawLayerGeometry:rec=>{draws++;rec.commands.push({type:'move'});}};
 ctx.prepareMainLayerVectorMaster(frame);
 assert.equal(frame.prepared,false,'temporarily prepared flag was not restored');
 return{records,draws,routeCalls,hasMaster:!!frame.frameVectorMaster};
}
assert.deepEqual(run({gpuReady:true,sceneReady:true}),{records:0,draws:0,routeCalls:1,hasMaster:false});
assert.deepEqual(run({gpuReady:true,sceneReady:false}),{records:1,draws:1,routeCalls:1,hasMaster:true});
assert.deepEqual(run({gpuReady:false,sceneReady:false}),{records:1,draws:1,routeCalls:0,hasMaster:true});
assert.deepEqual(run({gpuReady:true,sceneReady:false,morph:true}),{records:0,draws:0,routeCalls:0,hasMaster:false});
console.log('PASS Somata 13.0.7 GPU static Spiral vector bypass / safe fallback');
