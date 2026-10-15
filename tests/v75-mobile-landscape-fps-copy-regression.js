const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:10000,loadDelayMs:300});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const css=fs.readFileSync(path.join(h.ROOT,'styles/app.css'),'utf8');
    await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);return true})()`);
    await h.call('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:3,mobile:true,screenWidth:844,screenHeight:390});
    await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    await h.call('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
    await sleep(120);

    const result=await h.evaluate(`(async()=>{
      window.__somataScreenErrors.clear();
      let copied='';
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{copied=String(text);}}});
      console.error('MOBILE-LANDSCAPE-FPS-COPY-PROBE');
      const fps=document.getElementById('fpsCounter');
      const b=fps.getBoundingClientRect();
      fps.click();
      await new Promise(r=>setTimeout(r,70));
      const toast=document.getElementById('somataErrorCopyToast');
      const consoleDock=document.getElementById('somataErrorConsoleDock');
      const out={
        inner:[innerWidth,innerHeight],
        coarse:matchMedia('(pointer: coarse)').matches,
        hoverNone:matchMedia('(hover: none)').matches,
        fps:[b.width,b.height],
        copied,
        toastText:toast?.textContent||'',
        toastVisible:toast?.classList.contains('is-visible')===true,
        consoleVisible:consoleDock?consoleDock.hidden===false:false
      };
      window.__somataScreenErrors.clear();
      return out;
    })()`);
    console.log('MOBILE LANDSCAPE FPS COPY PROBE',result);
    assert(result.coarse&&result.hoverNone,'landscape emulation is not coarse-touch mobile');
    assert(result.fps[0]>=44&&result.fps[1]>=44,`landscape FPS target is ${result.fps[0]}x${result.fps[1]}, expected >=44x44`);
    assert(result.copied.includes('MOBILE-LANDSCAPE-FPS-COPY-PROBE'),'landscape mobile FPS click did not copy captured errors');
    assert(result.toastText==='Ошибки скопированы'&&result.toastVisible,'landscape mobile FPS copy has no confirmation toast');
    assert(!result.consoleVisible,'landscape mobile FPS click opened the desktop error console instead of copying');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('MOBILE LANDSCAPE FPS COPY REGRESSION: PASS',result);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL mobile landscape FPS copy regression:',e.stack||e.message);process.exit(1)});
