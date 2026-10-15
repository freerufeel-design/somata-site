const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:12000,loadDelayMs:300});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const css=fs.readFileSync(path.join(h.ROOT,'styles/app.css'),'utf8');
    await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);return true})()`);
    await h.call('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36'});
    await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    await h.call('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:3,mobile:true,screenWidth:844,screenHeight:390});
    await sleep(100);

    const result=await h.evaluate(`(async()=>{
      window.__somataScreenErrors.clear();
      let copied='';
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{copied=String(text);}}});
      console.error('MOBILE-LANDSCAPE-TOAST-VISIBILITY-PROBE');
      document.getElementById('fpsCounter').click();
      await new Promise(r=>setTimeout(r,80));
      const toast=document.getElementById('somataErrorCopyToast');
      const cs=getComputedStyle(toast),b=toast.getBoundingClientRect();
      const mobile=matchMedia('(max-width: 760px), (max-height: 480px) and (hover: none) and (pointer: coarse)').matches;
      const out={
        mobile,
        copied,
        text:toast?.textContent||'',
        classVisible:toast?.classList.contains('is-visible')===true,
        display:cs.display,
        visibility:cs.visibility,
        opacity:Number(cs.opacity),
        rect:[b.left,b.top,b.width,b.height],
        inViewport:b.width>0&&b.height>0&&b.right>0&&b.bottom>0&&b.left<innerWidth&&b.top<innerHeight
      };
      window.__somataScreenErrors.clear();
      return out;
    })()`);
    assert(result.mobile,'844x390 coarse-touch viewport did not enter the mobile contract');
    assert(result.copied.includes('MOBILE-LANDSCAPE-TOAST-VISIBILITY-PROBE'),'FPS click did not copy captured errors');
    assert(result.text==='Ошибки скопированы'&&result.classVisible,'copy confirmation state/text was not activated');
    assert(result.display!=='none'&&result.visibility!=='hidden'&&result.opacity>.5&&result.inViewport,`copy confirmation is not actually visible: ${JSON.stringify(result)}`);
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('MOBILE LANDSCAPE TOAST VISIBILITY REGRESSION: PASS',result);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL mobile landscape toast visibility regression:',e.stack||e.message);process.exit(1)});
