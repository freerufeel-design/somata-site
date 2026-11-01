'use strict';
const assert=require('node:assert/strict');const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:65,evalTimeoutMs:40000});try{
 const r=await h.evaluate(`(()=>{
  const src=createLayer('spline-ui-slider-actual-render');
  src.N=8;src.K=1;src.radius=120;src.closedLoop=true;src.profileMode='spline';
  src.profileNodes=[{x:0,y:0},{x:.25,y:.8},{x:.5,y:-.6},{x:.75,y:1.0},{x:1,y:0}];
  src.roundingShape='spline';src.strokeWidth=2;src.glow=0;src.fill=false;
  const render=(v)=>{const base=Object.assign({},src,{rounding:v});const rows=[];const native=document.createElement('canvas').getContext('2d');const proxy=new Proxy(native,{get(ctx,key){if(key==='__spiroGLGeometryRecorder')return true;const val=ctx[key];if(typeof val!=='function')return val;return(...args)=>{if(['moveTo','lineTo','bezierCurveTo','closePath'].includes(key))rows.push([key,...args]);return val.apply(ctx,args);};}});renderLayerOrbitPaths(proxy,base);return rows;};
  const outputs=[0,20,50,100].map(render);const distance=(a,b)=>{let m=0;for(let i=0;i<Math.min(a.length,b.length);i++)for(let j=1;j<Math.min(a[i].length,b[i].length);j++){if(typeof a[i][j]==='number'&&typeof b[i][j]==='number')m=Math.max(m,Math.abs(a[i][j]-b[i][j]));}return m;};
  return{lengths:outputs.map(a=>a.length),cubics:outputs.map(a=>a.filter(x=>x[0]==='bezierCurveTo').length),deltas:[distance(outputs[0],outputs[1]),distance(outputs[1],outputs[2]),distance(outputs[2],outputs[3])],distinct:outputs.every((c,i)=>i===0||JSON.stringify(c)!==JSON.stringify(outputs[i-1]))};
 })()`,{timeoutMs:35000,label:'real static spline render strength'});
 console.log('REAL_RENDER',JSON.stringify(r));assert(r.distinct);assert(r.cubics[2]>0);assert(r.deltas[1]>.01);assert(r.deltas[2]>.01);assert.deepEqual(uncaughtExceptions(h.events),[]);console.log('PASS actual render respects 0/20/50/100% slider');
 }finally{await h.close()}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
