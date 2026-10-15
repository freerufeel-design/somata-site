const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:320,evalTimeoutMs:15000});
 const baseline=uncaughtExceptions(h.events).length;
 try{
  const out=await h.evaluate(`(async()=>{
   const wait=ms=>new Promise(r=>setTimeout(r,ms));
   const change=(id,v)=>{const e=document.getElementById(id);if(!e)throw new Error('missing '+id);e.value=String(v);e.dispatchEvent(new Event('change',{bubbles:true}));};
   const run=async(mode)=>{
    if(runtimeState.morph.active){document.getElementById('btnMorph').click();await wait(60);}
    const l=state.layers[0];state.layers.splice(1);state.activeLayerId=l.id;l.N=9;l.K=3;l.radius=220;l.rounding=20;l.profileMode='segments';l.profileNodes=[{x:0,y:0},{x:.35,y:.22},{x:.7,y:-.18},{x:1,y:0}];
    invalidateLayerGeometry(l,'v761-stall');syncSidebarInputs();change('morphModeTop',mode);change('morphInterval',4);
    document.getElementById('btnMorph').click();await wait(300);
    const p0=Number(runtimeState.morph.progress)||0,c0=Number(runtimeState.morph.timelineStallCompensationMs)||0,cycleStart0=Number(runtimeState.morph.cycleStart)||0;
    const t0=performance.now();while(performance.now()-t0<240){}
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const sampleNow=performance.now(),p1=Number(runtimeState.morph.progress)||0,c1=Number(runtimeState.morph.timelineStallCompensationMs)||0;
    const stats=animationScheduler.stats();
    document.getElementById('btnMorph').click();await wait(40);
    const expectedRaw=Math.max(0,Math.min(1,(sampleNow-cycleStart0)/4000));return {mode,p0,p1,delta:p1-p0,comp:c1-c0,expectedRaw,expectedError:Math.abs(p1-expectedRaw),inFrame:stats.inFrame,paintErrors:stats.paintErrors||0};
   };
   return {topology:await run('topology'),calm:await run('calm')};
  })()`,{timeoutMs:12000,label:'7.6.1 topology/calm stall continuity'});
  for(const r of [out.topology,out.calm]){
    assert(r.p1>r.p0,'Morph did not resume after stall in '+r.mode);
    assert(r.delta>0.035,'Morph timeline remained visually frozen after stall in '+r.mode+': '+r.delta);
    assert(r.expectedError<0.035,'Morph timeline diverged from wall clock in '+r.mode+': '+JSON.stringify(r));
    assert(r.comp===0,'obsolete Morph-only stall compensation was applied in '+r.mode);
    assert(r.paintErrors===0&&!r.inFrame,'scheduler unstable in '+r.mode);
  }
  const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught: '+exc.join(' | '));
  console.log('SOMATA 7.6.1 TOPOLOGY/CALM STALL CONTINUITY: PASS',out);
 }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.6.1 topology/calm stall continuity:',e.stack||e.message);process.exit(1)});
