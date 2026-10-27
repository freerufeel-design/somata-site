const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=require('node:assert/strict');

(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:12000});
  try{
    const actual=await h.evaluate(`(()=>{
      const expected=[
        ['torn','Рваный'],
        ['continuous','Неразрывный фикс N/K'],
        ['phase','Неразрывный фазовый фикс N'],
        ['minimalTurn','Неразрывный по витку фикс K'],
        ['phaseCircle','Неразрывный фазово-окружностный']
      ];
      const ids=['morphSpiralMorphType','testMorphSpiralType','testMorphSpiralSlide'];
      const options=Object.fromEntries(ids.map(id=>[id,[...document.getElementById(id).options].map(o=>[o.value,o.textContent.trim()])]));
      const blueLabel=document.querySelector('.morph-spiral-type span')?.textContent.trim();
      const layer=createLayer('ui-9213-spiral');layer.spiralEnabled=true;
      state.layers=[layer];state.activeLayerId=layer.id;
      const selections=[];
      for(const [type] of expected){
        state.morph.spiralMorphType=type;
        layer.testMorph={enabled:true,spiralType:type,mode:'circleSlide',slide:'sector',duration:1};
        SomataTestMorph.syncUI();
        const anim=document.getElementById('testMorphSpiralSlide');
        const label=document.getElementById('testMorphSlideLabel').textContent.trim();
        selections.push({type,blueValue:getSpiralMorphType(),animationValue:anim.value,
          animVisible:!anim.classList.contains('hidden'),label,blueOption:options.morphSpiralMorphType.find(x=>x[0]===type)?.[1],
          animOption:anim.selectedOptions[0]?.textContent.trim()});
      }
      return{expected,options,selections,blueLabel};
    })()`,{timeoutMs:12000,label:'9.2.13 blue and animation spiral slider label sync'});
    for(const values of Object.values(actual.options))assert.deepEqual(values,actual.expected,'menu label catalog mismatch');
    assert.equal(actual.blueLabel,'Слайдинг спирали');
    for(const mode of actual.selections){
      assert.equal(mode.type,mode.blueValue,'blue mode changed on sync');
      assert.equal(mode.type,mode.animationValue,'animation selected wrong mode');
      assert.equal(mode.blueOption,mode.animOption,'selected mode names differ');
      assert.equal(mode.label,'Слайдинг спирали');
      assert.equal(mode.animVisible,true);
    }
    assert.deepEqual(uncaughtExceptions(h.events),[]);
    console.log('PASS 9.2.13 spiral blue/animation names, order and selection',actual.expected);
  }finally{await h.close()}
})().catch(e=>{console.error('FAIL 9.2.13 spiral labels',e.stack||e);process.exitCode=1;});
