'use strict';
const fs = require('fs');
const path = require('path');
const {createBrowserHarness, uncaughtExceptions} = require('./lib/browser-harness');
const root=path.resolve(__dirname,'..');
const assert=(x,msg)=>{if(!x)throw new Error(msg);};
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:450,evalTimeoutMs:7500});
  try{
    const css=fs.readFileSync(path.join(root,'styles/app.css'),'utf8');
    await h.evaluate(`(()=>{const style=document.createElement('style');style.id='test-production-css';style.textContent=${JSON.stringify(css)};document.head.appendChild(style);})()`);
    await h.call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    const probe=async()=> h.evaluate(`(()=>{
      const display=id=>{const e=document.getElementById(id);return !!e && e.getClientRects().length>0 && getComputedStyle(e).display!=='none';};
      const node=id=>document.getElementById(id);
      const geo=node('geometrySettingsGroup');
      const children=[...geo.children];
      const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width}};
      const nrow=geo.querySelector('.geometry-n-slider-controls'), ntitle=geo.querySelector('.geometry-n-heading'), items=[...nrow.children], values=geo.querySelector('.geometry-n-values');
      const order=children.map(x=>x.id||x.className||'');
      const p=state.uiVisibility;
      return {visibility:{profile:display('profileSettingsGroup'),presets:display('presetChooserPanel'),morph:display('morphTypeTopNav'),guide:display('paramShowRoundingGuides'),gcd:display('gcdNotice'),audioPreset:display('audioRoutingPreset')},profile:p.hideProfiles,showPresets:p.showPresets,hideMorph:p.hideMorphChooser,order,
      nrow:rect(nrow),ntitle:rect(ntitle),nresult:rect(node('valNEffective')),nitems:items.map(x=>({id:x.id||x.className||x.textContent.trim(),r:rect(x)})),nvalues:{base:rect(node('numN')),mult:rect(node('paramNMultiplier')),wrap:rect(values)},
      sub:rect(node('suborbitsContainer')),rr:rect(geo.querySelector('.geometry-radius-rotation')),chaos:rect(geo.querySelector('.chaos-star-toggle-row'))};
    })()`);
    const first=await probe();
    assert(first.visibility.profile,'Profile section must always be visible');
    for(const id of ['presets','morph','gcd','audioPreset'])assert(!first.visibility[id],id+' must be hidden');
    assert(first.visibility.guide,'rounding continuation control must now be visible');
    assert(first.profile===false&&first.showPresets===false&&first.hideMorph===true,'visibility state must be pinned');
    assert(first.sub.top<first.chaos.top&&first.chaos.top<first.rr.top,'order S→Chaos→R→Rotation');
    assert(first.nitems.length===3,'N slider must be bracketed by buttons');
    assert(first.nitems[0].id==='btnDecN'&&first.nitems[2].id==='btnIncN','N minus/plus ordering');
    assert(first.nitems[0].r.right<first.nitems[1].r.left&&first.nitems[1].r.right<first.nitems[2].r.left,'N controls must not overlap');
    assert(first.nitems[1].r.width>180,'N slider is not long enough');
    assert(first.nvalues.base.right<first.nvalues.mult.left,'N box must be to left of ×1');
    assert(first.nvalues.mult.right<=first.nvalues.wrap.right,'N multiplier must not overflow');
    assert(first.ntitle.bottom<=first.nrow.top+1,'N heading must be above slider');
    assert(first.nresult.top<first.nrow.top,'Effective N readout must remain above slider');
    // Verify controls remain wired to original parameters without duplicate input ids.
    const afterN=await h.evaluate(`(()=>{const base=document.getElementById('numN'),mul=document.getElementById('paramNMultiplier');base.value='4';base.dispatchEvent(new Event('change',{bubbles:true}));mul.value='2';mul.dispatchEvent(new Event('change',{bubbles:true}));return {text:document.getElementById('valNEffective').textContent,base:base.value,mult:mul.value}})()`);
    assert(afterN.text.includes('8'),'N effective value must show 8: '+JSON.stringify(afterN));
    // Numeric base and the slider must remain synchronised in both directions.
    const edits=await h.evaluate(`(()=>{
      const range=document.getElementById('paramN'),base=document.getElementById('numN');
      range.value='6';range.dispatchEvent(new Event('input',{bubbles:true}));
      const slider={base:base.value,result:document.getElementById('valNEffective').textContent};
      base.value='5';base.dispatchEvent(new Event('change',{bubbles:true}));
      const numeric={slider:range.value,result:document.getElementById('valNEffective').textContent};
      base.value='4';base.dispatchEvent(new Event('change',{bubbles:true}));
      return{slider,numeric};
    })()`);
    assert(edits.slider.base==='6'&&edits.slider.result.includes('12'),'N range input must update base and effective result: '+JSON.stringify(edits));
    assert(edits.numeric.slider==='5'&&edits.numeric.result.includes('10'),'N numeric input must update slider and effective result: '+JSON.stringify(edits));
    // Project/playlist import may contain old hideProfiles: true — override it.
    const legacy=await h.evaluate(`(()=>{state.uiVisibility.hideProfiles=true;state.uiVisibility.showPresets=true;state.uiVisibility.hideMorphChooser=false;applyHeaderVisibility();return{hidden:document.getElementById('profileSettingsGroup').classList.contains('hidden'),menu:state.uiVisibility}})()`);
    assert(!legacy.hidden&&legacy.menu.hideProfiles===false&&legacy.menu.showPresets===false&&legacy.menu.hideMorphChooser===true,'Old visibility preferences must not hide profiles');
    const screenshot=await h.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    if(process.env.SOMATA_SAVE_TEST_ARTIFACTS==='1')fs.writeFileSync('/mnt/data/somata91_n_slider_preview.png',Buffer.from(screenshot.result.data,'base64'));
    console.log('PASS Somata 9.1 interface: visibility, geometry order, N row, N effective, legacy saved settings',JSON.stringify({bounds:first.nitems.map(x=>[x.id,Math.round(x.r.width)]),afterN,legacy:legacy.menu}));
    assert(uncaughtExceptions(h.events).length===0,'uncaught browser exception '+uncaughtExceptions(h.events));
  }finally{await h.close();}
})().catch(err=>{console.error('FAIL Somata 9.1 UI',err.stack||err);process.exitCode=1;});
