'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:40,evalTimeoutMs:16000});
 try {
 const out=await h.evaluate(`(()=>{
   const capture=(kind,pts,flags,strength=1,live=1)=>{
     const commands=[];
     const ctx={moveTo(x,y){commands.push(['M',x,y]);},lineTo(x,y){commands.push(['L',x,y]);},
       quadraticCurveTo(a,b,x,y){commands.push(['Q',a,b,x,y]);},
       bezierCurveTo(a,b,c,d,x,y){commands.push(['C',a,b,c,d,x,y]);},closePath(){commands.push(['Z']);}};
     if(kind==='spline')splinePathForDraw(ctx,pts,false,strength,flags,[],false,1,live);
     else roundPolylineForDraw(ctx,pts,false,strength,flags);
     return commands;
   };
   const pt=(x,y)=>({x,y});
   // Two intentionally adjacent corners: the first lies after a run which
   // ends in 1 px / 9 px / 10 px fragments, followed by a 0.1 px run.
   // The trailing length changes ONLY the global budget, not that long run.
   const mk=(tail,subdivide)=>{
     const start=subdivide?[pt(0,0),pt(100,0),pt(150,0),pt(180,0),pt(200,0),pt(210,0),pt(220,0),pt(221,0)]:[pt(0,0),pt(221,0)];
     const pts=[...start,pt(221.1,0),pt(221.1,tail)];
     const flags=pts.map((_,i)=>i===start.length-1||i===start.length);
     return {pts,flags};
   };
   const cases=[];
   for(const kind of ['spline','segment']){
     for(const tail of [80,180]){
       const a=mk(tail,true),b=mk(tail,false);
       const A=capture(kind,a.pts,a.flags),B=capture(kind,b.pts,b.flags);
       const samples=A.filter(c=>c[0]==='C'||c[0]==='Q').map(c=>({x:c[c.length-2],y:c[c.length-1]}));
       // The first fillet's left shoulder is the endpoint of the penultimate
       // trimmed spline run, or the last L point before its Q control.
       const left=kind==='spline'
         ? A.filter(c=>c[0]==='C').find(c=>Math.abs(c[6])<1e-5 && Math.abs(c[5]-(221-Math.min(221*.5,(221.1+tail)/4)))<0.3)
         : A.find((c,i)=>c[0]==='Q')&&A[A.findIndex(c=>c[0]==='Q')-1];
       const leftX=left?(kind==='spline'?left[5]:left[1]):null;
       cases.push({kind,tail,leftX,
         expected:221-Math.min(221*.5,(221.1+tail)/4),
         pathFinite:A.flatMap(q=>q.slice(1)).every(Number.isFinite),
         first:A.slice(0,12),
         hasQuadratic:A.some(q=>q[0]==='Q'),
         count:A.length,simpleCount:B.length,
         // Both versions give the same fillet shoulder for a straight run.
         sameGeometry:kind==='segment'
           ? JSON.stringify(A.filter(c=>c[0]==='Q'))===JSON.stringify(B.filter(c=>c[0]==='Q'))
           : A.some(c=>c[0]==='C'&&Math.abs(c[5]-(221-Math.min(221*.5,(221.1+tail)/4)))<0.3)
             &&B.some(c=>c[0]==='C'&&Math.abs(c[5]-(221-Math.min(221*.5,(221.1+tail)/4)))<0.3),
         zeroSame:JSON.stringify(capture(kind,a.pts,a.flags,0,0))===JSON.stringify(capture(kind,a.pts,a.flags,0,1))});
     }
   }
   const curved=[pt(0,0),pt(50,65),pt(100,0),pt(130,-75),pt(200,0),pt(200.1,0),pt(200.2,0),pt(220,90)];
   const cf=curved.map((_,i)=>i===4||i===6);
   const curvedRuns=collectEdgeLocalSplineRuns(curved,false,cf,1);
   const actualCurveLength=curvedRuns.reduce((sum,r)=>sum+r.total,0);
   const chordLength=curved.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-curved[i].x,p.y-curved[i].y),0);
   const loc=locateOnEdgeLocalSplineRun(curvedRuns[0],curvedRuns[0].total*.65);
   const dist=curvedRuns[0].cubics.map(c=>c.arcLengths?.length||0);
   return {cases,actualCurveLength,chordLength,dist,locFinite:Number.isFinite(loc.t+loc.point.x+loc.point.y)};
 })()`,{label:'full profile arc rounding and multi segment crossing',timeoutMs:15000});
 for(const r of out.cases){
   assert(r.pathFinite,JSON.stringify(r));
   assert(r.zeroSame,'zero round live mismatch: '+JSON.stringify(r));
   assert(r.sameGeometry,'subdivision changed shoulder: '+JSON.stringify(r));
   assert(Number.isFinite(r.leftX),'missing shoulder: '+JSON.stringify(r));
   assert(Math.abs(r.leftX-r.expected)<0.3,'fillet must reach across multiple segments according to whole profile length: '+JSON.stringify(r));
   assert(r.leftX<150,'fillet must extend beyond nearest short segments: '+JSON.stringify(r));
 }
 for(const kind of ['spline','segment']){
   const a=out.cases.find(r=>r.kind===kind&&r.tail===80);
   const b=out.cases.find(r=>r.kind===kind&&r.tail===180);
   assert(b.leftX<a.leftX-20,'longer total profile must increase fillet reach, independent of nearest segment: '+JSON.stringify([a,b]));
 }
 assert(out.actualCurveLength>out.chordLength+5,'curved spline total length should be arc, not chord length: '+JSON.stringify(out));
 assert(out.dist.every(n=>n===17),'arc-length LUT must cover every cubic: '+JSON.stringify(out));
 assert(out.locFinite);
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS full-profile-length rounding: both segment and spline modes cross several segments, total length changes shoulder, subdivision/zero invariant; curved spline length',out.actualCurveLength.toFixed(2),'vs chords',out.chordLength.toFixed(2));
 } finally { await h.close(); }
})().catch(err=>{console.error('FAIL',err.stack||err);process.exitCode=1});
