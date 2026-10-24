'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
function namedFunction(source,name){
  const match=source.indexOf(`function ${name}(`);assert.ok(match>=0,name);
  const first=source.indexOf('{',match);let depth=0;
  for(let i=first;i<source.length;i++){
    if(source[i]==='{')depth++;
    else if(source[i]==='}'&&!--depth)return source.slice(match,i+1);
  }
  throw Error(`Unterminated ${name}`);
}
// Run the real helper in isolation with a renderer edit resource. It must NEVER
// ask the unrelated Blue pair to populate static-edit Fill.
const gpu=read('js/gpu/spiral-bezier-morph-renderer.js');
const aux=namedFunction(gpu,'auxiliaryPaths');
let blueQueries=0,editQueries=0;
const editResource={ready:true,pathCount:1,auxT:.42,auxPairs:[{points:[{x:7,y:4},{x:12,y:8}]}]};
const blueResource={ready:true,pathCount:1,auxT:.8,auxPairs:[{points:[{x:-7,y:-4},{x:-12,y:-8}]}]};
const sandbox={getStaticEditResource:ctx=>{editQueries++;assert.ok(ctx.spiralEditMorph);return editResource;},
  getResource:()=>{blueQueries++;return blueResource;},resolveEffectT:(_rec,t)=>t,stats:{auxHits:0},
  Number,Math};
vm.createContext(sandbox);vm.runInContext(aux,sandbox);
const ctx={layerIndex:0,spiralEditMorph:{progress:.42}};
assert.strictEqual(sandbox.auxiliaryPaths(0,.42,ctx),editResource.auxPairs);
assert.equal(editQueries,1);assert.equal(blueQueries,0);
assert.strictEqual(sandbox.auxiliaryPaths(0,.8),blueResource.auxPairs);
assert.equal(blueQueries,1);
assert.match(gpu,/getGpuSpiralBezierMorphAuxPaths=\(layerIndex,t,frameCtx=null\)=>WebGPUSpiralBezierMorphRenderer\.auxiliaryPaths\(layerIndex,t,frameCtx\)/);

const fill=read('js/render/spiral-fill-adapter.js');
let sampled=null,meshed=null;
const sandboxFill={
  window:{__spiroRegisterModule:()=>{}},
  getGpuSpiralBezierMorphAuxPaths:(idx,t,frameCtx)=>{sampled={idx,t,frameCtx};return[{points:[{x:0,y:0},{x:1,y:1}]},{points:[{x:1,y:0},{x:2,y:1}]}];},
  FillMeshPreparer:{prepareSpiralMorphBands:(ctx,paths)=>{meshed={ctx,paths};return{nativeComplete:true,fanTriangleCount:5};}},
  isSpiralLayer:()=>true,
  SomataFillGeometryAdapter:{register:()=>{}},
  runtimeState:{morph:{geometryT:.9}},
  Math,Number
};
vm.createContext(sandboxFill);vm.runInContext(fill,sandboxFill);
const frame={layerIndex:2,layer:{spiralClosed:true,spiralEnabled:true},geometryPlan:{dynamic:true},
 spiralEditMorph:{progress:.42,sourceLayer:{N:8},targetLayer:{N:8}},blueMorphProvider:{geometryT:.9}};
assert.equal(sandboxFill.somataSpiralFillMorphT(frame),.42);
assert.ok(sandboxFill.somataSpiralMorphFillMesh(frame)?.nativeComplete);
assert.equal(sampled.t,.42);assert.strictEqual(sampled.frameCtx,frame);
assert.strictEqual(meshed.ctx,frame);
assert.equal(sandboxFill.somataSpiralFillMorphT({blueMorphProvider:{geometryT:.9}}),.9);
const fillPlan=read('js/render/fill-plan.js');
assert.match(fillPlan,/frameCtx\?\.spiralEditMorph\?\.sourceLayer\|\|frameCtx\?\.blueMorphProvider/);
assert.match(fillPlan,/frameCtx\?\.spiralEditMorph\?\.targetLayer\|\|frameCtx\?\.blueMorphProvider/);
console.log('PASS v913 Spiral edit Fill samples the visible retained GPU pair, not stale Blue Morph');
