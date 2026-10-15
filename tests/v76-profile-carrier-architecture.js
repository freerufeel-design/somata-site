const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};

function assertSourceContract(){
  const root=path.join(__dirname,'..');
  const ui=fs.readFileSync(path.join(root,'js','app','ui-project-runtime.js'),'utf8');
  const pipe=fs.readFileSync(path.join(root,'js','render','main-pipeline.js'),'utf8');
  const gpu=fs.readFileSync(path.join(root,'js','gpu','morph-path-resource.js'),'utf8');
  const frame=fs.readFileSync(path.join(root,'js','geometry','frame-paths.js'),'utf8');
  assert(!/circleDirectPathMode\s*=\s*state\.morph\.mode\s*===\s*['\"]circleSlide['\"]\s*\|\|\s*spiralMorphUsesCircleRebuild/.test(ui),
    'Spiral carrier still overrides the selected Morph mode in prepareMorphCycle');
  assert(!/effectiveCircleMode\s*=\s*snap\.mode\s*===\s*['\"]circleSlide['\"]\s*\|\|/.test(pipe),
    'Spiral retained rail still coerces non-circle Morph into circle renderer routing');
  assert(!/state\?\.morph\?\.mode===['\"]circleSlide['\"]\|\|\(typeof spiralMorphUsesCircleRebuild/.test(gpu),
    'shared GPU profile morph resource still treats a Spiral carrier policy as Circle Morph');
  assert(!/state\.morph\?\.mode===['\"]circleSlide['\"]\|\|\(typeof spiralMorphUsesCircleRebuild/.test(frame),
    'CPU compatibility path still treats Spiral carrier policy as Circle Morph');
}

async function main(){
  assertSourceContract();
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:300,evalTimeoutMs:22000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const change=(id,v)=>{const e=document.getElementById(id);if(!e)throw new Error('missing '+id);e.value=String(v);e.dispatchEvent(new Event('change',{bubbles:true}));};
      const check=(id,v)=>{const e=document.getElementById(id);if(!e)throw new Error('missing '+id);e.checked=!!v;e.dispatchEvent(new Event('change',{bubbles:true}));};
      const stop=async()=>{if(runtimeState.morph.active){document.getElementById('btnMorph').click();await wait(90);}};
      const setup=(spiral)=>{
        const l=state.layers[0];state.layers.splice(1);state.activeLayerId=l.id;l.visible=true;l.lineVisible=true;
        l.N=7;l.K=2;l.radius=220;l.rotation=0;l.rounding=35;l.roundingMode='standard';
        l.profileMode='segments';l.profileNodes=[{x:0,y:0},{x:.25,y:.22},{x:.58,y:-.18},{x:1,y:0}];
        l.spiralEnabled=!!spiral;l.spiralOrder=spiral?2:0;l.spiralStep=2;l.spiralStepLinked=false;l.spiralClosed=true;l.spiralTangential=true;l.spiralRoundSeams=true;
        invalidateLayerGeometry(l,'v76-profile-carrier-test');syncSidebarInputs();
      };
      const run=async(mode,spiral)=>{
        await stop();setup(spiral);change('morphModeTop',mode);change('morphSpiralMorphType','phaseCircle');
        change('morphInterval',1);check('morphByShape',true);check('morphByVertices',true);check('morphBySteps',true);check('morphByRounding',true);check('morphBySize',true);
        document.getElementById('btnMorph').click();await wait(180);
        const a={p:Number(runtimeState.morph.progress)||0,g:Number(runtimeState.morph.geometryT)||0};
        await wait(260);
        const status=window.__somata76MorphArchitectureStatus?.()||null;
        const frame=runtimeState.morph.frameLayers?.[0]||null;
        const budget=window.__spiroMorphSampleBudgetStatus?.()?.last?.[0]?.budget||0;
        const b={p:Number(runtimeState.morph.progress)||0,g:Number(runtimeState.morph.geometryT)||0};
        return {mode,spiral,selected:state.morph.mode,spiralType:state.morph.spiralMorphType,a,b,active:runtimeState.morph.active===true,gpuPreparing:runtimeState.morph.gpuPhasePreparing===true,gpuWarming:runtimeState.morph.gpuPhaseWarming===true,sourcePaths:runtimeState.morph.sourceGeometry?.[0]?.length||0,targetPaths:runtimeState.morph.targetGeometry?.[0]?.length||0,budget,frame:frame?{N:Number(frame.N),K:Number(frame.K),rounding:Number(frame.rounding),spiral:frame.spiralEnabled===true}:null,status,paint:animationScheduler.stats().paintCount,inFrame:animationScheduler.stats().inFrame};
      };
      const topologySpiral=await run('topology',true);
      const calmSpiral=await run('calm',true);
      const circleSpiral=await run('circleSlide',true);
      const topologyPolygon=await run('topology',false);
      await stop();
      return {topologySpiral,calmSpiral,circleSpiral,topologyPolygon};
    })()`,{timeoutMs:20000,label:'7.6 profile/carrier Morph contract'});

    for(const key of ['topologySpiral','calmSpiral','circleSpiral','topologyPolygon']){
      const r=out[key];
      assert(r.active,`${key}: Morph did not stay active`);
      assert(r.selected===r.mode,`${key}: selected Morph mode was rewritten (${r.selected})`);
      assert(r.b.p>r.a.p+0.04||r.b.p<r.a.p-0.4,`${key}: Morph progress did not advance/wrap ${r.a.p}->${r.b.p}`);
      assert(r.frame&&Object.values(r.frame).filter(v=>typeof v==='number').every(Number.isFinite),`${key}: resolved frame missing/non-finite`);
      assert(r.gpuPreparing===false,`${key}: running timeline is still blocked by gpuPhasePreparing`);
      assert(r.status,`${key}: 7.6 architecture status missing`);
      const p=r.status.layers?.[0];assert(p,`${key}: profile/carrier plan missing`);
      assert(p.morphMode===r.mode,`${key}: carrier plan changed Morph mode ${p.morphMode}`);
      assert(p.carrierKind===(r.spiral?'spiral':'polygon'),`${key}: wrong carrier ${p.carrierKind}`);
      assert(p.circleAlgorithm===(r.mode==='circleSlide'),`${key}: circle algorithm must depend only on global Morph mode`);
      if(r.spiral){
        assert(p.spiralTransport==='phaseCircle',`${key}: Spiral transport missing`);
        if(r.mode!=='circleSlide'){assert(r.sourcePaths>0&&r.targetPaths>0,`${key}: Spiral did not get the shared generic source/target geometry contract`);assert(r.budget>0&&r.budget<=360,`${key}: shared Spiral fallback budget is not capped (${r.budget})`);}
      }else{
        assert(p.spiralTransport==='polygon',`${key}: polygon must not inherit Spiral transport`);
      }
      assert(p.profileSource==='shared-profile',`${key}: profile source is not shared-profile`);
      assert(r.inFrame===false,`${key}: scheduler stuck inFrame`);
    }
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught: '+exc.join(' | '));
    console.log('SOMATA 7.6 PROFILE/CARRIER ARCHITECTURE: PASS',out);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.6 profile/carrier architecture:',e.stack||e.message);process.exit(1)});
