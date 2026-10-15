const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
 const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:12000,loadDelayMs:300});
 const baseline=uncaughtExceptions(h.events).length;
 try{
  const out=await h.evaluate(`(async()=>{
    const l=state.layers[0]||createLayer('rounding-immediate-morph');if(!state.layers.length)state.layers.push(l);state.layers.splice(1);state.activeLayerId=l.id;
    l.visible=true;l.lineVisible=true;l.N=17;l.K=5;l.radius=220;l.rounding=10;l.spiralEnabled=true;l.spiralClosed=true;l.spiralOrder=3;l.spiralStepLinked=false;l.spiralStep=2.4;l.spiralTangential=true;l.spiralRoundSeams=true;
    ensureLayerEffectState(l);l.showWeb=true;l.web.inside=true;l.web.outsideStraight=true;l.web.outsideArc=true;state.showWeb=true;
    invalidateLayerGeometry(l,'rounding-immediate-baseline');refreshLayerLookup(true);setSingleLayerSelection?.(l);syncSidebarInputs();requestMainCanvasRender();
    state.morph.intervalSec=8;const interval=document.getElementById('morphInterval');if(interval){interval.value='8';interval.dispatchEvent(new Event('input',{bubbles:true}));}
    const btn=document.getElementById('btnMorph');if(runtimeState.morph.active)btn.click();btn.click();await new Promise(r=>setTimeout(r,260));
    const beforeStats=__spiroAnimationStats();const beforeFrame=(runtimeState.morph.frameLayers||[]).find(x=>x?.id===l.id);const before={canon:l.rounding,frame:Number(beforeFrame?.rounding),frames:beforeStats.frameCount,progress:Number(runtimeState.morph.progress)||0,phase:Number(runtimeState.morph.phaseSerial)||0};
    const el=document.getElementById('paramRounding');el.value='95';el.dispatchEvent(new Event('input',{bubbles:true}));
    const immediateFrame=(runtimeState.morph.frameLayers||[]).find(x=>x?.id===l.id);const immediate={canon:l.rounding,frame:Number(immediateFrame?.rounding),phase:Number(runtimeState.morph.phaseSerial)||0};
    let sig=null;if(immediateFrame){invalidateLayerGeometry(immediateFrame,'rounding-immediate-test');const d=getCachedLayerDrawData(immediateFrame);const paths=d?.paths||[];let count=0,finite=true,sum=0;for(const p of paths){for(const q of p?.points||[]){count++;finite=finite&&Number.isFinite(q.x)&&Number.isFinite(q.y);sum+=Number(q.x)||0;sum+=Number(q.y)||0;}}sig={count,finite,sum:Number(sum.toFixed(4))};}
    await new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;resolve()};try{afterNextPaint(finish)}catch(_){requestAnimationFrame(finish)}setTimeout(finish,260)});
    const afterStats=__spiroAnimationStats();const afterFrame=(runtimeState.morph.frameLayers||[]).find(x=>x?.id===l.id);const after={canon:l.rounding,frame:Number(afterFrame?.rounding),frames:afterStats.frameCount,progress:Number(runtimeState.morph.progress)||0,phase:Number(runtimeState.morph.phaseSerial)||0,inFrame:afterStats.inFrame,paintErrors:afterStats.paintErrors||0,active:runtimeState.morph.active===true};
    if(runtimeState.morph.active)btn.click();return{before,immediate,sig,after};
  })()`,{timeoutMs:7000,label:'rounding immediate Morph regression'});
  console.log('ROUNDING IMMEDIATE MORPH PROBE',out);
  assert(out.before.frame===10,'baseline morph frame did not start at expected rounding');
  assert(out.immediate.canon===95,'rounding input did not update canonical layer immediately');
  assert(out.immediate.frame===95,`active Morph frame kept stale rounding after input: ${out.immediate.frame}`);
  assert(out.sig?.count>2&&out.sig.finite,'immediate frame geometry is empty/non-finite');
  assert(out.after.frames>out.before.frames,'rounding input did not reach a later paint');
  assert(out.after.active&&out.after.paintErrors===0&&!out.after.inFrame,'Morph/scheduler unstable after immediate rounding update');
  const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
  console.log('ROUNDING IMMEDIATE MORPH REGRESSION: PASS');
 }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL rounding immediate Morph regression:',e.stack||e.message);process.exit(1)});
