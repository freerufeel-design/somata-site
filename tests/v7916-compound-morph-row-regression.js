const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:18000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      document.getElementById('btnMorphSettings')?.click();await new Promise(r=>setTimeout(r,35));syncMorphProfileUI();
      setMorphParameterBinding('spiral.step',true);
      const boolStepAdded=setMorphParameterBinding('spiral.stepLinked',true);
      const boolFillAdded=setMorphParameterBinding('spiral.fillEnabled',true);
      setMorphParameterBinding('spiral.fillType',true);
      setMorphParameterBinding('layer.strokeColor',true);setMorphParameterBinding('layer.fillColor',true);setMorphParameterBinding('layer.radius',true);await new Promise(r=>setTimeout(r,25));renderMorphProfileBindings();
      const step=document.querySelector('#morphProfileBindings [data-morph-parameter="spiral.step"]');
      const stepLinked=document.querySelector('#morphProfileBindings [data-morph-parameter="spiral.stepLinked"]');
      const stepChild=step?.querySelector('[data-child-parameter="spiral.stepLinked"] input');
      const fill=document.querySelector('#morphProfileBindings [data-morph-parameter="spiral.fillEnabled"]');
      const fillType=document.querySelector('#morphProfileBindings [data-morph-parameter="spiral.fillType"]');
      const fillSelect=fillType?.querySelector('.morph-route-inline-select select');
      const line=document.querySelector('#morphProfileBindings [data-morph-parameter="layer.strokeColor"]');
      const cycle=[...line?.querySelectorAll('.morph-route-inline-check')||[]].find(x=>/Менять палитру каждый цикл/.test(x.textContent||''))?.querySelector('input');
      const radius=document.querySelector('#morphProfileBindings [data-morph-parameter="layer.radius"]');
      const normalize=[...radius?.querySelectorAll('.morph-route-inline-check')||[]].find(x=>/Сохранять пропорции размеров слоёв/.test(x.textContent||''))?.querySelector('input');
      const fillColor=document.querySelector('#morphProfileBindings [data-morph-parameter="layer.fillColor"]');
      const fillRangeNums=fillColor?.querySelectorAll('.morph-route-inline-range input[type=number]').length||0;
      const fillHarmony=fillColor?.querySelector('.morph-route-harmony-select select');
      renderMorphParameterPicker();
      const pickerIds=[...document.querySelectorAll('#morphParameterOptions .audio-param-option')].map(b=>b.textContent.trim());
      const booleanBindings=window.SomataMorphParameterRouting.workingBindings(state.morph,state.minimalMorph).filter(b=>window.SomataParameterRegistry.get(b.parameter)?.type==='boolean').map(b=>b.parameter);
      return{step:!!step,stepStandalone:!!stepLinked,stepChild:!!stepChild,boolStepAdded,boolFillAdded,fill:!!fill,fillType:!!fillType,fillSelect:!!fillSelect,lineCycle:!!cycle,radiusNormalize:!!normalize,fillRangeNums,fillHarmony:!!fillHarmony,pickerIds,booleanBindings,
        stepState:window.SomataMorphParameterRoutingUI.state('spiral.stepLinked'),fillState:window.SomataMorphParameterRoutingUI.state('spiral.fillEnabled')};
    })()`,{timeoutMs:18000,label:'7.10.5 compound Morph rows / no booleans'});
    assert(r.step&&!r.stepChild&&!r.stepStandalone,'boolean spiral step-link still appears as a Morph parameter/subsetting');
    assert(r.boolStepAdded===false&&r.boolFillAdded===false,'boolean setMorphParameterBinding was not rejected');
    assert(!r.fill&&r.fillType&&r.fillSelect,'boolean Spiral Fill row should be gone while enum Fill Type remains editable');
    assert(r.stepState?.supported===false&&r.fillState?.supported===false,'boolean routing state is still supported');
    assert(r.booleanBindings.length===0,'boolean bindings survived in Standard profile: '+r.booleanBindings.join(','));
    assert(!r.pickerIds.some(x=>/Паутина$|Лампочки$|Частицы$|Проблеск \/ Молния$|Приравнять к шагу K|Заливка спирали/.test(x)),'boolean-only parameters still appear in Morph picker');
    assert(r.lineCycle,'line color row lost palette-cycle subsetting');
    assert(r.radiusNormalize,'size row lost proportional-size subsetting');
    assert(r.fillRangeNums===2&&r.fillHarmony,'fill color row lost filled-layer range + harmony');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('7.10.5 COMPOUND MORPH / NO BOOLEAN PARAMS REGRESSION: PASS',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.10.5 compound Morph / no booleans:',e.stack||e.message);process.exit(1)});
