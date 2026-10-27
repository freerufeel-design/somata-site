const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const check=(v,msg)=>{if(!v)throw Error(msg)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:450,evalTimeoutMs:25000});
 try{
  const r=await h.evaluate(`(()=>{
   state.ambient.rain.enabled=false;state.showVignette=false;
   Object.values(state.ambient).forEach(c=>c.enabled=false);
   // A GPU-disabled harness cannot certify 3D WebGPU pixels; validate the supported 2D optical fallback here.
   Object.assign(state.prism,{mode:'2d',source2d:'legacy',enabled:true,size:260,refraction:24,dispersion:76,opacity:55,speed:0});
   const shapes={};
   const width=document.getElementById('prismOverlayCanvas').width;
   for(const shape of ['lens','sphere','cube','skull','dodecahedron','cross']){
     state.prism.shape=shape;SomataAmbientPrism.render(11000);
     const c=document.getElementById('prismOverlayCanvas'),ctx=c.getContext('2d'),d=ctx.getImageData(0,0,c.width,c.height).data;
     let x0=c.width,y0=c.height,x1=-1,y1=-1,lit=0,visible=0,saturated=0;
     for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
       const i=(y*c.width+x)*4,a=d[i+3];if(a<24)continue;
       visible++;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
       if(a>75)lit++;
       if(Math.max(d[i],d[i+1],d[i+2])-Math.min(d[i],d[i+1],d[i+2])>35)saturated++;
     }
     shapes[shape]={visible,lit,saturated,w:x1-x0+1,h:y1-y0+1};
   }
   state.prism.shape='dodecahedron';SomataAmbientPrism.render(11000);
   return shapes;
  })()`,{timeoutMs:20000,label:'prism shape opacity, bounds and facets'});
  console.log('8.20.1 2D prism visibility:',JSON.stringify(r));
  for(const [name,x] of Object.entries(r)){
   check(x.visible>1500,`${name}: only ${x.visible} visible pixels`);
   check(x.lit>450,`${name}: only ${x.lit} strong pixels`);
   check(x.w>100&&x.h>100,`${name}: collapsed silhouette ${x.w} x ${x.h}`);
  }
  check(uncaughtExceptions(h.events).length===0,'uncaught Chromium exception');
  const s=await h.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  if(s?.result?.data && process.env.SOMATA_SAVE_TEST_ARTIFACTS==='1')fs.writeFileSync(path.resolve(__dirname,'../../../prism-8201-capture.png'),Buffer.from(s.result.data,'base64'));
  console.log('8.20.1 PRISM TEST PASS');
 }finally{await h.close()}
})().catch(e=>{console.error('8.20.1 PRISM TEST FAIL',e.stack||e);process.exitCode=1});
