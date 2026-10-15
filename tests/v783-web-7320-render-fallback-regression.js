const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:30000,loadDelayMs:400});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      const modes=['corners','selfIntersection','selfIntersectionCorridor'],samples=[];
      const l=createLayer('v783-web-7320-fallback');
      Object.assign(l,{visible:true,lineVisible:true,N:7,K:2,radius:150,rounding:15,closedLoop:true,fill:true,fillColor:'#223355aa',strokeWidth:3,strokeColor:'#3388ff'});
      ensureLayerEffectState(l);l.showWeb=true;l.web.style='web';l.web.distance=60;l.web.width=2;l.web.color='#ffffff';
      state.showWeb=true;state.tunnel.active=false;state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;refreshLayerLookup(true);
      function clearSurface(){mainCtx.save();mainCtx.setTransform(1,0,0,1,0,0);mainCtx.clearRect(0,0,mainCanvas.width,mainCanvas.height);mainCtx.restore();}
      function visiblePixels(){const w=mainCanvas.width,h=mainCanvas.height,im=mainCtx.getImageData(0,0,w,h).data;let n=0;for(let i=3;i<im.length;i+=4)if(im[i])n++;return n;}
      function probe(tag,mode){
        l.web.placementMode=mode;invalidateLayerEffect?.(l,'v783-web-7320-mode');clearSurface();beginFrameGeometryRuntime();
        const f=renderRuntime.frame||{};f.now=performance.now();f.id=(Number(f.id)||0)+1;f.dpr=1;const c=prepareMainLayerFrame(f,0);
        // Execute the real Fill-before-Web ordering stage. With GPU disabled this resolves
        // the dependency but cannot paint Fill, so any sampled pixels below come from Web.
        const fillResult=prepareRetainedFillSceneBeforeGlow(c);
        const d=c.effectsPlan?.web?.frameData||prepareLayerFrameWebData(c),cmds=d?.enabled===true?getFrameWebGPUCommands(c,c.effectsPlan.web,'inside'):null;
        renderLayerWebPass(c);const status=__spiroWebPassStatus();
        samples.push({tag,mode,dynamic:c.geometryPlan?.dynamic===true,morphFrame:c.morphFrameActive===true,enabled:d?.enabled===true,corners:d?.corners?.length||0,commands:cmds?.length||0,subpaths:(cmds||[]).reduce((n,x)=>n+(x?.subpaths?.length||0),0),handled:c._webPassHandled===true,backend:status.lastBackend,reason:status.lastReason,pixels:visiblePixels(),fillResolved:c._fillBelowWebResolved===true,fillHandled:fillResult?.handled===true});
      }
      for(const mode of modes)probe('static',mode);
      const btn=document.getElementById('btnMorph');if(runtimeState.morph.active)btn.click();btn.click();await new Promise(r=>setTimeout(r,160));
      for(const mode of modes)probe('morph',mode);
      if(runtimeState.morph.active)btn.click();
      return{samples,status:__spiroWebPassStatus()};
    })()`);
    assert(r.samples.length===6,'expected six Static/Morph Web samples');
    for(const q of r.samples){
      assert(q.enabled,`${q.tag}/${q.mode}: Web plan disabled`);
      assert(q.corners>0,`${q.tag}/${q.mode}: no Web anchors/corners`);
      assert(q.commands>0&&q.subpaths>0,`${q.tag}/${q.mode}: no real Web thread commands`);
      assert(q.fillResolved,`${q.tag}/${q.mode}: Fill-before-Web dependency was not resolved`);
      assert(q.handled,`${q.tag}/${q.mode}: Web render pass was skipped (${q.reason})`);
      assert(/fallback/.test(q.backend),`${q.tag}/${q.mode}: GPU-unavailable path did not use the 7.3.20-style presentation fallback: ${q.backend}`);
      assert(q.pixels>0,`${q.tag}/${q.mode}: Web produced no visible Canvas pixels`);
      if(q.tag==='morph')assert(q.dynamic&&q.morphFrame,`${q.mode}: active Morph did not use dynamic geometry`);
      else assert(!q.morphFrame,`${q.mode}: static sample unexpectedly owned by Morph`);
    }
    assert(r.status.ordinaryFallback===true&&r.status.strictSpiralGpuOnly===true,'fallback policy contract missing');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('PASS 7.8.3 Web 7.3.20-style presentation fallback: all 3 modes in Static + Morph',r.samples);
  } finally {await h.close();}
}
main().catch(e=>{console.error('FAIL 7.8.3 Web 7.3.20 fallback regression:',e.stack||e.message);process.exit(1)});
