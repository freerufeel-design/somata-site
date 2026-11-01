'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:40000});try{
 const data=await h.evaluate(`(()=>{
  const layer=state.layers.find(l=>l.id===state.activeLayerId)||state.layers[0];
  const input=document.getElementById('paramRounding');
  const btn=document.querySelector('[data-rounding-shape="hybrid"]');btn.click();
  const star=Array.from({length:18},(_,i)=>{const a=i*Math.PI/9-Math.PI/2,r=i%2?48:165;return{x:r*Math.cos(a),y:r*Math.sin(a)}});
  const render=(val)=>{const rows=[],ctx={moveTo:(...a)=>rows.push(['M',...a]),bezierCurveTo:(...a)=>rows.push(['C',...a]),lineTo:(...a)=>rows.push(['L',...a]),closePath:()=>rows.push(['Z'])};
   somataDrawSplineCornerMode(ctx,star,true,val/100,{layer:{roundingShape:'hybrid',N:9,radius:165}});
   const cubics=rows.filter(x=>x[0]==='C');const knots=cubics.map(x=>[x[5],x[6]]);
   const hash=rows.flat().filter(x=>typeof x==='number').reduce((a,x)=>((a*31+Math.round(x*1e5))%1000000007+1000000007)%1000000007,7);
   const circleErr=knots.length?Math.max(...knots.map(p=>Math.abs(Math.hypot(...p)-165)))/165:null;
   return {val,lines:rows.filter(x=>x[0]==='L').length,cubics:cubics.length,hash,circleErr};};
  const output=[0,25,50,75,100,125,150,175,200].map(render);
  if(!runtimeState.morph.active)document.getElementById('btnMorph').click();
  const rt=runtimeState.morph,start=rt.cycleStart,idx=state.layers.findIndex(l=>l.id===layer.id),snapshots=[];
  for(const value of [25,50,75,100,125,175,200]){
   input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));
   snapshots.push({value,src:rt.renderSourceLayers?.[idx]?.rounding,dst:rt.renderTargetLayers?.[idx]?.rounding,cycle:rt.cycleStart});
  }
  return{output,snapshots,start,mode:layer.roundingShape};
 })()`,{label:'12.6.1 real corner-only 0–100 and live slider',timeoutMs:38000});
 console.log('TRUE_CORNER_UI',JSON.stringify(data));
 assert.equal(data.mode,'hybrid');assert.equal(data.output[0].lines,17);assert.equal(data.output[0].cubics,0);
 for(const r of data.output.slice(1))assert.equal(r.cubics,18);
 for(let i=1;i<data.output.length;i++)assert.notEqual(data.output[i-1].hash,data.output[i].hash);
 assert(data.output.find(r=>r.val===100).circleErr>.08,'100% should retain recognisable star silhouette');
 assert(data.output.find(r=>r.val===125).circleErr<data.output.find(r=>r.val===100).circleErr);
 assert(data.output.find(r=>r.val===200).circleErr<1e-10);
 for(const x of data.snapshots){assert.equal(x.src,x.value);assert.equal(x.dst,x.value);assert.equal(x.cycle,data.start);}
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS real corner fairing 0–100, circle only after 100, live Morph slider/no restart');
 }finally{await h.close();}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
