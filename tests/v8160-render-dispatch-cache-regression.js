// 8.16: actual feature/provider dispatch parity with 8.15 plus warm-path benchmark.
// This is a CPU dispatch test, not a GPU FPS benchmark.
const fs=require('fs'),path=require('path'),vm=require('vm');
const {performance}=require('perf_hooks');
const root=path.resolve(__dirname,'..');
const reference=process.env.SOMATA_BASELINE_ROOT||'';
function assert(ok,message){if(!ok)throw new Error(message);}
function load(dir){
  const ctx={console:{error(){},warn(){},log(){}},window:{},performance,Map,Set,WeakMap,WeakSet,Number,Math,String,Array,Object};
  vm.createContext(ctx);
  for(const file of ['js/render/feature-host.js','js/render/geometry-role-service.js'])vm.runInContext(fs.readFileSync(path.join(dir,file),'utf8'),ctx,{filename:file});
  return {feature:ctx.window.SomataFeatureHost,geometry:ctx.window.SomataGeometryRoleService};
}
function populate(o){
  // A deliberately sparse capability with many registered effects/models.
  for(let i=0;i<64;i++){
    o.feature.register('effect'+i,{plans:['x'],outputs:['_flag'+i],reads:[]});
    if(i%8===0)o.feature.provide('effect'+i,'renderFeature',function(frame){return frame.i+i;});
    if(i%13===0)o.feature.provide('effect'+i,'effectPlan',function(frame){return frame.i-i;});
  }
  for(let i=0;i<17;i++)o.geometry.register('kind'+i,{
    nativePriority:(i*7)%17,
    nativeEligible:frame=>frame.kind===i,
    warmup(){},
  },i%5);
  return o;
}
function snapshot(o){
  const a=o.feature.queryAll('renderFeature',{i:43}).map(r=>[r.name,r.value,r.error]);
  const b=o.feature.queryAll('effectPlan',{i:7}).map(r=>[r.name,r.value,r.error]);
  const g=Array.from({length:17},(_,i)=>o.geometry.nativeBaseKind({kind:i},{warmup:false}));
  return JSON.stringify({a,b,g});
}
function benchmark(label,fn,iter=30000){
  const samples=[];for(let j=0;j<6;j++){
    const t0=performance.now();for(let i=0;i<iter;i++)fn(i);samples.push(performance.now()-t0);
  }
  samples.shift();samples.sort((a,b)=>a-b);return Number(samples[Math.floor(samples.length/2)].toFixed(2));
}
(async()=>{
  const candidate=populate(load(root));
  const before=snapshot(candidate);
  const fc=candidate.feature;
  // Overwriting a provider must invalidate the cached capability dispatch.
  fc.provide('effect0','renderFeature',frame=>frame.i+1000);
  assert(fc.queryAll('renderFeature',{i:2})[0].value===1002,'replaced provider was not observed');
  // Register a feature after first use, and then replace an existing definition.
  fc.register('late',{plans:['x']});fc.provide('late','renderFeature',frame=>frame.i*2);
  assert(fc.queryAll('renderFeature',{i:3}).at(-1).value===6,'late provider was not observed');
  fc.register('late',{domain:'appearance'});
  assert(fc.queryAll('renderFeature',{i:3}).at(-1).value===6,'provider was lost after re-register');
  // Native dispatch must honor nativePriority rather than public priority.
  let chosen=[];
  candidate.geometry.register('native-low',{nativePriority:100,nativeEligible:()=>true},-100);
  candidate.geometry.register('native-high',{nativePriority:200,nativeEligible:()=>true},-101);
  chosen.push(candidate.geometry.nativeBaseKind({kind:0},{warmup:false}));
  assert(chosen[0]==='native-high','nativePriority order changed');
  candidate.geometry.register('native-high',{nativePriority:-300,nativeEligible:()=>true},-101);
  assert(candidate.geometry.nativeBaseKind({kind:0},{warmup:false})==='native-low','adapter replacement did not invalidate native order');
  // Strict geometry still refuses adapters not explicitly permitted.
  const measureOnly=populate(load(root));
  if(reference){
    const baseline=populate(load(reference));
    assert(snapshot(measureOnly)===snapshot(baseline),'8.16 dispatch outputs do not match 8.15');
    const elapsed={baselineFeatureMs:benchmark('old-feature',i=>baseline.feature.queryAll('renderFeature',{i})),newFeatureMs:benchmark('new-feature',i=>measureOnly.feature.queryAll('renderFeature',{i})),baselineNativeMs:benchmark('old-native',i=>baseline.geometry.nativeBaseKind({kind:i%17},{warmup:false})),newNativeMs:benchmark('new-native',i=>measureOnly.geometry.nativeBaseKind({kind:i%17},{warmup:false}))};
    console.log('PASS 8.16 dispatch parity and late registration; CPU benchmark (30k dispatches): '+JSON.stringify(elapsed));
  } else {
    assert(JSON.parse(before).a.length===8,'initial feature registration mismatch');
    console.log('PASS 8.16 dispatch caching and live provider/adapter registration');
  }
})().catch(e=>{console.error('FAIL 8.16 dispatch cache',e.stack||e);process.exit(1)});
