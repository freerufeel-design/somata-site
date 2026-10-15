const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg);};

async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:12000,loadDelayMs:350});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const report=await h.evaluate(`(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const eq=(a,b)=>masterValuesEqual(a,b);
      const pathValue=(root,path)=>masterPathValue(root,path);
      const allSnapshots=()=>state.layers.map(layer=>masterLayerSnapshot(layer));
      const ids=()=>state.layers.map(layer=>({id:layer.id,name:layer.name,visible:layer.visible}));

      const stopSchedulers=()=>{
        for(const name of ['morph','morph-owner','morph-arm','morph-cycle-boundary','minimalMorph','project-morph','sweep','particles','gpu-path-fx','motion','tunnel']){
          try{animationScheduler.remove(name);}catch(_){}
        }
        if(runtimeState?.morph){
          runtimeState.morph.active=false;runtimeState.morph.paused=false;runtimeState.morph.exactStartPending=false;
          runtimeState.morph.frameLayers=[];runtimeState.morph.lightLayers=[];runtimeState.morph.renderSourceLayers=[];runtimeState.morph.renderTargetLayers=[];
          runtimeState.morph.progress=0;runtimeState.morph.geometryT=0;
        }
      };

      const makeLayer=(i)=>{
        const l=createLayer('master-reg-'+i);ensureLayerEffectState(l);
        l.N=[13,17,19][i];l.K=[3,4,5][i];l.customSuborbits=1;
        l.radius=[171,223,287][i];l.radiusMultiplier=[1,1.1,.9][i];
        l.rotation=[11,73,149][i];l.rounding=[7,19,31][i];
        l.strokeWidth=[2,3,4][i];l.opacity=[91,73,57][i];
        l.spiralEnabled=true;l.closedLoop=false;l.spiralClosed=true;
        l.spiralOrder=[1.25,2.5,3.75][i];
        l.spiralStepLinked=false;l.spiralStep=[2.25,4.5,6.75][i];
        l.spiralTangential=[false,true,false][i];
        l.spiralRoundSeams=[true,false,true][i];
        l.geometryCircles={enabled:true,circumscribed:[false,true,false][i],inscribed:[true,false,true][i],median:[false,true,true][i],keyPoints:[true,false,false][i]};
        l.web.width=[.7,1.4,2.2][i];l.web.spacing=[7,15,27][i];
        l.profileMode='spline';l.profileNodes=[{x:0,y:0},{x:.5,y:[-.2,-.5,-.8][i]},{x:1,y:0}];
        return l;
      };

      const reset=async()=>{
        stopSchedulers();state.masterLayerEdit=false;state.tunnel.active=false;
        const layers=[makeLayer(0),makeLayer(1),makeLayer(2)];
        state.layers.splice(0,state.layers.length,...layers);state.activeLayerId=layers[0].id;
        try{setSingleLayerSelection(layers[0]);}catch(_){}
        try{refreshLayerLookup(true);}catch(_){}
        syncSidebarInputs();syncSidebarToolStates();updateLayerListUI();requestMainCanvasRender();
        await sleep(35);
        return layers[0];
      };

      const runCase=async(name,prepare,act)=>{
        const active=await reset();
        if(prepare){await prepare(active);syncSidebarInputs();await sleep(20);}
        const beforeEnable=allSnapshots(),identityBefore=ids();
        document.getElementById('btnMasterLayer').click();await sleep(45);
        const afterEnable=allSnapshots();
        const enableDiffs=afterEnable.map((s,i)=>collectMasterChangedPaths(beforeEnable[i],s));
        const masterOn=state.masterLayerEdit===true;
        const before=allSnapshots();
        await act(active);await sleep(85);
        const after=allSnapshots(),identityAfter=ids();
        const sourceChanged=collectMasterChangedPaths(before[0],after[0]);
        const rows=[];
        for(let i=1;i<after.length;i++){
          const targetChanged=collectMasterChangedPaths(before[i],after[i]);
          const extra=targetChanged.filter(path=>!sourceChanged.includes(path));
          const missing=sourceChanged.filter(path=>!eq(pathValue(after[i],path),pathValue(after[0],path)));
          rows.push({index:i,targetChanged,extra,missing});
        }
        const identityPreserved=identityAfter.every((v,i)=>v.id===identityBefore[i].id&&v.name===identityBefore[i].name&&v.visible===identityBefore[i].visible);
        return{name,masterOn,enableDiffs,sourceChanged,rows,identityPreserved,source:after[0],targets:after.slice(1)};
      };

      const cases=[];
      cases.push(await runCase('radius scalar',null,async()=>{
        const el=document.getElementById('paramRadius');el.value='241';el.dispatchEvent(new Event('input',{bubbles:true}));
      }));
      cases.push(await runCase('N with only real dependent changes',null,async()=>{
        const el=document.getElementById('paramN');el.value='21';el.dispatchEvent(new Event('input',{bubbles:true}));
      }));
      cases.push(await runCase('K with only real dependent changes',null,async()=>{
        const el=document.getElementById('paramK');el.value='5';el.dispatchEvent(new Event('input',{bubbles:true}));
      }));
      cases.push(await runCase('spiral closed -> open must not normalize order/profile',null,async()=>{
        document.querySelector('[data-contour-mode="spiral-open"]').click();
      }));
      cases.push(await runCase('unlink spiral step must not copy the step value',async(active)=>{
        active.spiralStepLinked=true;active.spiralStep=active.K;
        state.layers[1].spiralStepLinked=true;state.layers[1].spiralStep=8.25;
        state.layers[2].spiralStepLinked=true;state.layers[2].spiralStep=10.5;
      },async()=>{
        const el=document.getElementById('paramSpiralStepLinked');el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));
      }));
      cases.push(await runCase('spiral tangential toggle is one-path broadcast',null,async()=>{
        const el=document.getElementById('paramSpiralTangential');el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));
      }));
      cases.push(await runCase('spiral seam toggle is one-path broadcast',null,async()=>{
        const el=document.getElementById('paramSpiralRoundSeams');el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));
      }));
      cases.push(await runCase('geometry circle submode must not replace sibling modes',null,async()=>{
        const el=document.getElementById('circleModeCircumscribed');el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));
      }));
      cases.push(await runCase('nested Web width must preserve Web spacing',null,async()=>{
        const el=document.getElementById('webWidth');el.value='3.1';el.dispatchEvent(new Event('input',{bubbles:true}));
      }));
      cases.push(await runCase('line join button must broadcast exactly changed path',null,async()=>{
        const el=[...document.querySelectorAll('.line-join-btn')].find(x=>x.dataset.join&&x.dataset.join!==state.layers[0].lineJoinType);
        if(!el)throw new Error('no alternate line join button');el.click();
      }));

      return{cases,inFrame:animationScheduler.stats().inFrame};
    })()`,{timeoutMs:12000,label:'Master write-broadcast regression'});

    const failures=[];
    for(const c of report.cases){
      if(!c.masterOn)failures.push(`${c.name}: Master did not stay enabled`);
      const enableChanged=c.enableDiffs.some(paths=>paths.length>0);
      if(enableChanged)failures.push(`${c.name}: enabling Master normalized state: ${JSON.stringify(c.enableDiffs)}`);
      if(!c.sourceChanged.length)failures.push(`${c.name}: real UI action did not change active-layer snapshot`);
      if(!c.identityPreserved)failures.push(`${c.name}: id/name/visibility changed`);
      for(const row of c.rows){
        if(row.missing.length)failures.push(`${c.name}: target ${row.index} missed source paths ${row.missing.join(', ')}`);
        if(row.extra.length)failures.push(`${c.name}: target ${row.index} changed unrelated paths ${row.extra.join(', ')}`);
      }
      console.log(`MASTER CASE ${c.name}:`,{sourceChanged:c.sourceChanged,rows:c.rows});
    }
    const uncaught=uncaughtExceptions(h.events).slice(baseline);
    if(uncaught.length)failures.push(`uncaught browser exception(s): ${uncaught.join(' | ')}`);
    if(report.inFrame)failures.push('scheduler left inFrame');
    if(failures.length)throw new Error(`MASTER WRITE-BROADCAST REGRESSION FAIL:\n- ${failures.join('\n- ')}`);
    console.log(`MASTER WRITE-BROADCAST REGRESSION: PASS — ${report.cases.length} real UI actions preserve unrelated per-layer state`);
  } finally { await h.close(); }
}
main().catch(err=>{console.error(err.stack||err);process.exit(1);});
