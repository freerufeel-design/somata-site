'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:60000});
 try{
  const result=await h.evaluate(`(()=>{
   const pts=Array.from({length:190},(_,i)=>{const f=i/189,a=f*5.5*Math.PI,r=18+165*f;return{x:r*Math.cos(a),y:r*Math.sin(a),widthScale:1-.65*f};});
   const layer=createLayer('winding-preservation');Object.assign(layer,{N:8,K:2,radius:180,rounding:200,spiralEnabled:true,spiralOrder:2.75,spiralClosed:true,roundingShape:'hybrid'});
   const paths=[];
   for(const amount of [0,50,100,150,199.99,200]){
    const count=()=>{const commands=[],ctx={moveTo:(...v)=>commands.push(['M',...v]),lineTo:(...v)=>commands.push(['L',...v]),bezierCurveTo:(...v)=>commands.push(['C',...v]),closePath:()=>commands.push(['Z'])};drawMorphPathQuality(ctx,pts,true,amount/100,'segments',null,false,'smooth',[],[],false,0,0,layer);return commands;};
    const commands=count(),cubics=commands.filter(c=>c[0]==='C');
    const cubicCarrier=window.__spiroBuildSpiralBezierSegments(pts,amount/100,[],true,true,layer);
    const rs=cubics.map(c=>Math.hypot(c[5],c[6]));
    const gpuRs=cubicCarrier.map(c=>Math.hypot(c.p3.x,c.p3.y));
    paths.push({amount,commands:commands.length,cubics:cubics.length,radialSpan:rs.length?Math.max(...rs)-Math.min(...rs):0,gpuCubics:cubicCarrier.length,gpuRadialSpan:gpuRs.length?Math.max(...gpuRs)-Math.min(...gpuRs):0,finite:cubics.every(c=>c.slice(1).every(Number.isFinite))&&cubicCarrier.every(c=>[c.p0,c.c1,c.c2,c.p3].every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))});
   }
   return paths;
  })()`,{timeoutMs:55000,label:'12.6.4 spiral real cubic GPU carrier'});
  console.log(JSON.stringify(result));
  for(const r of result){assert(r.finite,JSON.stringify(r));assert(r.gpuCubics>100,'GPU coil carrier collapsed '+JSON.stringify(r));if(r.amount>=100){assert(r.cubics>100,'visible spiral reduced to circle '+JSON.stringify(r));assert(r.radialSpan>100,'visible spiral radius collapsed '+JSON.stringify(r));assert(r.gpuRadialSpan>100,'GPU spiral radius collapsed '+JSON.stringify(r));}}
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 12.6.4 spiral GPU cubic path: no collapse at 100–200%; original multiwinding carrier and variable widths retained');
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
