const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:30000,loadDelayMs:400});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(()=>{
      const l=createLayer('fill-geometry-separation');
      Object.assign(l,{visible:true,lineVisible:true,N:7,K:2,radius:170,rounding:20,closedLoop:true,fill:true,fillColor:'#224466cc',strokeWidth:3,strokeColor:'#00e0ff'});
      ensureLayerEffectState(l);l.showWeb=false;l.web.placementMode='corners';l.web.distance=60;
      state.showWeb=false;state.tunnel.active=false;state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;refreshLayerLookup(true);
      SomataEffectStackOrder.set(['fill','web','geometry','lamps','sweep','pathfx','particles']);
      const old={ready:WebGPUStrokeRenderer.isReady,warm:WebGPUStrokeRenderer.warmup,batch:WebGPUStrokeRenderer.renderLayerBatch,attach:SomataFillPassService.prepareBatchAttachment};
      const samples=[];let attachCalls=0,lastSceneOpt=null;
      try{
        WebGPUStrokeRenderer.isReady=()=>true;WebGPUStrokeRenderer.warmup=()=>true;
        WebGPUStrokeRenderer.renderLayerBatch=(commands,specs,opt)=>{lastSceneOpt=opt;return{roles:new Set(['base']),sceneCombined:true,sceneTexture:{},commandBuffer:{kind:'geometry'},submitted:false,fillInScene:Boolean(opt?.fillMask||opt?.nativeFillMesh),nativeFillInScene:Boolean(opt?.nativeFillMesh),preserveExistingScene:Boolean(opt?.preserveExistingScene)}};
        const origAttach=old.attach;
        SomataFillPassService.prepareBatchAttachment=(ctx,strict)=>{attachCalls++;return origAttach(ctx,strict);};
        const frame=(tag)=>{beginFrameGeometryRuntime();const f=renderRuntime.frame||{};f.now=performance.now();f.id=(Number(f.id)||0)+1;f.dpr=1;const c=prepareMainLayerFrame(f,0);attachCalls=0;lastSceneOpt=null;const plan=SomataEffectStackOrder.plan(c);SomataStrokeBatchService.prepare(c);samples.push({tag,webEnabled:c.effectsPlan?.web?.enabled===true,plan,attachCalls,sceneOpt:lastSceneOpt?{fillMask:Boolean(lastSceneOpt.fillMask),nativeFillMesh:Boolean(lastSceneOpt.nativeFillMesh),preserveExistingScene:Boolean(lastSceneOpt.preserveExistingScene)}:null});return c;};
        frame('web-off');
        l.showWeb=true;state.showWeb=true;invalidateLayerEffect?.(l,'fill-geometry-separation-web-on');
        frame('web-on');
        // Also prove the stack rule itself, independent of any transient Fill-pass flags.
        const c=prepareMainLayerFrame(renderRuntime.frame,0);c._fillRenderedBelowWeb=false;c._suppressLateFillForWeb=false;attachCalls=0;lastSceneOpt=null;SomataStrokeBatchService.prepare(c);samples.push({tag:'web-on-no-transient-flags',webEnabled:c.effectsPlan?.web?.enabled===true,plan:SomataEffectStackOrder.plan(c),attachCalls,sceneOpt:lastSceneOpt?{fillMask:Boolean(lastSceneOpt.fillMask),nativeFillMesh:Boolean(lastSceneOpt.nativeFillMesh)}:null});
        return{samples,order:SomataEffectStackOrder.current()};
      } finally {WebGPUStrokeRenderer.isReady=old.ready;WebGPUStrokeRenderer.warmup=old.warm;WebGPUStrokeRenderer.renderLayerBatch=old.batch;SomataFillPassService.prepareBatchAttachment=old.attach;SomataEffectStackOrder.set([...SomataEffectStackOrder.DEFAULT_ORDER]);}
    })()`);
    const off=r.samples.find(x=>x.tag==='web-off'),on=r.samples.find(x=>x.tag==='web-on'),noFlags=r.samples.find(x=>x.tag==='web-on-no-transient-flags');
    assert(off&&on&&noFlags,'missing separation samples');
    assert(off.plan.fillCanFuse===true&&off.plan.standaloneFill===false,'Web-off fast path no longer fuses adjacent active Fill+Geometry');
    assert(off.attachCalls===1,'Web-off fast path did not attach Fill to Geometry exactly once');
    assert(on.webEnabled&&on.plan.standaloneFill===true,'Web-on frame did not structurally separate Fill from Geometry');
    assert(on.attachCalls===0,'Web-on Geometry batch tried to attach Fill again');
    assert(!on.sceneOpt?.fillMask&&!on.sceneOpt?.nativeFillMesh,'Web-on Geometry batch still contains Fill resources');
    assert(noFlags.plan.standaloneFill===true,'stack planner lost Fill/Web/Geometry separation');
    assert(noFlags.attachCalls===0,'Geometry ownership incorrectly depended on transient Fill-pass flags');
    assert(!noFlags.sceneOpt?.fillMask&&!noFlags.sceneOpt?.nativeFillMesh,'Geometry reabsorbed Fill when transient flags were absent');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('PASS 7.8.3 Fill and Geometry are independent artistic layers when Web is between them; Web-off fast path remains fused',r.samples);
  } finally {await h.close();}
}
main().catch(e=>{console.error('FAIL 7.8.3 Fill/Geometry separation regression:',e.stack||e.message);process.exit(1)});
