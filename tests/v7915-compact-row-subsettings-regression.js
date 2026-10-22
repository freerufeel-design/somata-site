const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:18000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      const R=window.SomataParameterRegistry,blue=window.SomataMorphParameterRouting;
      document.getElementById('btnMorphSettings')?.click();await new Promise(r=>setTimeout(r,35));syncMorphProfileUI();
      const profileSelect=document.getElementById('morphProfileSelect');
      const toolbarFlags=[...document.querySelectorAll('#morphSettingsPanel .morph-profile-toolbar-flags input')].map(x=>x.id);
      const commonIds=[...document.querySelectorAll('#morphCompactProfileControls select,#morphCompactProfileControls input')].map(x=>x.id);
      const nRow=document.querySelector('#morphProfileBindings [data-morph-parameter="geometry.N"]');
      const nMult=nRow?.querySelector('.morph-route-multiplier input');
      const nRemove=nRow?.querySelector('.morph-binding-remove');
      const nBefore={text:nRow?.textContent||'',picker:nRow?.querySelector('.audio-param-picker-button')?.textContent||'',mode:!!nRow?.querySelector('.morph-route-mode'),mult:nMult?.value,lastField:nMult?([...(nRow.querySelectorAll('input,select'))].at(-1)===nMult):false,removeAfter:nMult&&nRemove?(nMult.compareDocumentPosition(nRemove)&Node.DOCUMENT_POSITION_FOLLOWING)!==0:false};
      if(nMult){nMult.value='3';nMult.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,10));}
      const nAfter=state.morph.vertexMultiplier;

      const colorRow=document.querySelector('#morphProfileBindings [data-morph-parameter="layer.strokeColor"]');
      const palette=colorRow?.querySelector('.morph-route-palette-select select');const oldPalette=state.morph.lineColorPalette;let paletteChanged=false;
      if(palette&&palette.options.length>1){palette.value=palette.options[1].value;palette.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,8));paletteChanged=state.morph.lineColorPalette===palette.value&&state.morph.lineColorPalette!==oldPalette;}

      const spiralBtn=[...document.querySelectorAll('#morphRoutingGroups .audio-route-group-btn')].find(b=>b.textContent.includes('Спирали'));spiralBtn?.click();await new Promise(r=>setTimeout(r,8));
      const spOpt=[...document.querySelectorAll('.audio-route-group-menu:not(.hidden) .audio-param-option')].find(b=>b.textContent.includes('Спиральные слои'));spOpt?.click();await new Promise(r=>setTimeout(r,15));
      const spRow=document.querySelector('#morphProfileBindings [data-morph-special="spiralLayers"]');
      const spNums=[...spRow?.querySelectorAll('input[type=number]')||[]];const spChecks=[...spRow?.querySelectorAll('input[type=checkbox]')||[]];
      if(spNums[2]){spNums[2].value='-3';spNums[2].dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,8));}
      if(spChecks[1]){spChecks[1].checked=true;spChecks[1].dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,8));}
      const spiral={row:!!spRow,nums:spNums.length,checks:spChecks.length,orderMin:state.morph.spiralOrderMin,linked:state.morph.spiralOrderLinked,spiralTypeCommon:document.getElementById('morphCompactProfileControls')?.contains(document.getElementById('morphSpiralMorphType'))===true,fixedVisible:!!document.querySelector('.morph-spiral-fixed-settings:not(.hidden)')&&getComputedStyle(document.querySelector('.morph-spiral-fixed-settings')).display!=='none'};

      // 7.10.3: generic routed bindings must not invent an extra Morph multiplier.
      setMorphParameterBinding('web.oscillationStrength',true);await new Promise(r=>setTimeout(r,10));
      const webRow=document.querySelector('#morphProfileBindings [data-morph-parameter="web.oscillationStrength"]'),webMult=webRow?.querySelector('.morph-route-binding-multiplier input'),binding=blue.workingBindings(state.morph,state.minimalMorph).find(b=>b.parameter==='web.oscillationStrength');
      if(binding){binding.min=30;binding.max=30;binding.multiplier=.5;binding.enabled=true;}
      const prev={active:runtimeState.morph.active,paused:runtimeState.morph.paused,orange:runtimeState.morph.pausedByOrangeProject,green:runtimeState.morph.pausedByGreenProject,t:runtimeState.morph.geometryT,serial:runtimeState.morph.phaseSerial};
      runtimeState.morph.active=true;runtimeState.morph.paused=false;runtimeState.morph.pausedByOrangeProject=false;runtimeState.morph.pausedByGreenProject=false;runtimeState.morph.geometryT=1;runtimeState.morph.phaseSerial=987654;blue.resetRuntime(runtimeState.morph);
      const fake={sourceLayer:{id:'mult-test'},layer:{},effectLayer:{web:{oscillationStrength:10}}};blue.applyFrame(fake);const multipliedValue=fake.effectLayer.web.oscillationStrength;
      Object.assign(runtimeState.morph,{active:prev.active,paused:prev.paused,pausedByOrangeProject:prev.orange,pausedByGreenProject:prev.green,geometryT:prev.t,phaseSerial:prev.serial});blue.resetRuntime(runtimeState.morph);
      const web={hasMultiplier:!!webMult,multiplier:binding?.multiplier,value:multipliedValue};

      const enumDef=R.get('spiral.fillType');setMorphParameterBinding(enumDef.id,true);await new Promise(r=>setTimeout(r,8));const enumRow=document.querySelector('#morphProfileBindings [data-morph-parameter="spiral.fillType"]');
      return{profileOptions:[...profileSelect.options].map(o=>o.textContent),profileWidth:profileSelect.getBoundingClientRect().width,toolbarFlags,commonIds,speedTop:document.getElementById('morphSpeedType')?.closest?.('#morphSpeedToolbar')===document.getElementById('morphSpeedToolbar'),nBefore,nAfter,paletteExists:!!palette,paletteChanged,spiral,web,enumSelect:!!enumRow?.querySelector('.morph-route-inline-select select')};
    })()`,{timeoutMs:18000,label:'7.9.15 compact Morph row subsettings'});
    assert(r.profileOptions[0]?.startsWith('Основной')&&!r.profileOptions.some(x=>/Standard/i.test(x)),'default Blue profile still shows Standard');
    assert(r.profileWidth<280,'profile selector is still excessively wide');
    assert(r.toolbarFlags.includes('morphDefaultActive')&&r.toolbarFlags.includes('morphDiversity'),'default/diversity are not in the profile toolbar');
    for(const id of ['morphSlideType','morphMode','morphSpiralMorphType','morphCircleProfileOverflow'])assert(r.commonIds.includes(id),'common Morph row missing '+id);assert(r.speedTop&&!r.commonIds.includes('morphSpeedType'),'stable-7.9 speed selector is not in its dedicated top row');
    assert(!r.commonIds.includes('morphDefaultActive')&&!r.commonIds.includes('morphDiversity'),'profile flags still occupy the common Morph settings row');
    assert(!/Standard/i.test(r.nBefore.text)&&!r.nBefore.mode&&['Вершины · N','Количество вершин N'].includes(r.nBefore.picker),'legacy Standard label/group-wide picker still wastes row width');
    assert(r.nBefore.mult==='1'&&r.nBefore.lastField&&r.nBefore.removeAfter&&Number(r.nAfter)===3,'N multiplier is not the rightmost functional field');
    assert(r.paletteExists&&r.paletteChanged,'line-color row has no functional inline palette selector');
    assert(r.spiral.row&&r.spiral.nums>=4&&r.spiral.checks>=3&&Number(r.spiral.orderMin)===-3&&r.spiral.linked===true,'Spiral Layers subsettings are not inline/functional');
    assert(r.spiral.spiralTypeCommon&&!r.spiral.fixedVisible,'spiral morph type is not in common settings or old popup card is still visible');
    assert(!r.web.hasMultiplier&&Math.abs(Number(r.web.multiplier)-.5)<1e-9&&Math.abs(Number(r.web.value)-30)<1e-9,'removed generic Morph multiplier is still rendered or still affects routed output');
    assert(r.enumSelect,'enum Morph row does not expose its selector inline');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('7.9.15 COMPACT MORPH ROW SUBSETTINGS REGRESSION: PASS',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.9.15 compact Morph row subsettings:',e.stack||e.message);process.exit(1)});
