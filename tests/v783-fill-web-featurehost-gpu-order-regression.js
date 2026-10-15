const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:30000,loadDelayMs:350});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      const results=[];
      for(const dynamic of [false,true])for(const stackCase of ['default','web-first'])for(const mode of ['corners','selfIntersection','selfIntersectionCorridor']){
        const l=createLayer('v783-fill-web-featurehost-gpu-'+dynamic);Object.assign(l,{visible:true,lineVisible:true,N:7,K:2,radius:175,rounding:25,fill:true,fillColor:'#224466aa',strokeWidth:3,strokeColor:'#33aaff'});ensureLayerEffectState(l);l.showWeb=true;l.web.placementMode=mode;l.web.distance=60;l.web.width=2;l.web.color='#fff';
        state.showWeb=true;state.tunnel.active=false;state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;refreshLayerLookup(true);const def=[...SomataEffectStackOrder.DEFAULT_ORDER];SomataEffectStackOrder.set(stackCase==='web-first'?['web','fill',...def.filter(x=>x!=='web'&&x!=='fill')]:def);
        const btn=document.getElementById('btnMorph');if(runtimeState.morph.active)btn?.click();if(dynamic){btn?.click();await new Promise(r=>setTimeout(r,120));}
        beginFrameGeometryRuntime();const f=renderRuntime.frame||{};f.now=performance.now();f.id=(Number(f.id)||0)+1;f.dpr=1;const c=prepareMainLayerFrame(f,0);
        const old={ensure:SomataLayerSceneService.ensure,queue:SomataLayerSceneService.queue,fillEncode:FillGPURenderer.encodeMeshIsolatedCommandToTexture,webStatus:WebGPUWebThreadSceneRenderer.status,webReady:WebGPUWebThreadSceneRenderer.isReady,webEncode:WebGPUWebThreadSceneRenderer.encodeToLayerScene,morphEncode:WebGPUWebMorphRenderer.encodeToLayerScene,morphCorridor:WebGPUWebMorphRenderer.encodeCorridorToLayerScene};
        const queued=[];
        try{
          SomataLayerSceneService.ensure=(ctx)=>{ctx.frame.gpuLayerSceneDeferred=true;return{texture:{createView(){return{};}}};};
          SomataLayerSceneService.queue=(ctx,phase,commandBuffer,label)=>{queued.push({phase,label,kind:commandBuffer?.kind||''});return true;};
          FillGPURenderer.encodeMeshIsolatedCommandToTexture=(texture,ctx,mesh)=>({handled:true,commandBuffer:{kind:'fill'},triangles:Number(mesh?.fanTriangleCount)||0});
          WebGPUWebThreadSceneRenderer.status=()=>({available:true,initializing:false,lastError:''});WebGPUWebThreadSceneRenderer.isReady=()=>true;
          WebGPUWebThreadSceneRenderer.encodeToLayerScene=(texture,commands)=>({handled:true,commandBuffer:{kind:'web'},count:commands?.length||0});
          WebGPUWebMorphRenderer.encodeToLayerScene=()=>({handled:true,commandBuffer:{kind:'web-morph'}});WebGPUWebMorphRenderer.encodeCorridorToLayerScene=()=>({handled:true,commandBuffer:{kind:'web-morph-corridor'}});
          const fillResult=SomataFeatureHost.run('fill',c,child=>prepareRetainedFillSceneBeforeGlow(child));
          const afterFill={base:c._baseFillCommitted===true,resolved:c._fillBelowWebResolved===true,rendered:c._fillRenderedBelowWeb===true,suppress:c._suppressLateFillForWeb===true};
          SomataFeatureHost.run('web',c,child=>renderLayerWebPass(child));
          const plan=SomataEffectStackOrder.plan(c),fillQ=queued.find(x=>String(x.label).startsWith('fill')),webQ=queued.find(x=>String(x.label).startsWith('web'));
          results.push({dynamic,stackCase,mode,morph:c.morphFrameActive===true,plan,fillHandled:fillResult?.handled===true,afterFill,webHandled:c._webPassHandled===true,fillQ,webQ,queued:queued.slice()});
        } finally {
          SomataLayerSceneService.ensure=old.ensure;SomataLayerSceneService.queue=old.queue;FillGPURenderer.encodeMeshIsolatedCommandToTexture=old.fillEncode;WebGPUWebThreadSceneRenderer.status=old.webStatus;WebGPUWebThreadSceneRenderer.isReady=old.webReady;WebGPUWebThreadSceneRenderer.encodeToLayerScene=old.webEncode;WebGPUWebMorphRenderer.encodeToLayerScene=old.morphEncode;WebGPUWebMorphRenderer.encodeCorridorToLayerScene=old.morphCorridor;if(runtimeState.morph.active)btn?.click();
        }
      }
      return results;
    })()`);
    for(const q of r){
      assert(q.plan.webActive&&q.plan.standaloneFill,`${q.dynamic?'Morph':'Static'}/${q.stackCase}/${q.mode}: frame-wide order plan lost Web/standalone Fill`);
      assert(q.fillHandled&&q.afterFill.base&&q.afterFill.rendered&&!q.afterFill.suppress,`${q.dynamic?'Morph':'Static'}/${q.stackCase}/${q.mode}: isolated Fill pass did not commit standalone Fill: ${JSON.stringify(q)}`);
      assert(q.webHandled,`${q.dynamic?'Morph':'Static'}/${q.stackCase}/${q.mode}: isolated Web pass did not commit`);
      assert(q.fillQ&&q.webQ,`${q.dynamic?'Morph':'Static'}/${q.stackCase}/${q.mode}: Fill/Web were not both queued`);
      const fillBeforeWeb=q.plan.order.indexOf('fill')<q.plan.order.indexOf('web');assert(fillBeforeWeb?(q.fillQ.phase<q.webQ.phase):(q.webQ.phase<q.fillQ.phase),`${q.dynamic?'Morph':'Static'}/${q.stackCase}/${q.mode}: queued order disagrees with user stack`);
      if(q.dynamic)assert(q.morph,'Morph probe did not use Morph frame');
    }
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('PASS 7.8.3 Fill + Web coexist: 3 Web modes × 2 user orders × Static/Morph through real FeatureHost',r);
  } finally {await h.close();}
}
main().catch(e=>{console.error('FAIL 7.8.3 Fill/Web FeatureHost GPU-order regression:',e.stack||e.message);process.exit(1)});
