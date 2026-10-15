const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:45000,loadDelayMs:400});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      const out=[];
      const l=createLayer('v783-fill-web-line-hidden');
      Object.assign(l,{visible:true,lineVisible:false,N:7,K:2,radius:170,rounding:20,closedLoop:true,fill:true,fillColor:'#22cc88aa',strokeWidth:3,strokeColor:'#fff'});
      ensureLayerEffectState(l);l.showWeb=true;l.web.style='web';l.web.distance=60;l.web.width=2;l.web.color='#fff';
      state.showLines=true;state.showWeb=true;state.tunnel.active=false;state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;refreshLayerLookup(true);
      SomataEffectStackOrder.set([...SomataEffectStackOrder.DEFAULT_ORDER]);
      const old={ensure:SomataLayerSceneService.ensure,fillEncode:FillGPURenderer.encodeMeshIsolatedCommandToTexture,webStatus:WebGPUWebThreadSceneRenderer.status,webReady:WebGPUWebThreadSceneRenderer.isReady,webEncode:WebGPUWebThreadSceneRenderer.encodeToLayerScene,morphEncode:WebGPUWebMorphRenderer.encodeToLayerScene,morphCorridor:WebGPUWebMorphRenderer.encodeCorridorToLayerScene};
      try{
        SomataLayerSceneService.ensure=(ctx)=>{ctx.frame.gpuLayerSceneDeferred=true;return{texture:{createView(){return{};}}};};
        FillGPURenderer.encodeMeshIsolatedCommandToTexture=(texture,ctx,mesh)=>({handled:true,commandBuffer:{kind:'fill',frameId:ctx.frameId},triangles:Number(mesh?.fanTriangleCount)||0});
        WebGPUWebThreadSceneRenderer.status=()=>({available:true,initializing:false,lastError:''});WebGPUWebThreadSceneRenderer.isReady=()=>true;
        WebGPUWebThreadSceneRenderer.encodeToLayerScene=(texture,commands,clip,halo,alpha,ctx)=>({handled:true,commandBuffer:{kind:'web',frameId:ctx?.frameId},count:commands?.length||0});
        WebGPUWebMorphRenderer.encodeToLayerScene=(texture,commands,clip,halo,alpha,ctx)=>({handled:true,commandBuffer:{kind:'web-morph',frameId:ctx?.frameId}});
        WebGPUWebMorphRenderer.encodeCorridorToLayerScene=(texture,commands,clip,halo,alpha,copies,alphas,ctx)=>({handled:true,commandBuffer:{kind:'web-morph-corridor',frameId:ctx?.frameId}});
        async function runSeries(tag,dynamic){
          const btn=document.getElementById('btnMorph');if(runtimeState.morph.active)btn?.click();if(dynamic){btn?.click();await new Promise(r=>setTimeout(r,140));}
          for(const mode of ['corners','selfIntersection','selfIntersectionCorridor']){
            l.web.placementMode=mode;invalidateLayerEffect?.(l,'line-hidden-accum-'+mode);
            for(let n=0;n<6;n++){
              const f=renderRuntime.begin(performance.now()+n*16);prepareMainRenderFrame(f);
              const before=(f.gpuLayerSceneEffectCommands||[]).length;
              const c=prepareMainLayerFrame(f,0);const plan=SomataEffectStackOrder.plan(c);
              const fillResult=SomataFeatureHost.run('fill',c,child=>prepareRetainedFillSceneBeforeGlow(child));
              SomataFeatureHost.run('web',c,child=>renderLayerWebPass(child));
              const q=peekLayerSceneEffectCommands(f).map(x=>({frameId:x.frameId,label:x.label,phase:x.phase,kind:x.commandBuffer?.kind||''}));
              out.push({tag,mode,n,frameId:f.id,before,line:c.lineDisplayEnabled===true,plan,dynamic:c.geometryPlan?.dynamic===true,morph:c.morphFrameActive===true,q,fill:c._baseFillCommitted===true,fillResult,fillResolved:c._fillBelowWebResolved===true,fillSuppress:c._suppressLateFillForWeb===true,fc:__somataFrameContourStatus?.(),web:c._webPassHandled===true});
              // Deliberately DO NOT present or clear this queue.  The next frame must not inherit it.
              renderRuntime.end();
            }
          }
          if(runtimeState.morph.active)btn?.click();
        }
        await runSeries('static',false);await runSeries('morph',true);
      } finally {
        SomataLayerSceneService.ensure=old.ensure;FillGPURenderer.encodeMeshIsolatedCommandToTexture=old.fillEncode;WebGPUWebThreadSceneRenderer.status=old.webStatus;WebGPUWebThreadSceneRenderer.isReady=old.webReady;WebGPUWebThreadSceneRenderer.encodeToLayerScene=old.webEncode;WebGPUWebMorphRenderer.encodeToLayerScene=old.morphEncode;WebGPUWebMorphRenderer.encodeCorridorToLayerScene=old.morphCorridor;if(runtimeState.morph.active)document.getElementById('btnMorph')?.click();
      }
      return out;
    })()`);
    assert(r.length===36,'expected 36 repeated-frame probes, got '+r.length);
    for(const x of r){
      assert(x.before===0,`${x.tag}/${x.mode}/frame${x.n}: inherited ${x.before} stale queued commands before current passes`);
      assert(x.line===false,`${x.tag}/${x.mode}: Line unexpectedly enabled`);
      assert(x.plan.fillRequested&&x.plan.webActive&&x.plan.standaloneFill,`${x.tag}/${x.mode}: Fill/Web plan not standalone with hidden Line`);
      assert(x.fill&&x.web,`${x.tag}/${x.mode}/frame${x.n}: Fill or Web did not commit`);
      assert(x.q.length===2,`${x.tag}/${x.mode}/frame${x.n}: queue grew to ${x.q.length}; expected exactly current Fill+Web`);
      assert(x.q.every(i=>i.frameId===x.frameId),`${x.tag}/${x.mode}/frame${x.n}: stale frame generation reached queue`);
      assert(x.q.some(i=>String(i.label).startsWith('fill'))&&x.q.some(i=>String(i.label).startsWith('web')),`${x.tag}/${x.mode}/frame${x.n}: current Fill/Web pair missing`);
      if(x.tag==='morph')assert(x.morph,`${x.mode}: Morph series did not use active Morph frame`);
    }
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('PASS 7.8.3 hidden Line + Fill + Web stays exactly one Fill/Web command pair per frame: 3 modes × Static/Morph × 6 frames',r.length);
  } finally {await h.close();}
}
main().catch(e=>{console.error('FAIL 7.8.3 hidden-Line Fill/Web accumulation regression:',e.stack||e.message);process.exit(1)});
