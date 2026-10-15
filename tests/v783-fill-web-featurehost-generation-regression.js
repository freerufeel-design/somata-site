const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:30000,loadDelayMs:400});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      const modes=['corners','selfIntersection','selfIntersectionCorridor'],samples=[];
      const l=createLayer('v783-fill-web-featurehost');
      Object.assign(l,{visible:true,lineVisible:true,N:7,K:2,radius:150,rounding:15,closedLoop:true,fill:true,fillColor:'#224466cc',strokeWidth:3,strokeColor:'#00e0ff'});
      ensureLayerEffectState(l);l.showWeb=true;l.web.style='web';l.web.distance=60;l.web.width=2;l.web.color='#ffffff';
      state.showWeb=true;state.tunnel.active=false;state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;refreshLayerLookup(true);
      function clearSurface(){mainCtx.save();mainCtx.setTransform(1,0,0,1,0,0);mainCtx.clearRect(0,0,mainCanvas.width,mainCanvas.height);mainCtx.restore();}
      function pixels(){const w=Math.min(256,mainCanvas.width),h=Math.min(256,mainCanvas.height),d=mainCtx.getImageData(0,0,w,h).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;return n;}
      function runStage(c,stage){return SomataRenderPassRegistry.runStage(stage,c,row=>SomataFeatureHost.has(row.name)?SomataFeatureHost.run(row.name,c,child=>row.run(child)):row.run(c));}
      function probe(tag,mode){
        l.web.placementMode=mode;invalidateLayerEffect?.(l,'v783-fill-web-featurehost-mode');clearSurface();beginFrameGeometryRuntime();
        const f=renderRuntime.frame||{};f.now=performance.now();f.id=(Number(f.id)||0)+1;f.dpr=1;
        const c=prepareMainLayerFrame(f,0),contract=getLayerGeometryContract(c),before=__spiroWebPassStatus();
        runStage(c,SomataRenderPassRegistry.STAGES.FILL);
        const afterFill={resolved:c._fillBelowWebResolved===true,rendered:c._fillRenderedBelowWeb===true,suppress:c._suppressLateFillForWeb===true,baseFill:c._baseFillCommitted===true};
        runStage(c,SomataRenderPassRegistry.STAGES.OVER_FILL);
        const d=c.effectsPlan?.web?.frameData||null,after=__spiroWebPassStatus();
        samples.push({tag,mode,fillRequested:contract?.fillRequested===true,dynamic:c.geometryPlan?.dynamic===true,morphFrame:c.morphFrameActive===true,enabled:c.effectsPlan?.web?.enabled===true,corners:d?.corners?.length||0,afterFill,webHandled:c._webPassHandled===true,backend:after.lastBackend,reason:after.lastReason,pixels:pixels(),featureFillOutputs:(__somataFeatureHostStatus().features.find(x=>x.name==='fill')?.outputs||[])});
      }
      for(const mode of modes)probe('static',mode);
      const btn=document.getElementById('btnMorph');if(runtimeState.morph.active)btn.click();btn.click();await new Promise(r=>setTimeout(r,160));
      for(const mode of modes)probe('morph',mode);
      if(runtimeState.morph.active)btn.click();
      return{samples};
    })()`);
    assert(r.samples.length===6,'expected six Fill+Web FeatureHost samples');
    for(const q of r.samples){
      assert(q.fillRequested,`${q.tag}/${q.mode}: Fill was not requested`);
      assert(q.enabled,`${q.tag}/${q.mode}: Web plan disabled`);
      assert(q.corners>0,`${q.tag}/${q.mode}: Web preparation produced no anchors`);
      assert(q.featureFillOutputs.includes('_fillBelowWebResolved')&&q.featureFillOutputs.includes('_fillRenderedBelowWeb')&&q.featureFillOutputs.includes('_suppressLateFillForWeb'),`${q.tag}/${q.mode}: Fill ordering outputs are not declared in FeatureHost`);
      assert(q.afterFill.resolved,`${q.tag}/${q.mode}: real FeatureHost Fill pass discarded _fillBelowWebResolved`);
      assert(q.webHandled,`${q.tag}/${q.mode}: Fill prevented Web pass (${q.reason})`);
      assert(q.reason!=='Fill ordering pass has not resolved yet',`${q.tag}/${q.mode}: Web still gated by lost Fill ordering state`);
      assert(q.pixels>0,`${q.tag}/${q.mode}: Fill+Web produced no visible Web fallback pixels`);
      if(q.tag==='morph')assert(q.dynamic&&q.morphFrame,`${q.mode}: active Morph did not use dynamic geometry`);
      else assert(!q.morphFrame,`${q.mode}: static probe unexpectedly in Morph frame`);
    }
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('PASS 7.8.3 Fill no longer blocks Web generation/presentation through FeatureHost: 3 modes Static + Morph',r.samples);
  } finally {await h.close();}
}
main().catch(e=>{console.error('FAIL 7.8.3 Fill/Web FeatureHost generation regression:',e.stack||e.message);process.exit(1)});
