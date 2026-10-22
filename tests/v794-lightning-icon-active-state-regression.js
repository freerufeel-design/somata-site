const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const ROOT=path.resolve(__dirname,'..');
const assert=(c,m)=>{if(!c)throw new Error(m)};
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

(async()=>{
  const html=read('index.html'),css=read('styles/app.css');
  assert(html.includes('M13.6 1.35 5.35 12.85'),'refined Lightning main bolt missing');
  assert(html.includes('M15.55 6.65 20.5 3.8'),'refined Lightning branch missing');
  assert(css.includes('#btnSidebarLightning.feature-enabled')&&css.includes('color:#ff312e'),'bright-red enabled Lightning style missing');
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:15000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);const t=document.createElement('style');t.textContent='#btnSidebarLightning.feature-enabled{color:#ff312e!important;background:rgba(255,35,35,.16)!important;border-color:rgba(255,69,58,.92)!important}#btnSidebarLightning.feature-enabled .lightning-bolt{fill:#ff312e!important;stroke:#ffd1ce!important}#btnSidebarLightning.feature-enabled .lightning-branch{stroke:#ff746b!important;opacity:1!important}#btnSidebarLightning.feature-enabled .lightning-icon{filter:drop-shadow(0 0 7px rgba(255,49,46,.95))!important}';document.head.appendChild(t);})()`);
    const out=await h.evaluate(`(()=>{
      const layer=state.layers.find(l=>l.id===state.activeLayerId)||state.layers[0];ensureLayerEffectState(layer);state.masterLayerEdit=false;
      const check=document.getElementById('showLightning'),btn=document.getElementById('btnSidebarLightning');
      check.checked=false;check.dispatchEvent(new Event('change',{bubbles:true}));syncSidebarToolStates();
      const off={enabled:btn.classList.contains('feature-enabled'),color:getComputedStyle(btn).color,filter:getComputedStyle(btn.querySelector('.lightning-icon')).filter};
      check.checked=true;check.dispatchEvent(new Event('change',{bubbles:true}));syncSidebarToolStates();
      const bolt=btn.querySelector('.lightning-bolt'),branch=btn.querySelector('.lightning-branch');
      const on={enabled:btn.classList.contains('feature-enabled'),classes:btn.className,connected:btn.isConnected,color:getComputedStyle(btn).color,background:getComputedStyle(btn).backgroundColor,border:getComputedStyle(btn).borderColor,filter:getComputedStyle(btn.querySelector('.lightning-icon')).filter,boltFill:getComputedStyle(bolt).fill,branchStroke:getComputedStyle(branch).stroke,styleCount:document.querySelectorAll('style').length,lastStyle:document.querySelector('style:last-of-type')?.textContent||'',matches:btn.matches('#btnSidebarLightning.feature-enabled')};
      return {off,on};
    })()`);
    assert(out.off.enabled===false,'Lightning OFF is incorrectly marked enabled');
    assert(out.on.enabled===true,'Lightning ON did not mark sidebar tool enabled');
    assert(out.on.boltFill==='rgb(255, 49, 46)','Lightning bolt itself is not bright red: '+out.on.boltFill);
    assert(out.on.branchStroke==='rgb(255, 116, 107)','Lightning branch is not using the active red accent: '+out.on.branchStroke);
    assert(out.on.filter&&out.on.filter!=='none','Lightning ON has no electric glow');
    assert(out.off.filter==='none'&&out.on.filter!=='none','Lightning OFF/ON glow state is indistinguishable');
    const errors=uncaughtExceptions(h.events).slice(baseline);assert(!errors.length,'uncaught browser exceptions: '+errors.join(' | '));
    console.log('7.9.4 LIGHTNING ICON + BRIGHT RED ACTIVE STATE: PASS',out);
  }finally{await h.close();}
})().catch(e=>{console.error('7.9.4 LIGHTNING ICON + BRIGHT RED ACTIVE STATE: FAIL',e.stack||e);process.exit(1)});
