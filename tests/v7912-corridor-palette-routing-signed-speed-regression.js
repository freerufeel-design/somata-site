const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const ROOT=path.resolve(__dirname,'..');
const assert=(c,m)=>{if(!c)throw new Error(m)};
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

(async()=>{
  const html=read('index.html'),routing=read('js/core/parameter-routing.js'),ui=read('js/app/ui-project-runtime.js');
  assert(html.includes('id="audioGroupCorridor"')&&html.includes('id="audioGroupPalette"'),'Audio Link Corridor/Palette groups missing');
  assert(!html.includes('data-tunnel-direction'),'legacy Corridor direction switch still present in UI');
  assert(html.includes('id="tunnelSpeedStrength" type="range" min="-100" max="100"'),'Corridor speed slider is not signed -100..100');
  assert(routing.includes("audio('palette.hueOffset','Палитра','Общее смещение цвета'")&&routing.includes("audio('tunnel.colorShift','Коридор','Смещение цвета'"),'shared Palette/Corridor definitions missing');
  assert(ui.includes("tunnelSettings.direction==='away'")&&ui.includes('signedSpeedVersion'),'legacy Corridor direction migration missing');

  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:15000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(()=>{
      const R=window.SomataParameterRegistry;
      const shared=R.morphable();
      const corridor=shared.filter(d=>d.group==='Коридор').map(d=>({id:d.id,label:d.label,ui:d.ui?.mainId,min:d.min,max:d.max}));
      const palette=shared.filter(d=>d.group==='Палитра').map(d=>({id:d.id,label:d.label,ui:d.ui?.mainId}));
      syncMorphRouteDecorations?.();
      document.getElementById('btnAudioRouting')?.click();renderAudioRoutingPanel?.();
      toggleMorphSettingsPanel?.(true);renderMorphRoutingGroups?.();
      const audioCorridor=document.getElementById('audioGroupCorridor'),audioPalette=document.getElementById('audioGroupPalette');
      const morphGroups=[...document.querySelectorAll('#morphRoutingGroups .audio-route-group-btn')].map(b=>b.textContent.replace('▾','').trim());
      const controls=['tunnelSpeedStrength','tunnelSpacingStrength','tunnelColorShiftDegrees','tunnelVignetteAmount','playlistPaletteHueOffset'].map(id=>{const el=document.getElementById(id);const host=el?.closest('.parameter-routing-control')||el;return{id,capable:!!host?.classList.contains('parameter-routing-capable'),param:host?.dataset?.routingParamId||''};});

      // New signed speed drives real Corridor travel in opposite directions without direction UI.
      const t=state.tunnel;t.active=true;t.speedMultiplier=1;t.spacingStrength=3;t.spacingMultiplier=1;t.lastTime=1000;t.travelPhase=0;t.phase=0;
      t.speedStrength=1;tunnelAnimationFrame(1040);const toward=t.travelPhase;
      t.lastTime=2000;t.travelPhase=0;t.phase=0;t.speedStrength=-1;tunnelAnimationFrame(2040);const away=t.travelPhase;
      t.active=false;t.lastTime=0;

      // Generic global Morph resolver must accept Corridor + Palette routes without mutating authored state.
      const profiles=SomataMorphParameterRouting.ensureProfiles(state.morph,state.minimalMorph);state.morph.activeProfileId='standard';
      SomataMorphParameterRouting.resetActiveProfile(state.morph,state.minimalMorph);
      const b=SomataMorphParameterRouting.addBinding(state.morph,state.minimalMorph,'tunnel.speed',{min:-50,max:-50});if(b)b.enabled=true;
      runtimeState.morph.active=true;runtimeState.morph.paused=false;runtimeState.morph.pausedByOrangeProject=false;runtimeState.morph.pausedByGreenProject=false;runtimeState.morph.geometryT=1;runtimeState.morph.phaseSerial=912;runtimeState.morph.parameterRouting=null;
      const authored=100,resolved=SomataMorphParameterRouting.resolveGlobalValue('tunnel.speed',authored);runtimeState.morph.active=false;

      const speed=document.getElementById('tunnelSpeedStrength');
      return{corridor,palette,audioCorridor:!!audioCorridor,audioPalette:!!audioPalette,morphGroups,controls,speedMin:speed?.min,speedMax:speed?.max,toward,away,resolved,authoredState:t.speedStrength};
    })()`,{timeoutMs:15000,label:'7.9.12 corridor palette routing signed speed'});

    assert(out.corridor.length===4,'Corridor must expose exactly 4 canonical routes: '+JSON.stringify(out.corridor));
    assert(JSON.stringify(out.corridor.map(x=>x.label))===JSON.stringify(['Скорость','Дистанция','Смещение цвета','Винетирование']),'Corridor labels/order wrong: '+JSON.stringify(out.corridor));
    assert(out.palette.length===1&&out.palette[0].label==='Общее смещение цвета','Palette must expose only global hue offset: '+JSON.stringify(out.palette));
    assert(out.audioCorridor&&out.audioPalette&&out.morphGroups.includes('Коридор')&&out.morphGroups.includes('Палитра'),'Corridor/Palette groups missing from Audio or Morph UI');
    assert(out.controls.every(x=>x.capable&&x.param),'Corridor/Palette controls did not get unified right-click routing surfaces: '+JSON.stringify(out.controls));
    assert(out.speedMin==='-100'&&out.speedMax==='100','signed Corridor slider bounds wrong');
    assert(out.toward>0&&out.away<0,'signed Corridor speed does not reverse travel direction: '+JSON.stringify({toward:out.toward,away:out.away}));
    assert(Math.abs(out.resolved-(-50))<1e-6,'global Morph resolver did not drive Corridor speed: '+out.resolved);
    const errors=uncaughtExceptions(h.events).slice(baseline);assert(!errors.length,'uncaught browser exceptions: '+errors.join(' | '));
    console.log('7.9.12 CORRIDOR + PALETTE ROUTING / SIGNED SPEED: PASS',out);
  }finally{await h.close();}
})().catch(e=>{console.error('7.9.12 CORRIDOR + PALETTE ROUTING / SIGNED SPEED: FAIL',e.stack||e);process.exit(1)});
