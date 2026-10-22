const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const ROOT=path.resolve(__dirname,'..');
const assert=(c,m)=>{if(!c)throw new Error(m)};
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

(async()=>{
  const html=read('index.html'),plan=read('js/render/sweep-plan.js'),pass=read('js/render/sweep-pass.js');
  assert(/id="btnSidebarSweep"[\s\S]*id="btnSidebarLightning"/.test(html),'Lightning tool is not directly after Glint');
  assert(html.includes('id="showLightning"'),'independent Lightning checkbox missing');
  assert(html.includes('lightning-settings-group'),'independent Lightning settings group missing');
  assert(plan.includes('plan.instances')&&plan.includes("resolveSweepSubEffect(frameCtx,cfg,'glint')")&&plan.includes("resolveSweepSubEffect(frameCtx,cfg,'lightning')"),'dual Sweep/Lightning plan missing');
  assert(pass.includes('renderLayerSweepInstance')&&pass.includes('for(const item of list)'),'dual Sweep/Lightning render loop missing');

  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:15000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const css=read('styles/app.css');
    await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})()`);
    const out=await h.evaluate(`(()=>{
      const layer=state.layers.find(l=>l.id===state.activeLayerId)||state.layers[0];ensureLayerEffectState(layer);state.masterLayerEdit=false;setSidebarMode('sweep');syncSidebarInputs();
      const glint=document.getElementById('showSweep'),light=document.getElementById('showLightning');
      glint.checked=false;glint.dispatchEvent(new Event('change',{bubbles:true}));light.checked=false;light.dispatchEvent(new Event('change',{bubbles:true}));
      const start={...getLayerSweepConfig(layer)};
      glint.checked=true;glint.dispatchEvent(new Event('change',{bubbles:true}));let a={...getLayerSweepConfig(layer)};
      light.checked=true;light.dispatchEvent(new Event('change',{bubbles:true}));let b={...getLayerSweepConfig(layer)};
      glint.checked=false;glint.dispatchEvent(new Event('change',{bubbles:true}));let c={...getLayerSweepConfig(layer)};
      glint.checked=true;glint.dispatchEvent(new Event('change',{bubbles:true}));let d={...getLayerSweepConfig(layer)};

      beginFrameGeometryRuntime();const ctx=acquireLayerFrameEffectContext(0);ctx.layer=layer;ctx.effectLayer=layer;ctx.sourceLayer=layer;ctx.staticDrawData=getCachedLayerDrawData(layer);ctx.canonicalGeometry=getCanonicalLayerGeometry(layer);ctx.now=1400;ctx.frame.now=ctx.now;ctx.frame.dpr=1;ctx.frame.id=ctx.frameId;ctx.strokeWidth=Math.max(.5,Number(layer.strokeWidth)||1.5);ctx.sweepPreparedReady=false;
      const effect=resolveLayerSweepEffectProvider(ctx,resetSweepEffectPlan({}));

      document.getElementById('btnMorphSettings')?.click();
      const groups=[...document.querySelectorAll('#morphRoutingGroups .audio-route-group-btn')].map(x=>({text:x.textContent.trim(),icon:!!x.querySelector('.morph-routing-group-icon')}));
      const rows=[...document.querySelectorAll('#morphProfileBindings .morph-route-row')].map(x=>({id:x.dataset.morphParameter,iconClass:x.querySelector('.morph-route-row-icon')?.firstElementChild?.className||'',svgClass:x.querySelector('.morph-route-row-icon svg')?.className?.baseVal||'',hasDot:!!x.querySelector('.morph-route-dot')}));
      const spriteGroup=[...document.querySelectorAll('#morphRoutingGroups .audio-route-group-btn')].find(x=>x.textContent.includes('Спрайт линии'));
      const lightningGroup=[...document.querySelectorAll('#morphRoutingGroups .audio-route-group-btn')].find(x=>x.textContent.includes('Молния'));
      const toolOrder=[...document.querySelectorAll('#sidebarToolRail [data-sidebar-mode]')].map(x=>x.dataset.sidebarMode);
      setSidebarMode('lightning');
      const visibility={lightning:getComputedStyle(document.querySelector('.lightning-settings-group')).display,sweep:getComputedStyle(document.querySelector('.sweep-settings-group')).display};
      return {start,a,b,c,d,instances:(effect.instances||[]).map(x=>({type:x.cfg?.effectType,enabled:x.enabled,hasData:!!x.frameData})),groups,rows,spriteSnake:!!spriteGroup?.querySelector('.morph-routing-snake-icon'),lightningIcon:!!lightningGroup?.querySelector('.lightning-icon'),toolOrder,visibility};
    })()`);
    assert(out.a.glintEnabled===true&&out.a.lightningEnabled===false&&out.a.enabled===true,'Glint cannot run independently');
    assert(out.b.glintEnabled===true&&out.b.lightningEnabled===true&&out.b.enabled===true,'Glint + Lightning cannot be enabled together');
    assert(out.c.glintEnabled===false&&out.c.lightningEnabled===true&&out.c.enabled===true,'Lightning cannot remain independently enabled');
    assert(out.d.glintEnabled===true&&out.d.lightningEnabled===true,'re-enabling Glint destroyed Lightning state');
    assert(out.instances.length===2&&out.instances[0].type==='glint'&&out.instances[1].type==='lightning'&&out.instances.every(x=>x.hasData),'dual plan did not prepare both sub-effects: '+JSON.stringify(out.instances));
    assert(out.groups.length>=10&&out.groups.every(x=>x.icon),'Morph group headings do not all have semantic icons');
    assert(out.rows.length>0&&out.rows.every(x=>!x.hasDot),'old lamp-dot marker still appears in Morph rows');
    assert(out.spriteSnake,'Sprite group does not use snake icon');
    assert(out.lightningIcon,'Lightning group does not use new Lightning icon');
    const si=out.toolOrder.indexOf('sweep'),li=out.toolOrder.indexOf('lightning');assert(si>=0&&li===si+1,'Lightning sidebar icon is not directly below Glint');
    assert(out.visibility.lightning!=='none'&&out.visibility.sweep==='none','Lightning sidebar mode does not isolate Lightning panel');
    const errors=uncaughtExceptions(h.events).slice(baseline);assert(!errors.length,'uncaught browser exceptions: '+errors.join(' | '));
    console.log('7.9.3 MORPH ICONS + INDEPENDENT GLINT/LIGHTNING: PASS',out);
  }finally{await h.close();}
})().catch(e=>{console.error('7.9.3 MORPH ICONS + INDEPENDENT GLINT/LIGHTNING: FAIL',e.stack||e);process.exit(1)});
