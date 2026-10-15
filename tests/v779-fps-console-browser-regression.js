const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{let h;try{
  h=await createBrowserHarness({disableGpu:true,loadDelayMs:250,evalTimeoutMs:6000});
  const out=await h.evaluate(`(async()=>{
    const fps=document.getElementById('fpsCounter');fps.click();await new Promise(r=>setTimeout(r,30));
    document.getElementById('screenErrorOverlayTabLoad').click();document.getElementById('screenErrorOverlayAnalyze').click();await new Promise(r=>setTimeout(r,430));
    const loadText=document.getElementById('screenErrorOverlayLoadText')?.textContent||'';
    console.error('[FPS-CONSOLE-REGRESSION]',{probe:true});await new Promise(r=>setTimeout(r,30));
    document.getElementById('screenErrorOverlayTabErrors').click();await new Promise(r=>setTimeout(r,20));
    const errorText=document.getElementById('screenErrorOverlayText')?.textContent||'';
    return {loadText,errorText,active:window.__somataScreenErrors?.activeTab,analysis:window.__somataScreenErrors?.analysisEnabled};
  })()`,{timeoutMs:7000,label:'FPS console analyzer interaction'});
  if(!String(out.loadText||'').includes('LIVE')||!String(out.loadText||'').includes('Lightning:'))throw new Error('Load tab did not render live analysis');
  if(!out.errorText.includes('[FPS-CONSOLE-REGRESSION]'))throw new Error('console.error not visible in Errors tab');
  const uncaught=uncaughtExceptions(h.events);if(uncaught.length)throw new Error('uncaught browser exception: '+uncaught.join('\n'));
  console.log('SOMATA 7.7.9 FPS CONSOLE BROWSER: PASS');
 }catch(e){console.error('FAIL FPS console browser regression:',e.stack||e);process.exitCode=1;}finally{await h?.close?.();}})();
