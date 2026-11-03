'use strict';
const {createBrowserHarness}=require('./lib/browser-harness');
const fs=require('fs');
const playlist=JSON.parse(fs.readFileSync('/mnt/data/default.plist','utf8'));
const project=playlist.projects.find(p=>p.name.includes('Semiramida')).project;
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:60000});
 try{
  const res=await h.evaluate(`(async()=>{
   const p=${JSON.stringify(project)};
   state.layers.splice(0,state.layers.length,...p.layers);
   state.activeLayerId=p.settings.activeLayerId;
   state.tunnel.active=false;state.showLines=true;
   state.layers.forEach(ensureLayerEffectState);
   const get=()=>{
    const f=renderRuntime.frame;f.now=performance.now();f.renderLayerCount=state.layers.length;
    return state.layers.map((l,i)=>{
     const ctx=prepareMainLayerFrame(f,i),s=ctx?.effectsPlan?.sweep;
     const out={id:l.id,line:ctx?.lineDisplayEnabled,prepared:ctx?.prepared,geometry:ctx?.geometryPlan?.kind,strict:SomataGeometryPolicy.isStrict(ctx),sweep:s?.enabled,instances:s?.instances?.map(q=>({enabled:q.enabled,paths:q.paths?.length,framePaths:q.frameData?.paths?.length,prepared:!!q.frameData?.prepared,bezier:q.frameData?.bezierGlintGPU,canonical:q.frameData?.canonicalGPU,rawPathCount:q.frameData?.paths?.length})),renderGraph:ctx?.renderGraph?.passes?.map(x=>x.name)};
     return out;
    });
   };
   const before=get();state.layers.forEach(l=>l.lineVisible=false);state.showLines=false;const after=get();return {before,after};
  })()`,{timeoutMs:50000});
  console.log(JSON.stringify(res,null,2));
 }finally{await h.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
