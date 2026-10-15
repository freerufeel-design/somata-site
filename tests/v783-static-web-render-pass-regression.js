const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:20000,loadDelayMs:350});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(()=>{
      const l=createLayer('v783-static-web-pass');Object.assign(l,{visible:true,lineVisible:true,N:7,K:2,radius:180,rounding:35,fill:true,fillColor:'#224466aa',strokeWidth:3,strokeColor:'#33aaff'});ensureLayerEffectState(l);l.showWeb=true;l.web.placementMode='corners';l.web.distance=60;state.showWeb=true;state.tunnel.active=false;state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;refreshLayerLookup(true);
      beginFrameGeometryRuntime();const f=renderRuntime.frame||{};f.now=1000;f.id=(Number(f.id)||0)+1;f.dpr=1;const c=prepareMainLayerFrame(f,0);c._fillBelowWebResolved=true;c.frame.gpuLayerSceneDeferred=true;
      const d=c.effectsPlan?.web?.frameData||prepareLayerFrameWebData(c);const raw=getFrameWebGPUCommands(c,c.effectsPlan.web,'inside');
      const old={ensure:SomataLayerSceneService.ensure,queue:SomataLayerSceneService.queue,status:WebGPUWebThreadSceneRenderer.status,isReady:WebGPUWebThreadSceneRenderer.isReady,encode:WebGPUWebThreadSceneRenderer.encodeToLayerScene};
      const queued=[];let encodedCommands=0;
      try{
        SomataLayerSceneService.ensure=()=>({texture:{createView(){return{};}}});
        SomataLayerSceneService.queue=(ctx,phase,commandBuffer,label)=>{queued.push({phase,label,commandBuffer});return true;};
        WebGPUWebThreadSceneRenderer.status=()=>({available:true,initializing:false,lastError:''});
        WebGPUWebThreadSceneRenderer.isReady=()=>true;
        WebGPUWebThreadSceneRenderer.encodeToLayerScene=(texture,commands)=>{encodedCommands=commands?.length||0;return{handled:true,commandBuffer:{kind:'web-static'}};};
        renderLayerWebPass(c);
      } finally {
        SomataLayerSceneService.ensure=old.ensure;SomataLayerSceneService.queue=old.queue;WebGPUWebThreadSceneRenderer.status=old.status;WebGPUWebThreadSceneRenderer.isReady=old.isReady;WebGPUWebThreadSceneRenderer.encodeToLayerScene=old.encode;
      }
      return{enabled:d?.enabled===true,corners:d?.corners?.length||0,rawCommands:raw?.length||0,subpaths:(raw||[]).reduce((n,x)=>n+(x?.subpaths?.length||0),0),handled:c._webPassHandled===true,encodedCommands,queued:queued.map(x=>({phase:x.phase,label:x.label,kind:x.commandBuffer?.kind||''})),placement:d?.placementMode,depth:d?.depthPercent,fill:l.fill===true,morph:runtimeState.morph?.active===true,phases:{fill:somataEffectPhase('fill'),web:somataEffectPhase('web')}};
    })()`);
    assert(r.morph===false,'test accidentally entered Morph');
    assert(r.fill===true,'test is not exercising Web + Fill');
    assert(r.enabled&&r.placement==='corners'&&r.depth===60,'static Web was not prepared with corner defaults');
    assert(r.corners>0&&r.rawCommands>0&&r.subpaths>0,'static Web produced no real thread geometry');
    assert(r.handled&&r.encodedCommands>0,'static Web render pass did not reach GPU encoder');
    assert(r.phases.fill<r.phases.web,'default effect order must keep Fill below Web');assert(r.queued.some(x=>x.phase===r.phases.web&&String(x.label).startsWith('web')),`static Web command was not queued at central Web phase: ${JSON.stringify(r.queued)}`);
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('PASS 7.8.3 static Web render pass + Fill ordering',r);
  } finally {await h.close();}
}
main().catch(e=>{console.error('FAIL 7.8.3 static Web render pass regression:',e.stack||e.message);process.exit(1)});
