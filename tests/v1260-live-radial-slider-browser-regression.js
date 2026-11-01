'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:45000});try{
 const r=await h.evaluate(`(()=>{
 const layer=state.layers.find(l=>l.id===state.activeLayerId)||state.layers[0],saved={N:layer.N,K:layer.K,profileMode:layer.profileMode,closedLoop:layer.closedLoop};
 layer.N=9;layer.K=4;layer.radius=215;layer.profileMode='segments';layer.closedLoop=true;layer.roundingShape='hybrid';
 document.querySelector('[data-rounding-shape="hybrid"]').click();
 const rec=()=>{let calls=[];const ctx=document.createElement('canvas').getContext('2d');const proxy=new Proxy(ctx,{get(t,k){if(k==='__spiroGLGeometryRecorder')return true;const v=t[k];if(typeof v!=='function')return v;return(...args)=>{if(['moveTo','lineTo','bezierCurveTo','closePath'].includes(k))calls.push([k,...args]);return v.apply(t,args)}}});return{ctx:proxy,calls};};
 const output=[];const input=document.getElementById('paramRounding');
 for(const value of [0,10,35,65,100,150,200]){
  input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));
  const canvas=rec();renderLayerOrbitPaths(canvas.ctx,{...layer,rounding:value,fill:false,glow:0});
  const rows=canvas.calls;const numbers=rows.flat().filter(x=>typeof x==='number');
  const hash=numbers.reduce((acc,x)=>((acc*31+Math.round(x*10000))%1000000007+1000000007)%1000000007,7);
  output.push({value,cubics:rows.filter(x=>x[0]==='bezierCurveTo').length,lines:rows.filter(x=>x[0]==='lineTo').length,hash});
 }
 if(!runtimeState.morph.active)document.getElementById('btnMorph').click();
 const rt=runtimeState.morph;const start=rt.cycleStart,idx=state.layers.findIndex(l=>l.id===layer.id),live=[];
 for(const value of [20,50,100,150,200]){
  input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));
  live.push({value,src:rt.renderSourceLayers?.[idx]?.rounding,dst:rt.renderTargetLayers?.[idx]?.rounding,cycle:rt.cycleStart});
 }
 Object.assign(layer,saved);
 return {output,live,start,mode:layer.roundingShape,guardHidden:document.getElementById('paramRoundingMaxRadiusDrop').classList.contains('hidden')};
 })()`,{label:'12.6 actual radial render and live slider without Morph restart',timeoutMs:40000});
 console.log('RADIAL_UI',JSON.stringify(r));
 assert.equal(r.mode,'hybrid');assert(r.guardHidden);
 assert(r.output[0].lines>0,'0% must draw original straight edges');
 assert.equal(r.output[0].cubics,0,'0% must not round');
 for(const item of r.output.slice(1))assert(item.cubics>0,`${item.value}% must draw splines`);
 for(let i=1;i<r.output.length;i++)assert.notEqual(r.output[i-1].hash,r.output[i].hash,'every slider state must redraw a different rail');
 for(const item of r.live){assert.equal(item.cycle,r.start,'changing rounding must not restart Morph');assert.equal(item.src,item.value);assert.equal(item.dst,item.value);}
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS 0% polyline, all positive slider steps change real renderer, live snapshot updated at unchanged cycle start');
 }finally{await h.close();}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
