const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:30000,loadDelayMs:400});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const rows=await h.evaluate(`(async()=>{
      const out=[];
      for(const dynamic of [false,true])for(const type of ['accumulation','fade','fadeSmooth'])for(const web of [false,true]){
        const l=createLayer('fill-type-'+type+'-'+dynamic+'-'+web);Object.assign(l,{visible:true,lineVisible:true,N:8,K:3,radius:180,rounding:22,fill:true,fillType:type,fillRule:'evenodd',fillColor:'#4488cc55',fillAccumulationSeconds:3.5,fillFadeDirection:'fromCenter',fillFadeHardness:55,strokeWidth:3,strokeColor:'#33ddff'});ensureLayerEffectState(l);l.showWeb=web;l.web.placementMode='corners';state.showWeb=web;state.tunnel.active=false;state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;refreshLayerLookup(true);SomataEffectStackOrder.set([...SomataEffectStackOrder.DEFAULT_ORDER]);
        const btn=document.getElementById('btnMorph');if(runtimeState.morph.active){btn?.click();await new Promise(r=>setTimeout(r,90));}if(dynamic){btn?.click();await new Promise(r=>setTimeout(r,120));}
        beginFrameGeometryRuntime();const f=renderRuntime.frame||{};f.now=performance.now();f.id=(Number(f.id)||0)+1;f.dpr=1;const c=prepareMainLayerFrame(f,0),plan=SomataEffectStackOrder.plan(c),queued=[];
        const old={ensure:SomataLayerSceneService.ensure,queue:SomataLayerSceneService.queue,fillEncode:FillGPURenderer.encodeMeshIsolatedCommandToTexture,webStatus:WebGPUWebThreadSceneRenderer.status,webReady:WebGPUWebThreadSceneRenderer.isReady,webEncode:WebGPUWebThreadSceneRenderer.encodeToLayerScene,morphEncode:WebGPUWebMorphRenderer.encodeToLayerScene,morphCorridor:WebGPUWebMorphRenderer.encodeCorridorToLayerScene};
        try{
          SomataLayerSceneService.ensure=(ctx)=>{ctx.frame.gpuLayerSceneDeferred=true;return{texture:{createView(){return{}}}}};SomataLayerSceneService.queue=(ctx,phase,cmd,label)=>{queued.push({phase,label,kind:cmd?.kind||''});return true};
          FillGPURenderer.encodeMeshIsolatedCommandToTexture=(texture,ctx,mesh)=>({handled:true,commandBuffer:{kind:'fill-'+getLayerFillType(ctx.layer)},triangles:Number(mesh?.fanTriangleCount)||0});
          WebGPUWebThreadSceneRenderer.status=()=>({available:true,initializing:false,lastError:''});WebGPUWebThreadSceneRenderer.isReady=()=>true;WebGPUWebThreadSceneRenderer.encodeToLayerScene=(texture,commands)=>({handled:true,commandBuffer:{kind:'web'},count:commands?.length||0});WebGPUWebMorphRenderer.encodeToLayerScene=()=>({handled:true,commandBuffer:{kind:'web-morph'}});WebGPUWebMorphRenderer.encodeCorridorToLayerScene=()=>({handled:true,commandBuffer:{kind:'web-morph-corridor'}});
          const fill=SomataFeatureHost.run('fill',c,child=>prepareRetainedFillSceneBeforeGlow(child));if(web)SomataFeatureHost.run('web',c,child=>renderLayerWebPass(child));
          out.push({type,dynamic,web,morph:c.morphFrameActive===true,geometryDynamic:c.geometryPlan?.dynamic===true,plan,fillHandled:fill?.handled===true,fillCommitted:c._baseFillCommitted===true,webHandled:web?c._webPassHandled===true:null,queued:queued.slice()});
        }finally{SomataLayerSceneService.ensure=old.ensure;SomataLayerSceneService.queue=old.queue;FillGPURenderer.encodeMeshIsolatedCommandToTexture=old.fillEncode;WebGPUWebThreadSceneRenderer.status=old.webStatus;WebGPUWebThreadSceneRenderer.isReady=old.webReady;WebGPUWebThreadSceneRenderer.encodeToLayerScene=old.webEncode;WebGPUWebMorphRenderer.encodeToLayerScene=old.morphEncode;WebGPUWebMorphRenderer.encodeCorridorToLayerScene=old.morphCorridor;if(runtimeState.morph.active)btn?.click();}
      }
      return out;
    })()`);
    for(const r of rows){
      assert(r.plan.fillType===r.type&&!r.plan.fillCanFuse&&r.plan.standaloneFill,`${r.type}/${r.dynamic}/${r.web}: special Fill was fused`);
      assert(r.fillHandled&&r.fillCommitted,`${r.type}/${r.dynamic}/${r.web}: special Fill did not commit`);
      const fq=r.queued.find(q=>String(q.label).startsWith('fill'));assert(fq,`${r.type}/${r.dynamic}/${r.web}: Fill command not queued`);
      if(r.web){assert(r.webHandled,`${r.type}/${r.dynamic}: Web did not coexist with special Fill`);assert(r.queued.some(q=>String(q.label).startsWith('web')),`${r.type}/${r.dynamic}: Web command missing`);}
      if(r.dynamic)assert(r.geometryDynamic,`${r.type}: dynamic case did not use dynamic geometry`);else assert(!r.geometryDynamic,`${r.type}: static case unexpectedly used dynamic geometry`);
    }
    assert(rows.length===12,'Expected 12 special Fill combinations');
    const uncaught=uncaughtExceptions(h.events).slice(baseline);assert(!uncaught.length,'uncaught browser errors: '+JSON.stringify(uncaught));
    console.log('PASS 7.8.3 accumulation/sharp-fade/smooth-fade Fill: Static/Morph × Web OFF/ON, all standalone and committed',rows);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.8.3 Fill type Static/Morph regression:',e.stack||e.message);process.exit(1)});
