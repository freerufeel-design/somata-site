const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};

function assertRecoverySourceContract(){
  const src=fs.readFileSync(path.join(__dirname,'..','js','app','ui-project-runtime.js'),'utf8');
  const marker=src.indexOf("'MORPH_FULL_GPU_PREWARM_FAILED'");
  assert(marker>=0,'missing MORPH_FULL_GPU_PREWARM_FAILED diagnostic');
  const start=Math.max(0,src.lastIndexOf('}).catch(err=>{',marker));
  const end=src.indexOf('runtimeState.morph.cycleStart=performance.now();',marker+1);
  const block=src.slice(start,end>start?end+80:marker+1600);
  assert(block.includes("invalidateMorphFrameInterpolationPlans('gpu-prewarm-recovery')"),'general Morph GPU failure has no CPU-geometry recovery invalidation');
  assert(block.includes('MorphGeometry.buildMorphGeometry'),'general Morph GPU failure does not rebuild skipped retained geometry');
  assert(block.includes('runtimeState.morph.gpuPhasePreparing=false'),'general Morph GPU failure still leaves gpuPhasePreparing latched');
  assert(!block.includes('gpuPhasePreparing=true; // fail closed: no fallback clock.'),'general Morph GPU failure still contains fail-closed timeline deadlock');
  assert(block.includes("activeEnsureFullMorphSchedulerOwnership?.('gpu-prewarm-recovery')"),'general Morph GPU failure does not restore scheduler ownership');
}

async function main(){
  assertRecoverySourceContract();
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:260,evalTimeoutMs:18000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const setV=(id,v,ev='change')=>{const e=document.getElementById(id);if(!e)throw new Error('missing '+id);e.value=String(v);e.dispatchEvent(new Event(ev,{bubbles:true}));};
      const setC=(id,v)=>{const e=document.getElementById(id);if(!e)throw new Error('missing '+id);e.checked=!!v;e.dispatchEvent(new Event('change',{bubbles:true}));};
      const modes=['topology','calm','circleSlide','fade','light'];
      const results={};
      for(const mode of modes){
        if(runtimeState.morph.active){document.getElementById('btnMorph').click();await wait(80);}
        const l=state.layers[0];state.layers.splice(1);state.activeLayerId=l.id;l.visible=true;l.lineVisible=true;l.spiralEnabled=false;l.closedLoop=true;l.N=7;l.K=2;l.radius=210;l.rounding=20;l.roundingMode='standard';l.profileMode='segments';l.profileNodes=[{x:0,y:0},{x:.3,y:.2},{x:.7,y:-.15},{x:1,y:0}];
        invalidateLayerGeometry(l,'morph-mode-start-matrix');syncSidebarInputs();
        setV('morphModeTop',mode);setV('morphInterval',1,'input');setV('morphInterval',1,'change');
        if(mode==='fade'){setV('morphFadePercentValue',100,'change');setV('morphFadePercent',100,'input');}
        setC('morphByVertices',true);setC('morphBySteps',true);setC('morphBySize',true);setC('morphByRounding',true);setC('morphByShape',true);
        setV('morphVertexMin',11);setV('morphVertexMax',13);setV('morphStepMin',40);setV('morphStepMax',80);setV('morphRoundingMin',60);setV('morphRoundingMax',90);
        const beforePaint=animationScheduler.stats().paintCount;
        document.getElementById('btnMorph').click();
        await wait(220);const a={p:Number(runtimeState.morph.progress)||0,g:Number(runtimeState.morph.geometryT)||0};
        await wait(360);const f=runtimeState.morph.frameLayers?.[0]||runtimeState.morph.lightLayers?.[0]||null;
        const b={p:Number(runtimeState.morph.progress)||0,g:Number(runtimeState.morph.geometryT)||0};
        results[mode]={selected:state.morph.mode,active:runtimeState.morph.active===true,paused:runtimeState.morph.paused===true,gpuPreparing:runtimeState.morph.gpuPhasePreparing===true,hasMorph:animationScheduler.has('morph'),a,b,frame:f?{N:Number(f.N),K:Number(f.K),radius:Number(f.radius),rounding:Number(f.rounding)}:null,paintDelta:animationScheduler.stats().paintCount-beforePaint,inFrame:animationScheduler.stats().inFrame};
      }
      if(runtimeState.morph.active)document.getElementById('btnMorph').click();
      return results;
    })()`,{timeoutMs:16000,label:'real UI Morph mode start matrix'});

    for(const mode of ['topology','calm','circleSlide','fade','light']){
      const r=out[mode];
      assert(r.selected===mode,`${mode}: top UI selector did not select requested mode`);
      assert(r.active===true,`${mode}: Morph button did not keep mode active`);
      assert(r.paused===false,`${mode}: Morph unexpectedly paused`);
      assert(r.gpuPreparing===false,`${mode}: Morph is still gated by gpuPhasePreparing`);
      assert(r.hasMorph===true,`${mode}: Morph scheduler is not running`);
      assert(r.b.p>r.a.p+0.08||r.b.p<r.a.p-0.3,`${mode}: progress did not visibly advance/wrap (${r.a.p} -> ${r.b.p})`);
      assert(r.paintDelta>0,`${mode}: no paints after real UI start`);
      assert(r.frame&&Object.values(r.frame).every(Number.isFinite),`${mode}: active render frame is missing/non-finite`);
      assert(r.inFrame===false,`${mode}: scheduler stuck inFrame`);
      if(mode!=='fade')assert(Math.max(r.a.g,r.b.g)>0.05,`${mode}: geometry timeline did not start`);
      else assert(Math.max(r.a.g,r.b.g)>0.05,'fade: 100% fade window still did not animate geometry');
    }
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('MORPH MODE START + GPU PREWARM RECOVERY: PASS',out);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL Morph mode start + GPU prewarm recovery:',e.stack||e.message);process.exit(1)});
