'use strict';
const assert=require('node:assert/strict');const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:75,evalTimeoutMs:50000});try{
 const r=await h.evaluate(`(()=>{
  const layer=createLayer('spline-method-browser');
  const defaultMode=layer.roundingShape;
  const el=document.getElementById('paramRoundingShape');
  const buttons=[...document.querySelectorAll('.rounding-shape-btn')];
  const base={...layer,N:8,K:1,radius:130,rounding:100,profileMode:'segments',fill:false,closedLoop:true};
  const render=(mode,rounding,profile='segments',open=false)=>{
   const ctx=document.createElement('canvas').getContext('2d');ctx.__spiroGLGeometryRecorder=true;const out=[];
   const proxy=new Proxy(ctx,{get(c,k){const v=c[k];if(typeof v!=='function')return v;return (...args)=>{if(['moveTo','lineTo','bezierCurveTo','closePath'].includes(k))out.push([k,...args]);return v.apply(c,args);};}});
   renderLayerOrbitPaths(proxy,{...base,roundingShape:mode,rounding,profileMode:profile,closedLoop:!open});return out;
  };
  const spline=render('spline',100),contour=render('contour',100);
  const zero=render('spline',0),twoHundred=render('spline',200);
  const open=render('spline',80,'spline',true);
  const finite=rows=>rows.every(row=>row.slice(1).every(x=>typeof x!=='number'||Number.isFinite(x)));
  const active=state.layers.find(l=>l.id===state.activeLayerId)||state.layers[0];
  const activeBefore=active?.roundingShape;
  if(active){el.value='contour';el.dispatchEvent(new Event('change',{bubbles:true}));}
  const afterContour=active?.roundingShape;
  if(active){buttons.find(b=>b.dataset.roundingShape==='spline').click();}
  const afterSpline=active?.roundingShape;
  const points=Array.from({length:3000},(_,i)=>{const t=i*2*Math.PI/3000;return {x:130*Math.cos(t),y:130*Math.sin(t)}});
  const benchmark=(mode,iterations)=>{const ctx=document.createElement('canvas').getContext('2d');const a=performance.now();for(let i=0;i<iterations;i++){
   ctx.beginPath();if(mode==='spline')somataDrawSplineCornerMode(ctx,points,true,1,{baseSplineBlend:0});
   else drawUnifiedFilletPath(ctx,points,true,1,Array(points.length).fill(true),{layer:{N:3000,radius:130}});
  }return (performance.now()-a)/iterations;};
  return {defaultMode,options:buttons.length,splineCount:spline.filter(x=>x[0]==='bezierCurveTo').length,contourCount:contour.filter(x=>x[0]==='bezierCurveTo').length,zeroCount:zero.filter(x=>x[0]==='bezierCurveTo').length,twoHundredCount:twoHundred.filter(x=>x[0]==='bezierCurveTo').length,openCount:open.filter(x=>x[0]==='bezierCurveTo').length,finite:[finite(spline),finite(contour),finite(twoHundred),finite(open)],different:JSON.stringify(spline)!==JSON.stringify(contour),activeBefore,afterContour,afterSpline,perf:{spline:benchmark('spline',8),contour:benchmark('contour',2)}};
 })()`,{timeoutMs:45000,label:'12.4 live dual mode'});
 console.log('BROWSER',JSON.stringify(r));
 assert.equal(r.defaultMode,'hybrid');assert.equal(r.options,3);assert(r.different);assert(r.splineCount>0&&r.contourCount>0&&r.twoHundredCount>0);assert(r.finite.every(Boolean));assert.equal(r.afterContour,'contour');assert.equal(r.afterSpline,'spline');assert(r.perf.spline<r.perf.contour);assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS legacy spline/contour algorithms with the new three-mode selector');
 }finally{await h.close();}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
