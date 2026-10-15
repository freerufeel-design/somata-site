const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
 const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:10000,loadDelayMs:360});
 const baseline=uncaughtExceptions(h.events).length;
 try{
  const out=await h.evaluate(`(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const twoRaf=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const l=state.layers[0]||createLayer('line-effect-time-sync');if(!state.layers.length)state.layers.push(l);state.layers.splice(1);state.activeLayerId=l.id;
    l.visible=true;l.lineVisible=true;l.N=11;l.K=3;l.radius=215;l.rotation=0;l.rounding=18;l.profileMode='segments';l.spiralEnabled=false;l.closedLoop=true;
    ensureLayerEffectState(l);l.showGraffiti=true;state.showGraffiti=true;
    state.morph.intervalSec=4;state.morph.mode='circleSlide';state.morph.options.byShape=true;state.morph.options.byRotation=true;
    invalidateLayerGeometry(l,'line-effect-time-sync');refreshLayerLookup(true);setSingleLayerSelection?.(l);syncSidebarInputs();requestMainCanvasRender();
    const interval=document.getElementById('morphInterval');if(interval){interval.value='4';interval.dispatchEvent(new Event('input',{bubbles:true}));interval.dispatchEvent(new Event('change',{bubbles:true}));}
    const mode=document.getElementById('morphMode');if(mode){mode.value='circleSlide';mode.dispatchEvent(new Event('change',{bubbles:true}));}
    const calls=[];const originalPrepare=prepareMainLayerGeometryPlan;prepareMainLayerGeometryPlan=function(frameCtx){const plan=originalPrepare(frameCtx);if(frameCtx?.layerIndex===0)calls.push({kind:String(plan?.kind||''),t:Number(plan?.progress)||0,at:performance.now()});return plan;};
    const btn=document.getElementById('btnMorph');if(runtimeState.morph.active)btn.click();btn.click();await wait(360);await twoRaf();
    const beforeCalls=calls.length,p0=Number(runtimeState.morph.progress)||0,t0=calls.length?calls[calls.length-1].t:NaN,cycleStart0=Number(runtimeState.morph.cycleStart)||0;
    const blockStart=performance.now();while(performance.now()-blockStart<260){}const blocked=performance.now()-blockStart;
    await twoRaf();
    const sampleNow=performance.now(),p1=Number(runtimeState.morph.progress)||0,t1=calls.length?calls[calls.length-1].t:NaN,afterCalls=calls.length;
    const expectedRaw=Math.max(0,Math.min(1,(sampleNow-cycleStart0)/4000));
    const stats=animationScheduler.stats();const comp=Number(runtimeState.morph.timelineStallCompensationMs)||0;
    if(runtimeState.morph.active)btn.click();prepareMainLayerGeometryPlan=originalPrepare;await wait(40);
    return{p0,p1,progressDelta:p1-p0,t0,t1,lineDelta:t1-t0,beforeCalls,afterCalls,blocked,expectedRaw,expectedError:Math.abs(p1-expectedRaw),comp,paintErrors:stats.paintErrors||0,inFrame:stats.inFrame};
  })()`,{timeoutMs:7500,label:'7.7.9 Base/Line and effects timeline sync'});
  console.log('LINE/EFFECT SYNC PROBE',out);
  assert(out.beforeCalls>0&&out.afterCalls>out.beforeCalls,'real Base/Line geometry plan did not repaint after the stall');
  assert(Number.isFinite(out.t0)&&Number.isFinite(out.t1)&&out.lineDelta>0.035,`Base/Line remained visually frozen after stall: ${JSON.stringify(out)}`);
  assert(out.progressDelta>0.035,'Morph progress remained capped behind the common wall clock');
  assert(out.expectedError<0.035,`Morph/Base timeline is not synchronized to current frame time: ${JSON.stringify(out)}`);
  assert(out.comp===0,'Morph-only stall compensation reappeared and can desynchronize effects from Base/Line');
  assert(out.paintErrors===0&&!out.inFrame,'scheduler/render unstable after induced stall');
  const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
  console.log('SOMATA 7.7.9 LINE/EFFECT TIMELINE SYNC: PASS',out);
 }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.7.9 line/effect timeline sync:',e.stack||e.message);process.exit(1)});
