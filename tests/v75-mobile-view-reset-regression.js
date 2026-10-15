const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function main(){
  const mobileQuery="(max-width: 760px), (max-height: 480px) and (hover: none) and (pointer: coarse)";
  const stateSource=fs.readFileSync(path.join(__dirname,'..','js/core/state.js'),'utf8');
  assert(stateSource.includes(`zoom: window.matchMedia('${mobileQuery}').matches ? 0.9 : 1.0`),'initial mobile zoom does not use the same portrait/landscape mobile query');
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:12000,loadDelayMs:300});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    await h.call('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36'});
    await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    const inspect=async(width,height)=>{
      await h.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:3,mobile:true,screenWidth:width,screenHeight:height});
      await sleep(180);
      return h.evaluate(`(()=>{
        state.zoom=1.73;state.panX=111;state.panY=-73;
        const mobileLayout=matchMedia('(max-width: 760px), (max-height: 480px) and (hover: none) and (pointer: coarse)').matches;
        document.getElementById('btnResetView').click();
        return{inner:[innerWidth,innerHeight],mobileLayout,coarse:matchMedia('(pointer: coarse)').matches,zoom:state.zoom,pan:[state.panX,state.panY],display:document.getElementById('zoomDisplay')?.textContent||''};
      })()`);
    };
    const portrait=await inspect(390,844);
    const landscape=await inspect(844,390);
    for(const [name,r] of [['portrait',portrait],['landscape',landscape]]){
      assert(r.mobileLayout&&r.coarse,`${name} is not classified as mobile/coarse`);
      assert(Math.abs(r.zoom-.9)<1e-9,`${name} mobile Reset View produced zoom=${r.zoom}; expected mobile 0.9`);
      assert(r.pan[0]===0&&r.pan[1]===0,`${name} Reset View did not clear pan: ${r.pan}`);
      assert(r.display==='90%',`${name} zoom display is ${r.display}; expected 90%`);
    }
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('MOBILE VIEW RESET REGRESSION: PASS',{portrait,landscape});
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL mobile view reset regression:',e.stack||e.message);process.exit(1)});
