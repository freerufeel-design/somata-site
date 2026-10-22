const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg);};

async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:18000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const css=fs.readFileSync(path.join(__dirname,'..','styles','app.css'),'utf8');
    await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})()`);
    const r=await h.evaluate(`(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const panel=document.getElementById('morphSettingsPanel');document.getElementById('btnMorphSettings')?.click();await sleep(30);syncMorphProfileUI();
      const retiredLamp=['lampMorphEnabled','lampMorphSize','lampMorphBrightness'];const legacy=['morphByStrokeWidth','morphStrokeWidthMin','morphStrokeWidthMax','morphByOpacity','morphOpacityMin','morphOpacityMax','morphByFillColor','morphFillOpacityMin','morphFillOpacityMax','morphMonoOrbitTransforms','morphOrbitPercentMin','morphOrbitPercentMax','morphByRounding','morphRoundingMin','morphRoundingMax','chaosMorphEnabled','chaosMorphStepSpread','chaosMorphClosuresMax'];
      const retiredLampExists=retiredLamp.filter(id=>document.getElementById(id));const placement=legacy.map(id=>{const el=document.getElementById(id);return{id,exists:!!el,sidebar:!!el?.closest('#settingsSidebar'),compat:!!el?.closest('.morph-compat-grid'),visible:!!el&&getComputedStyle(el.closest('label,div')||el).display!=='none'};});
      const groupBtns=[...document.querySelectorAll('#morphRoutingGroups .audio-route-group-btn')];const groups=groupBtns.map(b=>b.textContent.trim());
      const lineBtn=groupBtns.find(b=>b.textContent.includes('Линия'));lineBtn?.click();await sleep(20);let open=[...document.querySelectorAll('#audioViewportPopupPortal .audio-route-group-menu')].find(m=>!m.classList.contains('hidden'));const lineOptions=[...(open?.querySelectorAll('button')||[])].map(b=>b.textContent.replace(/^✓\s*/,'').trim());
      lineBtn?.click();const geomBtn=[...document.querySelectorAll('#morphRoutingGroups .audio-route-group-btn')].find(b=>b.textContent.includes('Геометрия'));geomBtn?.click();await sleep(20);open=[...document.querySelectorAll('#audioViewportPopupPortal .audio-route-group-menu')].find(m=>!m.classList.contains('hidden'));const geomOptions=[...(open?.querySelectorAll('button')||[])].map(b=>b.textContent.replace(/^✓\s*/,'').trim());
      const chaosButton=[...(open?.querySelectorAll('button')||[])].find(b=>b.textContent.includes('Морфинг хаоса'));if(chaosButton&&!state.morph.chaosMorphEnabled)chaosButton.click();await sleep(30);renderMorphProfileBindings();
      if(state.morph.options.byRounding!==true)setMorphParameterBinding('layer.rounding',true);await sleep(20);renderMorphProfileBindings();
      const special=[...document.querySelectorAll('#morphProfileBindings [data-morph-special]')].map(x=>x.dataset.morphSpecial);
      const routed=[...document.querySelectorAll('#morphProfileBindings [data-morph-parameter]')].map(x=>x.dataset.morphParameter);
      const duplicateRouted=routed.filter((id,i,a)=>a.indexOf(id)!==i);const duplicateSpecial=special.filter((id,i,a)=>a.indexOf(id)!==i);
      const lampLayer=state.layers[0];if(lampLayer){const cfg=ensureLayerLampState(lampLayer);cfg.morphEnabled=true;ensureLayerLampState(lampLayer);}const lampCfg=lampLayer?ensureLayerLampState(lampLayer):state.lamps;
      return {panel:{display:getComputedStyle(panel).display},retiredLampExists,groups,lineOptions,geomOptions,placement,special,routed,duplicateRouted,duplicateSpecial,lamp:{legacySupported:SomataMorphParameterRoutingUI.state('lamps.morphSize').supported,enabled:lampCfg?.morphEnabled===true},rows:{rounding:!!document.querySelector('[data-morph-parameter="layer.rounding"]'),orbits:!!document.querySelector('[data-morph-special="orbits"]'),chaos:!!document.querySelector('[data-morph-special="chaos"]')},sidebarTitles:[...document.querySelectorAll('#settingsSidebar .morph-sidebar-section-title')].map(x=>x.textContent.trim())};
    })()`);
    assert(r.panel.display==='flex','Morph panel did not open');
    assert(r.retiredLampExists.length===0,'retired Lamp Morph controls still exist in DOM: '+r.retiredLampExists.join(','));
    assert(r.groups.includes('Линия ▾'),'Morph Line group missing');
    assert(!r.groups.some(x=>x.startsWith('Заливка')),'separate Morph Fill group still exists');
    for(const label of ['Толщина линии','Прозрачность слоя','Цвет заливки','Прозрачность заливки'])assert(r.lineOptions.includes(label),'Line group missing '+label+': '+JSON.stringify(r.lineOptions));
    for(const label of ['Орбиты','Морфинг хаоса','Скругление'])assert(r.geomOptions.includes(label),'Geometry group missing '+label+': '+JSON.stringify(r.geomOptions));
    assert(r.rows.rounding&&r.rows.orbits&&r.rows.chaos,'Geometry Morph rows were not consolidated');
    assert(!r.sidebarTitles.includes('Морфинг лампочек'),'old Lamp Morph sidebar section still exists');
    assert(!r.sidebarTitles.includes('Морфинг линии и заливки'),'old Line/Fill Morph sidebar section still exists');
    assert(r.placement.every(x=>x.exists),'compatibility source control disappeared');
    assert(r.placement.every(x=>!x.sidebar),'legacy consolidated controls still leak into left sidebar: '+JSON.stringify(r.placement.filter(x=>x.sidebar)));
    assert(r.duplicateRouted.length===0&&r.duplicateSpecial.length===0,'duplicate Morph rows exist: '+JSON.stringify({routed:r.duplicateRouted,special:r.duplicateSpecial}));
    assert(r.lamp.legacySupported===false&&!r.lamp.enabled,'retired old lamp Morph can still be activated');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('7.10.5 MORPH GROUP CONSOLIDATION REGRESSION: PASS',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.10.5 Morph group consolidation:',e.stack||e.message);process.exit(1);});
