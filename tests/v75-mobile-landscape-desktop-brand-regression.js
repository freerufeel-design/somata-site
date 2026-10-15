const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:12000,loadDelayMs:300});
 const baseline=uncaughtExceptions(h.events).length;
 try{
  const css=fs.readFileSync(path.join(h.ROOT,'styles/app.css'),'utf8');
  await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);return true})()`);
  await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await h.call('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:3,mobile:true,screenWidth:844,screenHeight:390});
  await sleep(320);
  const out=await h.evaluate(`(()=>{const b=document.getElementById('desktopBrandLogoButton'),s=document.getElementById('desktopBrandStage'),br=b.getBoundingClientRect(),cs=getComputedStyle(b);const before=window.__somataDesktopBrandStatus?.();const toggled=window.__somataDesktopBrandToggle?.();const after=window.__somataDesktopBrandStatus?.();return{inner:[innerWidth,innerHeight],coarse:matchMedia('(pointer: coarse)').matches,hoverNone:matchMedia('(hover: none)').matches,button:{display:cs.display,w:br.width,h:br.height,visible:cs.display!=='none'&&br.width>0&&br.height>0},stageDisplay:getComputedStyle(s).display,before,toggled,after};})()`);
  console.log('MOBILE LANDSCAPE DESKTOP BRAND PROBE',out);
  assert(out.coarse&&out.hoverNone,'emulation is not coarse-touch landscape');
  assert(!out.button.visible,`desktop brand launcher leaked into mobile landscape: ${JSON.stringify(out.button)}`);
  assert(out.before?.desktop===false,`desktop brand runtime classifies mobile landscape as desktop: ${JSON.stringify(out.before)}`);
  assert(out.toggled===false&&out.after?.active===false,'desktop output can activate from mobile landscape');
  const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
  console.log('MOBILE LANDSCAPE DESKTOP BRAND REGRESSION: PASS',out);
 } finally {await h.close();}
})().catch(e=>{console.error('FAIL mobile landscape desktop brand regression:',e.stack||e.message);process.exit(1)});
