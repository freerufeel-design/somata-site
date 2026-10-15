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
    await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    await h.call('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 6a) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36'});

    const inspect=async(width,height)=>{
      await h.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:3,mobile:true,screenWidth:width,screenHeight:height});
      await sleep(260);
      return h.evaluate(`(()=>{
        const panel=document.getElementById('floatingViewportControls'),pb=panel.getBoundingClientRect(),pc=getComputedStyle(panel);
        const fps=document.getElementById('fpsCounter'),fb=fps.getBoundingClientRect();
        const nodes=[...panel.querySelectorAll('button,label')].filter(e=>{const c=getComputedStyle(e),b=e.getBoundingClientRect();return c.display!=='none'&&c.visibility!=='hidden'&&b.width>0&&b.height>0;});
        const controls=nodes.map(e=>{const b=e.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2,hit=(x>=0&&x<innerWidth&&y>=0&&y<innerHeight)?document.elementFromPoint(x,y):null;return{id:e.id||e.className,left:b.left,right:b.right,top:b.top,bottom:b.bottom,w:b.width,h:b.height,centerInViewport:x>=0&&x<innerWidth&&y>=0&&y<innerHeight,centerInPanel:x>=pb.left&&x<=pb.right&&y>=pb.top&&y<=pb.bottom,hit:hit===e||e.contains(hit),hitId:hit?.id||hit?.className||hit?.tagName||''};});
        const minLeft=Math.min(...controls.map(c=>c.left));
        const fpsOverlap=controls.filter(c=>Math.max(c.left,fb.left)<Math.min(c.right,fb.right)&&Math.max(c.top,fb.top)<Math.min(c.bottom,fb.bottom)).map(c=>c.id);
        return{inner:[innerWidth,innerHeight],panel:{left:pb.left,right:pb.right,top:pb.top,bottom:pb.bottom,overflowX:pc.overflowX,justify:pc.justifyContent,scrollLeft:panel.scrollLeft},fps:{left:fb.left,right:fb.right,top:fb.top,bottom:fb.bottom},minLeft,controls,fpsOverlap};
      })()`);
    };

    const portrait=await inspect(320,568);
    const landscape=await inspect(568,320);
    console.log('MOBILE NARROW HIT-TARGET PROBE',{portrait,landscape});
    for(const [name,s] of [['portrait320',portrait],['landscape568',landscape]]){
      assert(s.panel.overflowX==='auto'||s.panel.overflowX==='scroll',`${name} dock is not horizontally scrollable`);
      assert(s.minLeft>=s.panel.left-1,`${name} dock content overflows to the left (${s.minLeft} < ${s.panel.left}) and is not reachable by horizontal scrolling`);
      assert(s.fpsOverlap.length===0,`${name} FPS counter overlaps dock controls: ${s.fpsOverlap.join(', ')}`);
      for(const c of s.controls){
        assert(c.w>=44&&c.h>=44,`${name} ${c.id} is ${c.w}x${c.h}, expected >=44x44`);
        if(c.centerInPanel&&c.centerInViewport)assert(c.hit,`${name} ${c.id} center is intercepted by ${c.hitId||'another element'}`);
      }
    }
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('MOBILE NARROW HIT-TARGET REGRESSION: PASS',{portrait:{panel:portrait.panel,minLeft:portrait.minLeft,fpsOverlap:portrait.fpsOverlap},landscape:{panel:landscape.panel,minLeft:landscape.minLeft,fpsOverlap:landscape.fpsOverlap}});
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL mobile narrow hit-target regression:',e.stack||e.message);process.exit(1)});
