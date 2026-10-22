const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
const EXPECTED_BINDINGS=['geometry.N','geometry.K','layer.radius','layer.rotation','layer.strokeWidth','layer.fillOpacity','layer.strokeColor','layer.fillColor'];
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:18000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const routing=window.SomataMorphParameterRouting;
      routing.ensureProfiles(state.morph,state.minimalMorph);syncMorphSettingsUI();syncMorphProfileUI();
      document.getElementById('btnMorphSettings')?.click();await sleep(35);renderMorphProfileBindings();renderMorphRoutingGroups();
      const snapshot=()=>{const p=routing.activeProfile(state.morph,state.minimalMorph);return {
        bindings:routing.workingBindings(state.morph,state.minimalMorph,p).map(b=>b.parameter),
        specials:[...document.querySelectorAll('#morphProfileBindings [data-morph-special]')].map(x=>x.dataset.morphSpecial),
        routed:[...document.querySelectorAll('#morphProfileBindings [data-morph-parameter]')].map(x=>x.dataset.morphParameter),
        options:structuredClone(state.morph.options),monoOrbitTransforms:state.morph.monoOrbitTransforms===true,chaosMorphEnabled:state.morph.chaosMorphEnabled===true,
        shape:{family:state.morph.shapeOptions?.family,profileGroups:[...(state.morph.shapeOptions?.profileGroups||[])],profileGroup:state.morph.shapeOptions?.profileGroup,standardOnly:state.morph.shapeOptions?.standardOnly,splinePoints:state.morph.splinePoints},
        ranges:{N:[state.morph.vertexMin,state.morph.vertexMax],K:[state.morph.stepMin,state.morph.stepMax],stroke:[state.morph.strokeWidthMin,state.morph.strokeWidthMax],radius:[state.morph.radiusMin,state.morph.radiusMax],rotation:[state.morph.rotationMinPercent,state.morph.rotationMaxPercent],fillOpacity:[state.morph.fillOpacityMin,state.morph.fillOpacityMax]},
        rotationMultiplier:state.morph.rotationMultiplier,
        shapeRowText:document.querySelector('#morphProfileBindings [data-morph-special="shape"]')?.textContent?.replace(/\\s+/g,' ').trim()||'',
        oldShapeSidebar:!!document.querySelector('#settingsSidebar #morphByShape')
      }};
      const initial=snapshot();
      state.morph.options.byOpacity=true;state.morph.options.byRounding=true;state.morph.options.bySpiralLayers=true;state.morph.shapeOptions.profileGroups=['closed'];state.morph.shapeOptions.profileGroup='all';state.morph.shapeOptions.standardOnly=false;
      resetMorphSettingsToFactory();await sleep(25);renderMorphProfileBindings();const afterReset=snapshot();
      return{initial,afterReset};
    })()`,{timeoutMs:18000,label:'7.10.5 Standard stable-7.9 defaults parity'});
    for(const phase of ['initial','afterReset']){
      const x=r[phase];
      assert(JSON.stringify(x.bindings)===JSON.stringify(EXPECTED_BINDINGS),phase+' Standard bindings differ from stable 7.9: '+JSON.stringify(x.bindings));
      assert(x.specials.includes('shape')&&x.specials.includes('orbits'),phase+' stable enabled Shape/Orbits are not materialized');
      assert(!x.specials.includes('chaos')&&!x.specials.includes('spiralLayers'),phase+' stable disabled Chaos/Spiral layers were added');
      assert(!x.routed.includes('layer.opacity')&&!x.routed.includes('layer.rounding'),phase+' stable disabled Opacity/Rounding were added');
      assert(x.options.byShape&&x.options.byVertices&&x.options.bySteps&&x.options.byStrokeWidth&&x.options.bySize&&x.options.byColor&&x.options.byFillColor&&x.options.byRotation,phase+' one or more stable-enabled Blue flags are off');
      assert(!x.options.byOpacity&&!x.options.byRounding&&!x.options.bySpiralLayers&&!x.options.bySpiralOrder,phase+' one or more stable-disabled Blue flags are on');
      assert(x.monoOrbitTransforms&&!x.chaosMorphEnabled,phase+' Orbits/Chaos default differs from stable 7.9');
      assert(x.shape.family==='mix'&&JSON.stringify(x.shape.profileGroups)===JSON.stringify(['standard'])&&x.shape.profileGroup==='standard'&&x.shape.standardOnly===true&&x.shape.splinePoints===12,phase+' Shape defaults differ from stable 7.9: '+JSON.stringify(x.shape));
      assert(JSON.stringify(x.ranges)==='{"N":[4,19],"K":[0,100],"stroke":[0.8,3.2],"radius":[20,500],"rotation":[0,50],"fillOpacity":[10,10]}',phase+' active ranges differ from stable 7.9: '+JSON.stringify(x.ranges));
      assert(Number(x.rotationMultiplier)===1,phase+' intentional 7.10 neutral rotation X is not 1×');
      assert(/Форма/.test(x.shapeRowText)&&/Семейство формы/.test(x.shapeRowText)&&!/Точки сплайна/.test(x.shapeRowText)&&/Наборы профилей/.test(x.shapeRowText),phase+' Shape compound row does not match the compact 7.10.9 UI: '+x.shapeRowText);
      assert(!x.oldShapeSidebar,phase+' Shape Morph is duplicated in the left sidebar');
    }
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('7.10.5 STANDARD / STABLE 7.9 DEFAULT PARITY REGRESSION: PASS',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.10.5 Standard / stable 7.9 default parity:',e.stack||e.message);process.exit(1)});
