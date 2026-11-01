'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:60,evalTimeoutMs:100000});
 try{
  const cases=await h.evaluate(`(()=>{
   const layer=createLayer('v1125-micro-probe');
   Object.assign(layer,{N:4,K:2,radius:100,rounding:150,roundingMaxRadiusDrop:30});
   const c=document.createElement('canvas');c.width=420;c.height=360;
   const ctx=c.getContext('2d',{willReadFrequently:true});
   const measure=(points,closed,phase)=>{
    ctx.clearRect(0,0,c.width,c.height);ctx.beginPath();ctx.save();ctx.translate(115,140);
    drawMorphPathQuality(ctx,points,closed,1.5,'segments',null,false,'smooth',points.map(()=>false),[],false,1,morphFilletRecoveryMix(phase),layer);
    ctx.strokeStyle='white';ctx.lineWidth=2;ctx.stroke();ctx.restore();
    const rgba=ctx.getImageData(0,0,c.width,c.height).data;
    const alpha=new Uint8Array(c.width*c.height);
    for(let i=0;i<alpha.length;i++)alpha[i]=rgba[4*i+3];return alpha;
   };
   const delta=(x,y)=>{let sum=0,noticeable=0;
    for(let i=0;i<x.length;i++){const d=Math.abs(x[i]-y[i]);sum+=d/255;if(d>40)noticeable++;}
    return {sum,noticeable};
   };
   let seed=1921;const r=()=>((seed=(Math.imul(seed,1664525)+1013904223)|0)>>>0)/4294967296;
   const results=[];
   for(let n=0;n<64;n++){
    const first={x:-100+r()*70,y:-70+r()*140};
    const center={x:r()*40,y:r()*40};
    const third={x:60+r()*80,y:-80+r()*160};
    const fourth={x:120+r()*80,y:-70+r()*140};
    const direction=r()*Math.PI*2;
    for(const closed of [false,true])for(const phase of [.02,.5]){
      const points=d=>[first,{x:center.x+d*Math.cos(direction),y:center.y+d*Math.sin(direction)},center,third,fourth];
      // This was an instantaneous neighbour switch in 11.0.24:
      // same carrier within 2e-9 but different recovered-angle flags.
      const a=measure(points(.999e-6),closed,phase),b=measure(points(1.001e-6),closed,phase);
      results.push({n,closed,phase,kind:'micro',...delta(a,b)});
      // Also cross a vertex with the continuous arc probe at a length
      // comparable to the intended mini-profile activation scale.
      if(n<24){
        const base=2*layer.radius*Math.sin(Math.PI/layer.N),reach=.04*base;
        const x=measure(points(reach-1e-6),closed,phase),y=measure(points(reach+1e-6),closed,phase);
        results.push({n,closed,phase,kind:'reach',...delta(x,y)});
      }
    }
   }
   return results;
  })()`,{label:'micro corners near collapsed neighbour and arc probe',timeoutMs:95000});
  const worst=cases.reduce((a,b)=>b.sum>a.sum?b:a);
  assert(worst.sum<30,'micro-corner phase discontinuity: '+JSON.stringify(worst));
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS '+cases.length+' browser comparisons for open/closed Morph at micro-edge & arc-probe boundaries; worst pixel delta='+worst.sum.toFixed(4));
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL:',e.stack||e);process.exitCode=1;});
