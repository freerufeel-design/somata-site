const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:18000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      document.getElementById('btnMorphSettings')?.click();await sleep(40);syncMorphSettingsUI();syncMorphProfileUI();
      const timing=document.getElementById('morphSpeedToolbar');
      const speed=document.getElementById('morphSpeedType');
      const period=document.getElementById('morphInterval')?.closest('.morph-setting-row');
      const badge=document.getElementById('morphAutoBadge');
      const quick=[...document.querySelectorAll('[data-morph-interval]')].map(b=>b.getAttribute('data-morph-interval'));
      const timingInfo={
        speedInTop:speed?.closest?.('#morphSpeedToolbar')===timing,
        periodInTop:period?.closest?.('#morphSpeedToolbar')===timing,
        periodLabel:period?.textContent?.replace(/\\s+/g,' ').trim()||'',
        quick,
        multiplier:!!document.getElementById('morphIntervalMultiplier'),
        badgeText:badge?.textContent?.trim()||'',
        periodVisible:period?getComputedStyle(period).display!=='none':false
      };
      const oldTap=structuredClone(state.tapTempo||{});
      state.tapTempo.bpm=120;state.tapTempo.beatsPerMorph=8;state.tapTempo.syncFullMorph=true;syncTapTimingIndicators();
      const autoOn={hidden:badge?.classList.contains('hidden')===true,value:document.getElementById('morphInterval')?.value};
      state.tapTempo.syncFullMorph=false;syncTapTimingIndicators();
      const autoOff={hidden:badge?.classList.contains('hidden')===true};
      Object.assign(state.tapTempo,oldTap);syncTapTimingIndicators();
      const shape=document.querySelector('#morphProfileBindings [data-morph-special="shape"]');
      const orbits=document.querySelector('#morphProfileBindings [data-morph-special="orbits"]');
      const ordinary=document.querySelector('#morphProfileBindings [data-morph-parameter="geometry.N"]');
      const dd=shape?.querySelector('details.morph-shape-route-profile-dropdown');
      const shapeInfo={
        exists:!!shape,
        splineVisible:!!shape?.querySelector('#morphSplinePointCount')||/Точки сплайна/.test(shape?.textContent||''),
        dropdown:!!dd,
        dropdownLabel:dd?.querySelector('summary')?.textContent?.replace(/\\s+/g,' ').trim()||'',
        optionLabels:[...(dd?.querySelectorAll('.morph-profile-group-check span')||[])].map(x=>x.textContent.trim()),
        optionCount:dd?.querySelectorAll('input[type=checkbox]').length||0,
        directProfileChecks:[...(shape?.querySelectorAll(':scope > .morph-special-profile-check')||[])].length,
        shapeBg:shape?getComputedStyle(shape).backgroundColor:'',
        orbitBg:orbits?getComputedStyle(orbits).backgroundColor:'',
        ordinaryBg:ordinary?getComputedStyle(ordinary).backgroundColor:'',
        shapeShadow:shape?getComputedStyle(shape).boxShadow:'',ordinaryShadow:ordinary?getComputedStyle(ordinary).boxShadow:''
      };
      if(dd){dd.open=true;const closed=dd.querySelector('input');if(closed){closed.click();await sleep(10);}}
      const dropdownStillExists=!!document.querySelector('#morphProfileBindings [data-morph-special="shape"] details.morph-shape-route-profile-dropdown');
      return{timingInfo,autoOn,autoOff,shapeInfo,dropdownStillExists};
    })()`,{timeoutMs:18000,label:'7.10.9 Blue timing + Shape row'});
    assert(r.timingInfo.speedInTop,'speed selector is not in the Blue top timing block');
    assert(r.timingInfo.periodInTop,'cycle period is not in the Blue top timing block');
    assert(r.timingInfo.periodVisible&&/Период цикла/.test(r.timingInfo.periodLabel),'visible Period cycle row is missing');
    assert(r.timingInfo.multiplier,'cycle multiplier is missing');
    assert(JSON.stringify(r.timingInfo.quick)===JSON.stringify(['1','2','3','5','8','15']),'stable quick period buttons changed: '+JSON.stringify(r.timingInfo.quick));
    assert(r.timingInfo.badgeText==='AUTO','AUTO badge text changed');
    assert(!r.autoOn.hidden,'AUTO badge does not appear when full TAP sync is active');
    assert(r.autoOff.hidden,'AUTO badge does not hide when TAP sync is off');
    assert(r.shapeInfo.exists,'Shape row missing');
    assert(!r.shapeInfo.splineVisible,'Spline point count is still exposed in Shape row');
    assert(r.shapeInfo.dropdown,'Shape profile sets are not in a dropdown');
    assert(/Наборы профилей/.test(r.shapeInfo.dropdownLabel),'profile dropdown lost its stable label');
    assert(r.shapeInfo.optionCount===5,'profile dropdown does not contain five stable groups');
    assert(JSON.stringify(r.shapeInfo.optionLabels)===JSON.stringify(['Стандарт','Замкнутые','С петлями','Разомкнутые','Мандала']),'profile dropdown labels differ: '+JSON.stringify(r.shapeInfo.optionLabels));
    assert(r.shapeInfo.directProfileChecks===0,'profile groups are still expanded as direct row checkboxes');
    assert(r.shapeInfo.shapeBg===r.shapeInfo.ordinaryBg,'Shape row still has a special background color');
    assert(r.shapeInfo.orbitBg===r.shapeInfo.ordinaryBg,'Orbit row still has a special background color');
    assert(r.shapeInfo.shapeShadow===r.shapeInfo.ordinaryShadow,'Shape row still has a special edge treatment');
    assert(r.dropdownStillExists,'profile dropdown disappeared after changing a group');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('7.10.9 BLUE TIMING + SHAPE ROW REGRESSION: PASS',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.10.9 Blue timing + Shape row:',e.stack||e.message);process.exit(1)});
