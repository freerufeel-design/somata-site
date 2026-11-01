'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:85,evalTimeoutMs:35000});
 try{
 const outcome=await h.evaluate(`(async()=>{
   const active=state.layers.find(l=>l.id===state.activeLayerId)||state.layers[0];
   if(!active)throw Error('No active layer');
   const shape=document.getElementById('paramRoundingShape');
   const btn=(mode)=>document.querySelector('[data-rounding-shape="'+mode+'"]');
   const initial=active.roundingShape;
   const toggle=document.getElementById('btnMorph');
   if(!toggle)throw Error('No Morph button');
   if(!runtimeState.morph.active)toggle.click();
   const started=runtimeState.morph.active===true;
   btn('contour').click();
   const selectedContour=active.roundingShape;
   const uiContour=shape.value;
   btn('spline').click();
   const selectedSpline=active.roundingShape;
   const uiSpline=shape.value;
   const modeStillActive=runtimeState.morph.active===true;
   const activeAlpha=btn('spline').getAttribute('aria-pressed');
   // Do not change any drawn Morph points: measure raw knots before/after
   // only through the display-only spline corner mode.
   const n=256;const pts=Array.from({length:n},(_,i)=>{const t=i*2*Math.PI/n,r=120*(1+.28*Math.cos(5*t));return{x:r*Math.cos(t),y:r*Math.sin(t)};});
   const sample=v=>{const rows=[];const rec={moveTo:(...a)=>rows.push(['M',...a]),lineTo:(...a)=>rows.push(['L',...a]),bezierCurveTo:(...a)=>rows.push(['C',...a]),closePath:()=>rows.push(['Z'])};if(!somataDrawSplineCornerMode(rec,pts,true,v,{baseSplineBlend:1,layer:{N:10,radius:120}}))throw Error('bad path');return rows;};
   const a=sample(.05),b=sample(.5),c=sample(1);const maxDelta=(x,y)=>{let best=0;for(let i=0;i<x.length;i++){for(let j=1;j<x[i].length;j++)if(typeof x[i][j]==='number')best=Math.max(best,Math.abs(x[i][j]-y[i][j]));}return best;};
   const max=.0;
   return {initial,started,selectedContour,uiContour,selectedSpline,uiSpline,modeStillActive,activeAlpha,deltaEarly:maxDelta(a,b),deltaLate:maxDelta(b,c),segments:c.filter(q=>q[0]==='C').length};
 })()`,{timeoutMs:30000,label:'12.4.1 active morph round shape and visible strength'});
 console.log('ACTIVE_BROWSER',JSON.stringify(outcome));
 assert.equal(outcome.started,true,'Morph must start for this regression');
 assert.equal(outcome.selectedContour,'contour');assert.equal(outcome.uiContour,'contour');
 assert.equal(outcome.selectedSpline,'spline');assert.equal(outcome.uiSpline,'spline');
 assert.equal(outcome.activeAlpha,'true');assert(outcome.deltaEarly>1.2);assert(outcome.deltaLate>1.2);
 assert.equal(outcome.segments,256);
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS active Morph switching, spline 0–100% visibly changes curves');
 }finally{await h.close();}
})().catch(err=>{console.error(err.stack||err);process.exitCode=1});
