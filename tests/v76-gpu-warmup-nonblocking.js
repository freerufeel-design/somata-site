const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};

function assertSourceContract(){
  const src=fs.readFileSync(path.join(__dirname,'..','js','app','ui-project-runtime.js'),'utf8');
  assert(src.includes('runtimeState.morph.gpuPhaseWarming=true'),'7.6 GPU warm state missing');
  assert(!/gpuPhaseWarming===true\s*\|\|\s*rt\.gpuPhasePreparing===true/.test(src),'gpu warming still gates animateMorph');
  const animate=src.slice(src.indexOf('function animateMorph('),src.indexOf('function animateMorph(')+4200);
  assert(!/gpuPhaseWarming/.test(animate),'animateMorph must not block on GPU warmup');
  const successBlocks=[...src.matchAll(/gpuPhaseWarming=false;/g)].map(m=>src.slice(Math.max(0,m.index-420),m.index+500));
  assert(successBlocks.length>0,'GPU warm completion path missing');
  for(const b of successBlocks){
    if(/gpuSpecializedSpiralReady=true/.test(b)){
      assert(!/progress\s*=\s*0/.test(b),'GPU warm completion resets Morph progress');
      assert(!/geometryT\s*=\s*0/.test(b),'GPU warm completion resets geometryT');
      assert(!/cycleStart\s*=\s*performance\.now\(\)/.test(b),'GPU warm completion restarts Morph timeline');
    }
  }
}

async function main(){
  assertSourceContract();
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:300,evalTimeoutMs:18000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const change=(id,v)=>{const e=document.getElementById(id);if(!e)throw new Error('missing '+id);e.value=String(v);e.dispatchEvent(new Event('change',{bubbles:true}));};
      const check=(id,v)=>{const e=document.getElementById(id);if(!e)throw new Error('missing '+id);e.checked=!!v;e.dispatchEvent(new Event('change',{bubbles:true}));};
      const l=state.layers[0];state.layers.splice(1);state.activeLayerId=l.id;l.visible=true;l.lineVisible=true;l.N=9;l.K=4;l.radius=220;l.rounding=45;l.profileMode='segments';l.profileNodes=[{x:0,y:0},{x:.22,y:.24},{x:.61,y:-.19},{x:1,y:0}];l.spiralEnabled=true;l.spiralOrder=2;l.spiralStep=3;l.spiralStepLinked=false;l.spiralClosed=true;
      invalidateLayerGeometry(l,'v76-warmup-nonblocking');syncSidebarInputs();
      change('morphModeTop','topology');change('morphSpiralMorphType','phaseCircle');change('morphInterval',1);check('morphByVertices',true);check('morphBySteps',true);check('morphByShape',true);check('morphByRounding',true);
      document.getElementById('btnMorph').click();await wait(180);
      const before={p:Number(runtimeState.morph.progress)||0,g:Number(runtimeState.morph.geometryT)||0,paint:animationScheduler.stats().paintCount};
      runtimeState.morph.gpuPhaseWarming=true;runtimeState.morph.gpuPhasePreparing=false;
      await wait(280);
      const during={p:Number(runtimeState.morph.progress)||0,g:Number(runtimeState.morph.geometryT)||0,paint:animationScheduler.stats().paintCount,active:runtimeState.morph.active===true,hasMorph:animationScheduler.has('morph'),inFrame:animationScheduler.stats().inFrame};
      runtimeState.morph.gpuPhaseWarming=false;
      await wait(120);
      const after={p:Number(runtimeState.morph.progress)||0,g:Number(runtimeState.morph.geometryT)||0,paint:animationScheduler.stats().paintCount};
      const status=window.__somata76MorphArchitectureStatus?.()||null;
      if(runtimeState.morph.active)document.getElementById('btnMorph').click();
      return {before,during,after,status};
    })()`,{timeoutMs:15000,label:'7.6 nonblocking GPU warmup'});
    assert(out.during.active,'Morph stopped while GPU was warming');
    assert(out.during.hasMorph,'scheduler lost Morph ownership while GPU was warming');
    assert(out.during.p>out.before.p+0.08||out.during.p<out.before.p-0.4,`progress blocked by gpuPhaseWarming ${out.before.p}->${out.during.p}`);
    assert(out.during.g>out.before.g+0.08||out.during.g<out.before.g-0.4,`geometry timeline blocked by gpuPhaseWarming ${out.before.g}->${out.during.g}`);
    assert(out.during.paint>out.before.paint,'no paints while GPU warming');
    assert(out.during.inFrame===false,'scheduler stuck during GPU warming');
    assert(out.status?.layers?.[0]?.profileSource==='shared-profile','shared profile/carrier contract missing');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught: '+exc.join(' | '));
    console.log('SOMATA 7.6 NONBLOCKING GPU WARMUP: PASS',out);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.6 nonblocking GPU warmup:',e.stack||e.message);process.exit(1)});
