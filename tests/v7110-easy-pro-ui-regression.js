const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const ROOT=path.resolve(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(ROOT,rel),'utf8');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg);};
(async()=>{
  const html=read('index.html'),css=read('styles/app.css'),ui=read('js/ui/ui-mode.js');
  assert(html.includes('id="uiModeSwitch"'),'UI mode switch missing');
  assert(html.indexOf('id="uiModeSwitch"')>html.indexOf('id="desktopBrandLogoButton"'),'mode switch must be to the right of the logo in DOM');
  assert(html.includes('data-ui-mode="easy"')&&html.includes('data-ui-mode="pro"'),'Easy/Pro buttons missing');
  assert(html.includes('js/ui/ui-mode.js'),'ui-mode runtime not loaded');
  assert(css.includes('body.ui-easy .sidebar-tool-rail'),'Easy rail styling missing');
  assert(css.includes('body.ui-easy #settingsSidebar .control-row'),'Easy settings-card styling missing');
  assert(css.includes('body.ui-easy:not(.easy-show-advanced)'),'Easy progressive disclosure missing');
  assert(ui.includes('ПКМ')&&ui.includes('Blue / Orange / Audio'),'routing discoverability copy missing');

  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:450,evalTimeoutMs:9000});
  try{
    await h.call('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
    await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})()`);
    const result=await h.evaluate(`(async()=>{
      const stateBefore=JSON.stringify((window.state||{}).layers||[]);
      const body=document.body;
      const sw=document.getElementById('uiModeSwitch');
      const easy=sw?.querySelector('[data-ui-mode="easy"]');
      const pro=sw?.querySelector('[data-ui-mode="pro"]');
      const initial={mode:body.dataset.uiMode,easy:body.classList.contains('ui-easy'),pro:body.classList.contains('ui-pro')};
      easy?.click(); await new Promise(r=>setTimeout(r,30));
      const shapeBtn=document.getElementById('btnSidebarShape');
      const intro=document.getElementById('easySectionIntro');
      const adv=document.getElementById('btnEasyAdvanced');
      const routable=document.querySelector('#settingsSidebar .easy-routable-param');
      const easyState={
        mode:body.dataset.uiMode,
        easy:body.classList.contains('ui-easy'),
        introVisible:!!intro,
        title:intro?.querySelector('#easySectionTitle')?.textContent||'',
        shapeLabel:shapeBtn?.dataset.easyLabel||'',
        advanced:body.classList.contains('easy-show-advanced'),
        routable:!!routable,
        railWidth:getComputedStyle(document.getElementById('sidebarToolRail')).width,
        sidebarWidth:getComputedStyle(document.getElementById('settingsSidebar')).width,
        easyOnlyDisplay:getComputedStyle(intro).display
      };
      adv?.click(); await new Promise(r=>setTimeout(r,10));
      const advancedOn=body.classList.contains('easy-show-advanced')&&adv?.getAttribute('aria-pressed')==='true';
      pro?.click(); await new Promise(r=>setTimeout(r,20));
      const final={mode:body.dataset.uiMode,easy:body.classList.contains('ui-easy'),pro:body.classList.contains('ui-pro')};
      return {initial,easyState,advancedOn,final,stateUnchanged:stateBefore===JSON.stringify((window.state||{}).layers||[])};
    })()`,{timeoutMs:12000,label:'easy/pro UI regression'});
    assert(result.initial.mode==='pro'&&result.initial.pro&&!result.initial.easy,'Pro must be the compatibility default');
    assert(result.easyState.mode==='easy'&&result.easyState.easy,'Easy switch failed');
    assert(result.easyState.introVisible&&result.easyState.title==='Форма','Easy section orientation missing');
    assert(result.easyState.shapeLabel==='Форма','Easy rail labels missing');
    assert(result.easyState.routable,'routable parameter affordance missing');
    assert(result.advancedOn,'advanced disclosure toggle failed');
    assert(result.final.mode==='pro'&&result.final.pro&&!result.final.easy,'Pro restore failed');
    assert(result.stateUnchanged,'switching UI mode changed authored layer state');
    const uncaught=uncaughtExceptions(h.events);assert(!uncaught.length,`uncaught browser errors: ${uncaught.join('\n')}`);
    console.log('7.11.0 EASY / PRO UI: PASS',result);
  }finally{await h.close();}
})().catch(err=>{console.error(err);process.exit(1);});
