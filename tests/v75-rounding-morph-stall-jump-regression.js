const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
 const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:9000,loadDelayMs:320});
 const baseline=uncaughtExceptions(h.events).length;
 try{
  const out=await h.evaluate(`(async()=>{
    const l=state.layers[0]||createLayer('rounding-stall-jump');if(!state.layers.length)state.layers.push(l);state.layers.splice(1);state.activeLayerId=l.id;
    l.visible=true;l.lineVisible=true;l.N=17;l.K=5;l.radius=220;l.rounding=72;l.profileMode='spline';l.spiralEnabled=true;l.spiralClosed=true;l.spiralOrder=3;l.spiralStepLinked=false;l.spiralStep=2.4;l.spiralTangential=true;l.spiralRoundSeams=true;
    ensureLayerEffectState(l);l.showWeb=true;l.web.inside=true;l.web.outsideStraight=true;l.web.outsideArc=true;state.showWeb=true;
    invalidateLayerGeometry(l,'rounding-stall-jump');refreshLayerLookup(true);setSingleLayerSelection?.(l);syncSidebarInputs();requestMainCanvasRender();
    state.morph.intervalSec=4;state.morph.options.byRounding=true;state.morph.roundingMin=18;state.morph.roundingMax=95;
    const interval=document.getElementById('morphInterval');if(interval){interval.value='4';interval.dispatchEvent(new Event('input',{bubbles:true}));interval.dispatchEvent(new Event('change',{bubbles:true}));}
    const btn=document.getElementById('btnMorph');if(runtimeState.morph.active)btn.click();btn.click();await new Promise(r=>setTimeout(r,360));
    const beforeStats=animationScheduler.stats(),freeze0=animationScheduler.freezeStats();const p0=Number(runtimeState.morph.progress)||0,cycleStart0=Number(runtimeState.morph.cycleStart)||0;
    const t0=performance.now();while(performance.now()-t0<240){}const blocked=performance.now()-t0;
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const sampleNow=performance.now(),p1=Number(runtimeState.morph.progress)||0,afterStats=animationScheduler.stats(),freeze1=animationScheduler.freezeStats();
    const frame=(runtimeState.morph.frameLayers||[]).find(x=>x?.id===l.id)||l;invalidateLayerGeometry(frame,'rounding-stall-jump-proof');const d=getCachedLayerDrawData(frame);let count=0,finite=true;for(const path of d?.paths||[])for(const q of path?.points||[]){count++;finite=finite&&Number.isFinite(q.x)&&Number.isFinite(q.y);}
    const compensated=Number(runtimeState.morph.timelineStallCompensationMs)||0,lastComp=Number(runtimeState.morph.lastTimelineStallCompensationMs)||0,lastAdvance=Number(runtimeState.morph.lastTimelineStallAdvanceMs)||0;
    const active=runtimeState.morph.active===true;if(active)btn.click();await new Promise(r=>setTimeout(r,40));
    const expectedRaw=Math.max(0,Math.min(1,(sampleNow-cycleStart0)/4000));return{p0,p1,delta:p1-p0,blocked,active,expectedRaw,expectedError:Math.abs(p1-expectedRaw),frameDelta:afterStats.frameCount-beforeStats.frameCount,paintDelta:afterStats.paintCount-beforeStats.paintCount,recoveries:afterStats.watchdogRecoveries-beforeStats.watchdogRecoveries,freezeDelta:freeze1.count-freeze0.count,paintErrors:afterStats.paintErrors||0,inFrame:afterStats.inFrame,count,finite,compensated,lastComp,lastAdvance};
  })()`,{timeoutMs:6500,label:'rounding Morph stall jump regression'});
  console.log('ROUNDING MORPH STALL JUMP PROBE',out);
  assert(out.active,'Morph stopped after the induced main-thread stall');
  assert(out.recoveries>0||out.freezeDelta>0,'induced stall did not exercise scheduler/freeze recovery');
  assert(out.delta>0,'Morph did not resume after the stall');
  assert(out.delta>0.035,`Morph timeline did not catch up to wall clock after the stall: delta=${out.delta}`);
  assert(out.expectedError<0.035,`Morph progress diverged from its wall-clock timeline: progress=${out.p1}, expected=${out.expectedRaw}`);
  assert(out.compensated===0&&out.lastComp===0&&out.lastAdvance===0,'obsolete Morph-only stall compensation was applied');
  assert(out.frameDelta>0&&out.paintDelta>0,'no fresh frame/paint after the stall');
  assert(out.count>2&&out.finite,'post-stall Spiral geometry is empty/non-finite');
  assert(out.paintErrors===0&&!out.inFrame,'scheduler/render unstable after the stall');
  const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
  console.log('ROUNDING MORPH STALL JUMP REGRESSION: PASS');
 }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL rounding Morph stall jump regression:',e.stack||e.message);process.exit(1)});
