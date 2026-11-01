'use strict';
const assert=require('node:assert/strict');const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:70,evalTimeoutMs:45000});try{
 const r=await h.evaluate(`(()=>{
   const pts=[{x:-110,y:0},{x:-40,y:95},{x:43,y:88},{x:128,y:18},{x:93,y:-85},{x:-20,y:-109}];
   const path=(callback)=>{let rows=[];const ctx={moveTo:(...q)=>rows.push(['M',...q]),lineTo:(...q)=>rows.push(['L',...q]),bezierCurveTo:(...q)=>rows.push(['C',...q]),closePath:()=>rows.push(['Z'])};callback(ctx);return rows;};
   const baseline=path(c=>splinePathForDraw(c,pts,true,0,[],[],true,1,0,{roundingShape:'spline',wholeCurveSpline:true}));
   const tiny=path(c=>splinePathForDraw(c,pts,true,1e-9,[],[],true,1,0,{roundingShape:'spline',wholeCurveSpline:true}));
   let smallest=0;if(baseline.length!==tiny.length)smallest=Infinity;else for(let k=0;k<baseline.length;k++)if(baseline[k][0]===tiny[k][0])for(let t=1;t<baseline[k].length;t++)smallest=Math.max(smallest,Math.abs(baseline[k][t]-tiny[k][t]));else smallest=Infinity;
   const firstSpline=path(c=>splinePathForDraw(c,pts,true,.5,[],[],true,1,0,{roundingShape:'spline',wholeCurveSpline:true}));
   const firstContour=path(c=>splinePathForDraw(c,pts,true,.5,Array(pts.length).fill(true),[],true,1,0,{roundingShape:'contour',wholeCurveSpline:true,roundingSmoothSplines:true}));
   const open=Array.from({length:70},(_,i)=>{const t=i/69*8*Math.PI,r=10+i*.7;return{x:r*Math.cos(t),y:r*Math.sin(t),widthScale:1+.1*i/70};});
   const native=buildSpiralBezierSegments(open,.75,[],true,true);
   const old=buildSpiralBezierSegments(open,.75,[],true,false);
   const obj={__spiroGLGeometryRecorder:true,__spiroNativeBezierSpiral:true,__recordVariableWidthBezierSpiral:(seg,w)=>{obj.count=seg.length;obj.finite=seg.every(q=>[q.p0,q.c1,q.c2,q.p3].every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));return true;},lineWidth:2,globalAlpha:1,__suppressStroke:false};
   strokeVariableWidthSpiralPath(obj,open,.75,[],false,{roundingShape:'spline'});
   return{startError:smallest,baselineCubics:baseline.filter(x=>x[0]==='C').length,tinyCubics:tiny.filter(x=>x[0]==='C').length,splineCount:firstSpline.filter(x=>x[0]==='C').length,contourCount:firstContour.filter(x=>x[0]==='C').length,spiral:{native:native.length,old:old.length,recorder:obj.count,finite:obj.finite},difference:JSON.stringify(firstSpline)!==JSON.stringify(firstContour)};
 })()`,{timeoutMs:42000,label:'12.4 zero boundary native spline and spiral gpu'});
 console.log('BROWSER',JSON.stringify(r));assert(r.startError<1e-5,`0% spline seam ${r.startError}`);assert.equal(r.baselineCubics,r.tinyCubics);assert(r.difference);assert.equal(r.spiral.native,69);assert.equal(r.spiral.recorder,r.spiral.native);assert(r.spiral.finite);assert.deepEqual(uncaughtExceptions(h.events),[]);console.log('PASS 12.4 zero boundary, direct GPU spiral, native comparison');
 }finally{await h.close();}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
