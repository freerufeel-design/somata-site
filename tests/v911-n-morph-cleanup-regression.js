'use strict';
const fs=require('fs'),path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(x,msg)=>{if(!x)throw Error(msg)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:380,evalTimeoutMs:10000});
 try{
  const css=fs.readFileSync(path.resolve(__dirname,'../styles/app.css'),'utf8');
  await h.evaluate(`(()=>{let s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})()`);
  await h.call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  const init=await h.evaluate(`(()=>{
   let root=document.getElementById('geometrySettingsGroup'),buttons=['btnDecN','btnIncN','btnIncNMultiplier','btnDecNMultiplier'].map(id=>document.getElementById(id));
   let rect=x=>{let r=x.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height}};
   let ids=['btnDecN','paramN','btnIncN','numN','paramNMultiplier','btnIncNMultiplier','btnDecNMultiplier'];
   return {morphCount:root.querySelectorAll('.morph-sidebar-section').length,toolsInMorphPanel:!!document.querySelector('#morphSettingsPanel .morph-checkbox-tools'),fadeInMorphPanel:!!document.querySelector('#morphSettingsPanel #morphFadeDurationRow'),buttons:buttons.map(x=>({id:x.id,w:rect(x).w})),controls:Object.fromEntries(ids.map(id=>[id,rect(document.getElementById(id))])),visible:ids.every(id=>{let x=document.getElementById(id);return getComputedStyle(x).display!=='none'})};
  })()`);
  assert(init.morphCount===0,'Morphing sidebar panel remains in Geometry');
  assert(init.toolsInMorphPanel&&init.fadeInMorphPanel,'Morphing controls must remain in Morph modal');
  assert(init.visible,'N +/− or multiplier step buttons are hidden');
  const c=init.controls;
  assert(c.btnDecN.r <= c.paramN.l+.5,'N minus must be left of slider');
  assert(c.paramN.r <= c.btnIncN.l+.5,'N plus must be right of slider');
  assert(c.numN.r <= c.paramNMultiplier.l+.5,'Multiplier must follow base');
  assert(c.paramN.w>185,'N slider must remain long despite step buttons');
  const after=await h.evaluate(`(()=>{
   const get=id=>document.getElementById(id);
   get('paramNMultiplier').value='1';get('paramNMultiplier').dispatchEvent(new Event('change',{bubbles:true}));
   get('numN').value='4';get('numN').dispatchEvent(new Event('change',{bubbles:true}));
   let before={range:get('paramN').value,mult:get('paramNMultiplier').value,base:get('numN').value,eff:get('valNEffective').textContent};
   get('btnIncN').click();let plus={range:get('paramN').value,base:get('numN').value,eff:get('valNEffective').textContent};
   get('btnDecN').click();let minus={range:get('paramN').value,base:get('numN').value,eff:get('valNEffective').textContent};
   get('btnIncNMultiplier').click();let up={mult:get('paramNMultiplier').value,eff:get('valNEffective').textContent};
   get('btnDecNMultiplier').click();let down={mult:get('paramNMultiplier').value,eff:get('valNEffective').textContent};
   return {before,plus,minus,up,down};
  })()`);
  assert(after.plus.base==='5'&&after.plus.eff.includes('5'),'N plus must increment base and result '+JSON.stringify(after));
  assert(after.minus.base==='4'&&after.minus.eff.includes('4'),'N minus must decrement base '+JSON.stringify(after));
  assert(after.up.mult==='2'&&after.up.eff.includes('8'),'Multiplier up must produce 4 × 2 = 8 '+JSON.stringify(after));
  assert(after.down.mult==='1'&&after.down.eff.includes('4'),'Multiplier down must restore 4 × 1 = 4 '+JSON.stringify(after));
  const screenshot=await h.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync('/mnt/data/Somata_9.1_N_buttons_preview.png',Buffer.from(screenshot.result.data,'base64'));
  assert(uncaughtExceptions(h.events).length===0,'uncaught browser error: '+uncaughtExceptions(h.events));
  console.log('PASS v911: N steppers and Morph cleanup',JSON.stringify({init,after}));
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL v911',e.stack||e);process.exitCode=1});
