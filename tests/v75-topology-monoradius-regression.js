const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:260,evalTimeoutMs:12000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(async()=>{
      const setV=(id,v,ev='change')=>{const e=document.getElementById(id);if(!e)throw new Error('missing '+id);e.value=String(v);e.dispatchEvent(new Event(ev,{bubbles:true}));};
      const setC=(id,v)=>{const e=document.getElementById(id);if(!e)throw new Error('missing '+id);e.checked=!!v;e.dispatchEvent(new Event('change',{bubbles:true}));};
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const twoRaf=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const configure=(roundingMode,morphMode,spiralType)=>{
        if(runtimeState.morph.active)document.getElementById('btnMorph').click();
        const l=state.layers[0]||createLayer('topology-monoradius-regression');state.layers.splice(1);if(!state.layers.length)state.layers.push(l);state.activeLayerId=l.id;
        l.visible=true;l.lineVisible=true;l.N=12;l.K=1;l.radius=220;l.rounding=30;l.roundingMode=roundingMode;l.profileMode='segments';l.profileNodes=[{x:0,y:0},{x:.28,y:.18},{x:.72,y:-.14},{x:1,y:0}];
        l.spiralEnabled=true;l.spiralClosed=true;l.spiralOrder=1;l.spiralStepLinked=false;l.spiralStep=1;l.spiralTangential=true;l.spiralRoundSeams=true;l.closedLoop=false;
        invalidateLayerGeometry(l,'topology-monoradius-regression');syncSidebarInputs();
        setV('morphMode',morphMode);setV('morphSpiralMorphType',spiralType);setC('morphByVertices',true);setC('morphBySteps',true);setC('morphByRounding',true);
        setV('morphVertexMin',15);setV('morphVertexMax',15);setV('morphStepMin',67);setV('morphStepMax',67);setV('morphRoundingMin',20);setV('morphRoundingMax',80);setV('morphInterval',5,'input');setV('morphInterval',5,'change');
        return l;
      };
      const snapshot=(l)=>{const f=(runtimeState.morph.frameLayers||[]).find(x=>x?.id===l.id)||null;return{progress:Number(runtimeState.morph.progress)||0,geometryT:Number(runtimeState.morph.geometryT)||0,canonical:Number(l.rounding)||0,frame:Number(f?.rounding),frameMode:f?.roundingMode||'',source:Number(runtimeState.morph.sourceVisuals?.[0]?.rounding),target:Number(runtimeState.morph.targetVisuals?.[0]?.rounding),serial:Number(runtimeState.morph.lampCycleSerial)||0,stallCount:Number(runtimeState.morph.timelineStallCompensationCount)||0};};
      const editRounding=async(l)=>{await wait(380);const before=snapshot(l);const e=document.getElementById('paramRounding');e.value='95';e.dispatchEvent(new Event('input',{bubbles:true}));const immediate=snapshot(l);await twoRaf();await wait(20);const after=snapshot(l);return{before,immediate,after};};

      const topoLayer=configure('standard','topology','topology');document.getElementById('btnMorph').click();const topology=await editRounding(topoLayer);
      const topoStatus=window.__spiroSpiralMorphModeStatus?.()||null;const topoPlan=window.__somataSpiralMorphCpuPlan?.(0)||null;
      const stallBefore=Number(runtimeState.morph.timelineStallCompensationCount)||0;const p0=Number(runtimeState.morph.progress)||0;const t0=performance.now();while(performance.now()-t0<220){}await twoRaf();const p1=Number(runtimeState.morph.progress)||0;const stallAfter=Number(runtimeState.morph.timelineStallCompensationCount)||0;
      if(runtimeState.morph.active)document.getElementById('btnMorph').click();

      const monoLayer=configure('monoradius','circleSlide','phaseCircle');document.getElementById('btnMorph').click();const monoradius=await editRounding(monoLayer);if(runtimeState.morph.active)document.getElementById('btnMorph').click();

      const standardLayer=configure('standard','circleSlide','phaseCircle');document.getElementById('btnMorph').click();await wait(380);const stdBefore=snapshot(standardLayer);const stdEl=document.getElementById('paramRounding');stdEl.value='95';stdEl.dispatchEvent(new Event('input',{bubbles:true}));const stdImmediate=snapshot(standardLayer);if(runtimeState.morph.active)document.getElementById('btnMorph').click();

      return{topology,topoStatus,topoPlanMeta:topoPlan?{pathCount:topoPlan.pathCount,cubicCount:topoPlan.cubicCount,metric:topoPlan.interpolationMetric,mergeSplit:topoPlan.topologyMergeSplitCount,finite:Array.from(topoPlan.data||[]).every(Number.isFinite)}:null,topologyStall:{stallBefore,stallAfter,p0,p1,delta:p1-p0},monoradius,standard:{before:stdBefore,immediate:stdImmediate}};
    })()`,{timeoutMs:10500,label:'topology + monoradius regression'});

    const eps=.75;
    assert(out.topology.before.frame!==95,'topology setup already at edited rounding');
    assert(Math.abs(out.topology.immediate.frame-out.topology.before.frame)<eps,`topology frame was hard-snapped by rounding input: ${out.topology.before.frame} -> ${out.topology.immediate.frame}`);
    assert(out.topology.immediate.canonical===95,'topology canonical rounding did not update');
    assert(out.topology.after.source===95&&out.topology.after.frameMode==='standard','topology rebase did not adopt edited rounding atomically');
    assert(out.topoStatus?.type==='topology'&&out.topoStatus?.unrestrictedParameters===true,'topology morph mode contract was lost');
    assert(out.topoPlanMeta?.finite&&out.topoPlanMeta.metric==='cartesian-keypoints'&&out.topoPlanMeta.mergeSplit>0,'topology retained plan is not finite keypoint-Cartesian merge/split');
    assert(out.topologyStall.stallAfter===out.topologyStall.stallBefore,'obsolete topology-only stall compensation was applied');
    assert(out.topologyStall.delta>0.025,`topology morph timeline remained visually frozen after the frame gap: ${out.topologyStall.delta}`);

    assert(out.monoradius.before.frameMode==='monoradius','Mono Radius setup was lost');
    assert(Math.abs(out.monoradius.immediate.frame-out.monoradius.before.frame)<eps,`Mono Radius frame was changed before compensated geometry rebase: ${out.monoradius.before.frame} -> ${out.monoradius.immediate.frame}`);
    assert(out.monoradius.immediate.canonical===95,'Mono Radius canonical rounding did not update');
    assert(out.monoradius.after.source===95&&out.monoradius.after.frameMode==='monoradius','Mono Radius rebase did not preserve mode/edited rounding');

    assert(out.standard.immediate.frame===95,'ordinary circleSlide rounding lost immediate live preview');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('TOPOLOGY + MONORADIUS REGRESSION: PASS',out);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL topology + monoradius regression:',e.stack||e.message);process.exit(1)});
