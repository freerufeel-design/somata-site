const fs=require('fs'),vm=require('vm'),path=require('path');
const assert=require('assert');
const source=fs.readFileSync(path.join(__dirname,'../js/app/geometry-gpu-core.js'),'utf8');
const slice=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a+from.length);assert(a>=0&&b>a,'Could not extract '+from);return source.slice(a,b);};
function checkMorphTopology(){
  const code=slice('            function indexedMorphTopologyIdentity(commands){','            function ensureIndexedMorphSlot(index,topology){');
  let destroyed=0;
  const ctx={WeakMap,Set,Uint32Array,Math,Number,Array,indexedMorphTopologyCache:new WeakMap(),indexedMorphTopologyRecords:new Set(),indexedMorphRetiredTopologies:[],indexedMorphBindGroupLayout:{},indexedMorphPipelineMax:{},indexedMorphPipelineOver:{},indexedMorphTopologyHits:0,indexedMorphTopologyChanges:0,indexedMorphTopologyBuilds:0,indexedMorphTopologyUploadBytes:0,hubGeneration:1,GPUBufferUsage:{STORAGE:128,COPY_DST:8},device:{createBuffer:()=>({destroy(){destroyed++;}}),queue:{writeBuffer(){}}},frameResidentDynamicFrameId:(cmd)=>cmd.frameId,canUseIndexedMorphCapsules:()=>true};
  vm.createContext(ctx);vm.runInContext(code+';globalThis.buildTopology=buildIndexedMorphTopology;',ctx);
  const make=(i)=>{const c=[{subpaths:[{points:[{x:i,y:0},{x:i+1,y:1}],closed:false}]}];c.__spiroPhaseResidentRecorder=true;c.__spiroFrameResidentDynamic=true;c.frameId=i;c.__spiroPhaseSerial=i;return c;};
  let latest;
  for(let i=1;i<=450;i++){latest=make(i);let rec=ctx.buildTopology(latest);assert(rec&&rec.buffer,'Could not create topology');}
  const before=ctx.indexedMorphTopologyRecords.size;
  latest.frameId=451;
  const same=ctx.buildTopology(latest);
  assert.strictEqual(same,ctx.indexedMorphTopologyCache.get(latest),'Current topology should survive');
  assert(before<=32,'Orange generations retained unbounded indexed Morph buffers: '+before);
  assert(destroyed>300,'Old GPU buffers not released: '+destroyed);
  return {active:before,retired:ctx.indexedMorphRetiredTopologies.length,gpuBufferDestroys:destroyed};
}
function checkFillHistory(){
  const code=slice('            function disposeAccumulatingFillHistory(key,rec){','            function appendAccumulatingFillComposite(encoder,targetTexture,frameCtx,clearTarget=false){');
  let destroyed=0,timerCancels=0;
  const ctx={Map,Math,Number,String,Array,fillHistoryRecords:new Map(),hubGeneration:1,width:1920,height:1080,renderRuntime:{frameId:0},format:'rgba8unorm',GPUTextureUsage:{RENDER_ATTACHMENT:1,TEXTURE_BINDING:2},device:{createTexture:()=>({destroy(){destroyed++;},createView(){return {};}}),createBindGroup:()=>({})},isolatedCompositePipeline:{getBindGroupLayout:()=>({})},isolatedCompositeSampler:{},clearTimeout:()=>{timerCancels++;}};
  vm.createContext(ctx);vm.runInContext(code+';globalThis.history=accumulationHistoryRecord;',ctx);
  for(let i=1;i<=100;i++)ctx.history({frameId:i*12,layer:{id:'orange_'+i}});
  assert(ctx.fillHistoryRecords.size<=8,'Fill retained full-screen textures of historical Orange layers: '+ctx.fillHistoryRecords.size);
  assert(destroyed>=90,'Old Fill textures not destroyed: '+destroyed);
  const recent=ctx.history({frameId:1201,layer:{id:'orange_100'}});
  assert(recent.texture,'Latest Fill was incorrectly evicted');
  return {active:ctx.fillHistoryRecords.size,destroyed};
}
function checkSceneUniforms(){
  const code=slice('            function clearLayerSceneUniformRecords(){','            function writeLayerSceneUniformRecord(key){');
  let destroyed=0;
  const ctx={Map,Math,Number,Array,layerSceneUniformRecords:new Map(),layerSceneUniformSerial:0,layerSceneUniformRecordBuilds:0,layerSceneUniformRecordHits:0,layerSceneBindGroupCache:new Map(),renderRuntime:{frameId:1},hubGeneration:1,GPUBufferUsage:{UNIFORM:1,COPY_DST:2},device:{createBuffer:()=>({destroy(){destroyed++;}})}};
  vm.createContext(ctx);vm.runInContext(code+';globalThis.uniform=getLayerSceneUniformRecord;',ctx);
  for(let i=1;i<=150;i++){ctx.renderRuntime.frameId=i*12;const rec=ctx.uniform('orange-'+i);ctx.layerSceneBindGroupCache.set(`u${rec.id}|s1`,{bundle:{}});}
  assert(ctx.layerSceneUniformRecords.size<=32,'Layer Scene retained uniforms for every Orange generation');
  assert(ctx.layerSceneBindGroupCache.size<=33,'Layer Scene retained stale bind groups');
  assert(destroyed>=110,'Old Layer Scene GPU uniform buffers not destroyed');
  return{uniforms:ctx.layerSceneUniformRecords.size,bindGroups:ctx.layerSceneBindGroupCache.size,destroyed};
}
try{console.log('7.11.7 GPU MEMORY RETENTION: PASS',JSON.stringify({topology:checkMorphTopology(),fillHistory:checkFillHistory(),sceneUniforms:checkSceneUniforms()}));}
catch(err){console.error('7.11.7 GPU MEMORY RETENTION: FAIL',err.stack||err);process.exitCode=1;}
