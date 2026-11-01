'use strict';
// Changing N/K in linear rounded Morph must not replace a final polygon with
// a different static curve. Also covers a different count of closed suborbits.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:45000});try{
 const r=await h.evaluate(`(()=>{const result=[];const cv=document.createElement('canvas');cv.width=640;cv.height=640;const c=cv.getContext('2d',{willReadFrequently:true});
 const P=[{x:0,y:0},{x:.18,y:.32},{x:.49,y:-.24},{x:.74,y:.15},{x:1,y:0}],Q=[{x:0,y:0},{x:.12,y:-.3},{x:.47,y:.37},{x:.81,y:-.12},{x:1,y:0}];
 const paint=fn=>{c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,640,640);c.translate(320,320);c.strokeStyle='#fff';c.lineWidth=2;fn();const d=c.getImageData(0,0,640,640).data,a=new Uint8Array(d.length/4);for(let i=0;i<a.length;i++)a[i]=d[i*4+3];return a;};
 const diff=(a,b)=>{let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-b[i]);return s/a.length};
 for(const [sN,sK,tN,tK] of [[7,2,8,3],[7,2,8,2],[8,2,7,2],[8,3,7,2]])
 for(const profile of ['segments','spline-local','spline-whole']){
  const src=createLayer('source'),dst=createLayer('target'),spline=profile!=='segments';
  Object.assign(src,{N:sN,K:sK,spiralEnabled:false,radius:185,rounding:55,closedLoop:true,fill:false,profileMode:spline?'spline':'segments',wholeCurveSpline:profile==='spline-whole',profileNodes:P});
  Object.assign(dst,src,{id:'target',N:tN,K:tK,profileNodes:Q});
  const paintStatic=l=>paint(()=>{for(const path of buildOrbitPolylines(l)){const round=getRoundingStrength(l.rounding);c.beginPath();
   if(useSmoothSplinePath(l,round,path))splinePathForDraw(c,path.points,path.closed,round,path.cornerFlags||[],path.bridgeRoundFlags||[],l.wholeCurveSpline===true);
   else roundPolylineForDraw(c,path.points,path.closed,round,path.cornerFlags||[]);c.stroke();}});
  const morph=t=>paint(()=>drawAngularAnchorMorph(c,dst,src,dst,t,1,'phase','linear'));
  const s=paintStatic(src),d=paintStatic(dst),u0=morph(0),u5=morph(.5),u9999=morph(.9999),u1=morph(1);
  let strokes=0;const rec={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},quadraticCurveTo(){},bezierCurveTo(){},closePath(){},stroke(){strokes++},fill(){},set globalAlpha(v){}};
  drawAngularAnchorMorph(rec,dst,src,dst,.9999,1,'phase','linear');
  result.push({sN,sK,tN,tK,profile,start:diff(s,u0),end:diff(d,u1),near:diff(d,u9999),move:diff(u5,d),strokes,expectedStrokes:Math.max(buildOrbitPolylines(src).length,buildOrbitPolylines(dst).length)});
 }return result;})()`,{label:'N/K topology change, one-to-two suborbit morph and exact visible handoff'});
 assert.equal(r.length,12);
 for(const c of r){assert(c.start<.001&&c.end<.001,'Static/Morph topology endpoint differs: '+JSON.stringify(c));
  assert(c.near<.035,'terminal topology handoff jumps: '+JSON.stringify(c));
  assert(c.move>.1,'topology morph frozen: '+JSON.stringify(c));
  assert(c.strokes===c.expectedStrokes,'geometry recorder changed topology before terminal frame: '+JSON.stringify(c));}
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS v10450: 12 N/K topology cases, 1↔2 suborbit changes, segments and both spline modes, rounded Morph endpoints');
 }finally{await h.close();}})().catch(e=>{console.error('FAIL v10450',e.stack||e);process.exitCode=1});
