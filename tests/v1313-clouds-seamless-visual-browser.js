'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:70,evalTimeoutMs:30000});
  try{
    await h.call('Emulation.setDeviceMetricsOverride',{width:1280,height:850,deviceScaleFactor:1,mobile:false});
    const prep=`(()=>{
      state.showVignette=false;
      for(const e of Object.values(state.ambient))e.enabled=false;
      Object.assign(state.ambient.clouds,{enabled:true,density:100,opacity:54,color:'#acc5e7',hue:0,speed:12});
      const start=performance.now();SomataAmbientPrism.render(250000);
      window.__cloudPerfFirst=performance.now()-start;
      return {canvas:document.getElementById('ambientOverlayCanvas')?.getBoundingClientRect().toJSON(),duration:window.__cloudPerfFirst};
    })()`;
    const init=await h.evaluate(prep,{timeoutMs:30000});
    assert(init.duration<20000,`Slow initial cloud texture generation: ${JSON.stringify(init)}`);
    const sig=()=>`(()=>{const canvas=document.getElementById('ambientOverlayCanvas'),ctx=canvas.getContext('2d'); const w=canvas.width,h=canvas.height,d=ctx.getImageData(0,0,w,h).data;const points=[[.01,.01],[.5,.01],[.99,.01],[.01,.5],[.5,.5],[.99,.5],[.01,.99],[.5,.99],[.99,.99]];const values=points.map(([x,y])=>d[(Math.floor(y*h)*w+Math.floor(x*w))*4+3]);let sum=0,sumAlpha=0,minRow=Infinity,maxRow=0;for(let y=0;y<h;y+=2){let row=0;for(let x=0;x<w;x+=4){const a=d[(y*w+x)*4+3];sum=(sum+a)%1000000007;sumAlpha+=a;row+=a;}minRow=Math.min(minRow,row);maxRow=Math.max(maxRow,row);}return {values,sum,avgAlpha:sumAlpha/(Math.ceil(w/4)*Math.ceil(h/2)),minRow,maxRow,w,h}})()`;
    const a=await h.evaluate(sig());
    await h.evaluate('SomataAmbientPrism.render(250500)');
    const b=await h.evaluate(sig());
    assert.notEqual(a.sum,b.sum,'clouds must move when speed>0');
    assert(a.values.some(v=>v>2),'cloud overlay should not be empty');
    assert(a.avgAlpha>1,'clouds average opacity should be nonzero');
    await h.evaluate('state.ambient.clouds.speed=0;SomataAmbientPrism.render(251000)');
    const frozenA=await h.evaluate(sig());
    await h.evaluate('SomataAmbientPrism.render(261000)');
    const frozenB=await h.evaluate(sig());
    assert.equal(frozenA.sum,frozenB.sum,'speed=0 must not animate');
    const colorResult=await h.evaluate(`(()=>{
      const c=state.ambient.clouds, canvas=document.getElementById('ambientOverlayCanvas'),ctx=canvas.getContext('2d');
      const sample=()=>{const d=ctx.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data;return [...d];};
      c.color='#ff3040';c.hue=0;SomataAmbientPrism.render(275000);const red=sample();
      c.color='#1d80ff';SomataAmbientPrism.render(275000);const blue=sample();
      c.opacity=0;SomataAmbientPrism.render(275000);const clear=sample();
      c.opacity=54;c.density=0;SomataAmbientPrism.render(275000);const noClouds=sample();
      c.density=100;const t=performance.now();for(let i=0;i<90;i++){c.hue=i*4;SomataAmbientPrism.render(275000)}
      const hueDuration=performance.now()-t;
      return {red,blue,clear,noClouds,hueDuration};
    })()`,{timeoutMs:30000});
    assert(colorResult.red[0]>colorResult.red[2],`red cloud tint: ${JSON.stringify(colorResult)}`);
    assert(colorResult.blue[2]>colorResult.blue[0],`blue cloud tint: ${JSON.stringify(colorResult)}`);
    assert.equal(colorResult.clear[3],0,'opacity=0 must clear cloud overlay');
    assert.equal(colorResult.noClouds[3],0,'density=0 must not draw clouds');
    assert(colorResult.hueDuration<6000,'90-frame animated hue should not regenerate noise each frame');
    await h.evaluate(`(()=>{const c=state.ambient.clouds;c.color='#acc5e7';c.hue=0;c.density=100;c.speed=0;SomataAmbientPrism.render(261000)})()`);
    const image=await h.evaluate('document.getElementById("ambientOverlayCanvas").toDataURL("image/png")',{timeoutMs:30000});
    if(process.env.SOMATA_CLOUD_CAPTURE){fs.writeFileSync(process.env.SOMATA_CLOUD_CAPTURE,Buffer.from(image.split(',')[1],'base64'));}
    assert.deepEqual(uncaughtExceptions(h.events),[]);
    console.log('PASS seamless-clouds visual regression',JSON.stringify({init,a,b,frozenA,frozenB,colorResult}));
  }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
