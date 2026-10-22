const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
const STABLE_SPEEDS=['smooth','linear','accelerate','decelerate','accelerateDecelerate','fastOutSlowIn','anticipate','overshoot','anticipateOvershoot','bounce'];
const EXPECTED_PRESETS={
  'builtin-breathing':{name:'Дыхание',speed:'smooth',shape:false,orbits:false,chaos:false,minBindings:9},
  'builtin-crystal':{name:'Кристалл',speed:'accelerateDecelerate',shape:true,orbits:false,chaos:false,minBindings:8},
  'builtin-orbital':{name:'Орбитальный',speed:'fastOutSlowIn',shape:false,orbits:true,chaos:false,minBindings:10},
  'builtin-liquid-neon':{name:'Жидкий неон',speed:'smooth',shape:false,orbits:false,chaos:false,minBindings:12},
  'builtin-singularity':{name:'Сингулярность',speed:'anticipateOvershoot',shape:true,orbits:true,chaos:true,minBindings:15}
};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:22000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const routing=window.SomataMorphParameterRouting;
      routing.ensureProfiles(state.morph,state.minimalMorph);syncMorphSettingsUI();syncMorphProfileUI();
      document.getElementById('btnMorphSettings')?.click();await sleep(45);syncMorphProfileUI();
      const speed=document.getElementById('morphSpeedType'),toolbar=document.getElementById('morphSpeedToolbar');
      const speedInfo={
        parentToolbar:speed?.closest?.('#morphSpeedToolbar')===toolbar,
        toolbarVisible:toolbar?getComputedStyle(toolbar).display!=='none':false,
        label:toolbar?.textContent?.replace(/\\s+/g,' ').trim()||'',
        values:[...(speed?.options||[])].map(o=>o.value),
        compactContains:!!document.querySelector('#morphCompactProfileControls #morphSpeedType')
      };
      const selectOptions=[...document.querySelectorAll('#morphProfileSelect option')].map(o=>({id:o.value,name:o.textContent}));
      const profiles=routing.ensureProfiles(state.morph,state.minimalMorph).map(p=>({
        id:p.id,name:p.name,system:p.system===true,transient:p.transient===true,builtin:p.builtinPreset===true,
        bindings:(p.bindings||[]).map(b=>b.parameter),booleanBindings:(p.bindings||[]).filter(b=>window.SomataParameterRegistry?.get?.(b.parameter)?.type==='boolean').map(b=>b.parameter),config:structuredClone(p.config||{})
      }));
      const switched={};
      for(const id of ['builtin-breathing','builtin-crystal','builtin-orbital','builtin-liquid-neon','builtin-singularity']){
        routing.selectProfile(state.morph,state.minimalMorph,id);syncMorphSettingsUI();syncMorphProfileUI();await sleep(8);
        const p=routing.activeProfile(state.morph,state.minimalMorph);
        const presetInterval=state.morph.intervalSec;
        const stats0=animationScheduler.stats(),serial0=Number(runtimeState.morph?.phaseSerial)||0;
        state.morph.intervalSec=.5;
        activeStartMorphing();await sleep(170);
        const progress=Number(runtimeState.morph?.progress)||0,serial1=Number(runtimeState.morph?.phaseSerial)||0,stats1=animationScheduler.stats(),running=runtimeState.morph?.active===true&&animationScheduler.has('morph');
        activeStopMorphing(false);await sleep(20);
        switched[id]={
          speed:state.morph.speedType,interval:presetInterval,
          shape:state.morph.options?.byShape===true,orbits:state.morph.monoOrbitTransforms===true,chaos:state.morph.chaosMorphEnabled===true,
          bindings:routing.workingBindings(state.morph,state.minimalMorph,p).map(b=>b.parameter),
          uiValue:document.getElementById('morphSpeedType')?.value||'',
          runtime:{running,progress,serialDelta:serial1-serial0,frameDelta:stats1.frameCount-stats0.frameCount,inFrame:stats1.inFrame}
        };
      }
      routing.selectProfile(state.morph,state.minimalMorph,'standard');syncMorphSettingsUI();syncMorphProfileUI();
      const standard=routing.activeProfile(state.morph,state.minimalMorph);
      return{speedInfo,selectOptions,profiles,switched,active:standard?.id,standardBindings:routing.workingBindings(state.morph,state.minimalMorph,standard).map(b=>b.parameter)};
    })()`,{timeoutMs:22000,label:'7.10.6 Blue speed + built-in presets'});
    assert(r.speedInfo.parentToolbar,'morphSpeedType is not in the dedicated top speed row');
    assert(r.speedInfo.toolbarVisible,'top speed row is hidden');
    assert(/Тип скорости/.test(r.speedInfo.label),'top speed row lost the stable label');
    assert(JSON.stringify(r.speedInfo.values)===JSON.stringify(STABLE_SPEEDS),'speed menu options differ from stable 7.9: '+JSON.stringify(r.speedInfo.values));
    assert(!r.speedInfo.compactContains,'speed menu is still duplicated in compact controls');
    const ids=r.profiles.map(p=>p.id);assert(new Set(ids).size===ids.length,'duplicate Morph profile IDs');
    assert(r.active==='standard','Standard is not restored/active by default');
    const names=new Map(r.selectOptions.map(x=>[x.id,x.name]));
    for(const [id,exp] of Object.entries(EXPECTED_PRESETS)){
      const p=r.profiles.find(x=>x.id===id);assert(p,'missing built-in profile '+id);
      assert(p.name===exp.name,'wrong name for '+id+': '+p.name);
      assert(p.system&&p.builtin&&!p.transient,id+' is not a persistent built-in system profile');
      assert(names.get(id)===exp.name,id+' is missing from the profile selector');
      assert(new Set(p.bindings).size===p.bindings.length,id+' contains duplicate bindings');
      assert(p.booleanBindings.length===0,id+' contains a boolean binding: '+p.booleanBindings.join(','));
      const sw=r.switched[id];assert(sw.speed===exp.speed&&sw.uiValue===exp.speed,id+' speed config/UI did not apply');
      assert(sw.shape===exp.shape&&sw.orbits===exp.orbits&&sw.chaos===exp.chaos,id+' special flags differ');
      assert(sw.bindings.length>=exp.minBindings,id+' has too few bindings: '+sw.bindings.length);
      assert(sw.runtime.running&&sw.runtime.progress>0&&sw.runtime.frameDelta>0&&!sw.runtime.inFrame,id+' did not run as a live Blue Morph: '+JSON.stringify(sw.runtime));
    }
    const expectedStandard=['geometry.N','geometry.K','layer.radius','layer.rotation','layer.strokeWidth','layer.fillOpacity','layer.strokeColor','layer.fillColor'];
    assert(JSON.stringify(r.standardBindings)===JSON.stringify(expectedStandard),'Standard bindings changed while adding presets: '+JSON.stringify(r.standardBindings));
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('7.10.6 BLUE SPEED + BUILT-IN PRESETS REGRESSION: PASS',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.10.6 Blue speed + built-in presets:',e.stack||e.message);process.exit(1)});
