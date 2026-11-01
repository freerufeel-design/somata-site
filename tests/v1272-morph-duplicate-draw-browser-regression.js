'use strict';
// Checks the real Morph draw entry point, not just the isolated Spline+ kernel.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:10000});
 try{
  const result=await h.evaluate(`(()=>{
   const savedMode=state.morph.mode,savedFourier=state.fourierMode;
   const layer=createLayer('duplicate-spline-check');
   Object.assign(layer,{N:4,K:1,radius:220,rounding:50,radiusMultiplier:1,
    spiralEnabled:false,profileMode:'spline'});
   const vertices=[{x:220,y:0},{x:0,y:220},{x:-220,y:0},{x:0,y:-220}];
   const draw=points=>{
    const commands=[],ctx={moveTo:(...v)=>commands.push(['M',...v]),
     lineTo:(...v)=>commands.push(['L',...v]),
     bezierCurveTo:(...v)=>commands.push(['C',...v]),
     closePath:()=>commands.push(['Z'])};
    drawMorphPathQuality(ctx,points,true,.5,'spline',1,false,'smooth',[],[],false,0,0,layer);
    let last=null;const cubics=[];
    for(const q of commands){
     if(q[0]==='M')last={x:q[1],y:q[2]};
     if(q[0]==='C'){
      const end={x:q[5],y:q[6]};
      if(Math.hypot(end.x-last.x,end.y-last.y)>1e-7)
       cubics.push([last.x,last.y,q[1],q[2],q[3],q[4],end.x,end.y]);
      last=end;
     }
    }
    return cubics;
   };
   try{
    state.morph.mode='topology';state.fourierMode=false;
    const baseline=draw(vertices);
    const variant=vertices.map(p=>({...p}));variant.splice(1,0,{...variant[1]});
    const variant2=vertices.map(p=>({...p}));variant2.splice(1,0,{...variant2[1]},{...variant2[1]});
    const unchanged=draw(variant),unchanged2=draw(variant2);
    const error=other=>Math.max(...baseline.flatMap((c,i)=>c.map((v,j)=>Math.abs(v-other[i]?.[j]))));
    return{normal:baseline.length,duplicate:unchanged.length,triple:unchanged2.length,
     error:error(unchanged),tripleError:error(unchanged2)};
   }finally{state.morph.mode=savedMode;state.fourierMode=savedFourier;}
  })()`,{label:'live Morph duplicate-invariant renderer'});
  assert.equal(result.normal,4);
  assert.equal(result.duplicate,4);
  assert.equal(result.triple,4);
  assert(result.error<1e-7,JSON.stringify(result));
  assert(result.tripleError<1e-7,JSON.stringify(result));
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS live Morph draw duplicate and triple slots:',JSON.stringify(result));
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
