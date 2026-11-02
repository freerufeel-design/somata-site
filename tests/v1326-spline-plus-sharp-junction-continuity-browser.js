'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:40000});
 try{
  const report=await h.evaluate(`(()=>{
   const points=[{x:0,y:0},{x:20,y:50},{x:40,y:35},{x:55,y:-45},{x:90,y:40},{x:115,y:0}];
   const flags=[false,false,false,true,false,false];
   const layer={profileMode:'spline',rounding:0,roundingMode:'standard',N:6,radius:150,wholeCurveSpline:false};
   const capture=fn=>{const result=[],ctx={moveTo:(...a)=>result.push(['M',...a]),lineTo:(...a)=>result.push(['L',...a]),bezierCurveTo:(...a)=>result.push(['C',...a]),closePath:()=>result.push(['Z'])};fn(ctx);return result;};
   const staticPath=(closed,round,flag=flags,whole=false)=>capture(c=>splinePathForDraw(c,points,closed,round,flag,[],whole,1,0,{...layer,rounding:round,wholeCurveSpline:whole}));
   const morphPath=(closed,round,blend,flag=flags,whole=false)=>capture(c=>drawMorphPathQuality(c,points,closed,round,blend>.5?'spline':'segments',blend,true,'smooth',flag,[],whole,0,false,{...layer,rounding:round,wholeCurveSpline:whole}));
   const oldSplinePlus=(closed,round)=>capture(c=>somataDrawSplineCornerMode(c,points,closed,round,{baseSplineBlend:1,layer}));
   const maxCubicDifference=(a,b)=>{
    if(a.length!==b.length||a.some((r,i)=>r[0]!==b[i][0]||r.length!==b[i].length))return Infinity;
    return Math.max(0,...a.map((r,i)=>Math.max(0,...r.slice(1).map((x,j)=>Math.abs(x-b[i][j+1])))));
   };
   let roundParity=0,endpointParity=0,nearEnd=0,nearBegin=0,sharpAngle=0,continuity=0;
   const directions=[];
   for(const closed of [false,true])for(const whole of [false,true]){
    for(const round of [.15,.65,1,1.5]){
     const legacy=oldSplinePlus(closed,round);
     if(JSON.stringify(staticPath(closed,round,flags,whole))!==JSON.stringify(legacy) ||
       JSON.stringify(morphPath(closed,round,1,flags,whole))!==JSON.stringify(legacy))
       throw Error('positive-rounding Spline+ changed '+round);
     roundParity++;
    }
    const target=staticPath(closed,0,flags,whole),morphEnd=morphPath(closed,0,1,flags,whole);
    if(JSON.stringify(target)!==JSON.stringify(morphEnd))throw Error('100% endpoint mismatch '+closed+'/'+whole);
    endpointParity++;
    const almost=morphPath(closed,0,.9999,flags,whole);
    const diff=maxCubicDifference(almost,target);
    if(!(diff<.01))throw Error('100% jump '+diff);
    nearEnd=Math.max(nearEnd,diff);
    const src=morphPath(closed,0,0,flags,whole),just=morphPath(closed,0,.0001,flags,whole);
    if(src.filter(r=>r[0]==='L').length<2 ||just.filter(r=>r[0]==='C').length<2)throw Error('missing line or cubic endpoint');
    // Both endpoints of every curve stay attached to the original carrier.
    const cs=just.filter(r=>r[0]==='C');
    const active=closed?points.length:points.length-1;
    if(cs.length!==active)throw Error('topology changed along transition');
    for(let i=0;i<cs.length;i++){
     const q=points[(i+1)%points.length],c=cs[i];
     continuity=Math.max(continuity,Math.hypot(c[5]-q.x,c[6]-q.y));
    }
    const baseline=morphPath(closed,0,.0001,flags,whole).filter(r=>r[0]==='C');
    for(let i=0;i<baseline.length;i++){
     const p=points[i],q=points[(i+1)%points.length],c=baseline[i];
     nearBegin=Math.max(nearBegin,Math.hypot(c[1]-(p.x+(q.x-p.x)/3),c[2]-(p.y+(q.y-p.y)/3)));
    }
    if(!whole){
     const cubic=target.filter(r=>r[0]==='C'),before=cubic[2],after=cubic[3];
     const ix=before[5]-before[3],iy=before[6]-before[4],ox=after[1]-before[5],oy=after[2]-before[6];
     const cos=(ix*ox+iy*oy)/Math.max(1e-12,Math.hypot(ix,iy)*Math.hypot(ox,oy));
     const angle=Math.acos(Math.max(-1,Math.min(1,cos)))*180/Math.PI;
     if(angle<20)throw Error('logical Spline joint lost sharp tangent '+angle);
     sharpAngle=angle;
    }
    directions.push({closed,whole,diff});
   }
   const timeModes={};
   const priorMode=state.morph.mode,priorTransition=state.morph.profileModeTransition,priorPercent=state.morph.profileModeTransitionPercent;
   state.morph.mode='circleSlide';
   for(const mode of ['phase','start','end']){
    state.morph.profileModeTransition=mode;state.morph.profileModeTransitionPercent=30;
    const v=[0,.01,.15,.3,.6,.7,.85,.99,1].map(t=>morphSplineBlend('segments','spline',t));
    const reverse=[0,.01,.15,.3,.6,.7,.85,.99,1].map(t=>morphSplineBlend('spline','segments',t));
    if(v.some((n,i)=>Math.abs(n+reverse[i]-1)>1e-9))throw Error('time mode asymmetry '+mode);
    if(v.some((n,i)=>i&&n<v[i-1]))throw Error('time mode not monotonic '+mode);
    if(v[0]!==0||Math.abs(v[v.length-1]-1)>1e-10)throw Error('time mode endpoints '+mode);
    timeModes[mode]=v;
   }
   state.morph.mode=priorMode;state.morph.profileModeTransition=priorTransition;state.morph.profileModeTransitionPercent=priorPercent;
   const spiral=points.map((p,i)=>({...p,__profileCorner:flags[i],widthScale:1}));
   const gpu=__spiroBuildSpiralBezierSegments(spiral,0,flags,true,true,layer);
   if(!gpu?.length||gpu.some(s=>[s.p0,s.p3,s.c1,s.c2].some(p=>!Number.isFinite(p?.x)||!Number.isFinite(p?.y))))throw Error('GPU carrier invalid');
   return {roundParity,endpointParity,nearEnd,nearBegin,sharpAngle,continuity,directions,timeModes,gpuCubics:gpu.length};
  })()`,{label:'Spline+ sharp-only-junctions and 100% continuity',timeoutMs:40000});
  assert.equal(report.roundParity,16);
  assert.equal(report.endpointParity,4);
  assert(report.nearEnd<.01&&report.nearBegin<.01&&report.continuity<1e-8);
  assert(report.sharpAngle>20);
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS sharp Spline+ joins, 0..100 bidirectional Morph, original positive fillets and all phase windows',JSON.stringify(report));
 }finally{await h.close();}
})().catch(err=>{console.error(err.stack||err);process.exitCode=1});
