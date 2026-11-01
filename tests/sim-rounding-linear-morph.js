'use strict';
// Empirical diagnostic of the UNMODIFIED Somata 10.4.19.24 engine.
// Run from app root: node tests/sim-rounding-linear-morph.js
const fs=require('fs');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:150,evalTimeoutMs:160000});
 try{
  const result=await h.evaluate(`(()=>{
   const saved={fourier:state.fourierMode,mode:state.morph.profileModeTransition,pct:state.morph.profileModeTransitionPercent};
   const results=[];
   const clamp=x=>Math.max(0,Math.min(1,x));
   const inNodes=[{x:0,y:0},{x:.17,y:.42},{x:.48,y:-.32},{x:.72,y:.26},{x:1,y:0}];
   const dstNodesSame=[{x:0,y:0},{x:.15,y:-.34},{x:.44,y:.48},{x:.68,y:-.21},{x:1,y:0}];
   const dstNodesUnequal=Array.from({length:8},(_,i)=>({x:i/7,y:i===0||i===7?0:Math.sin(i*2.4)*.3}));
   const steps=[0,.1,.25,.5,.75,.9,.95,.975,.99,.995,.998,.999,.9995,.9999,1];
   const cc=document.createElement('canvas');cc.width=580;cc.height=580;
   const ctx=cc.getContext('2d',{willReadFrequently:true});
   const work=()=>{ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,580,580);ctx.translate(290,290);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.lineJoin='round';};
   const paint=(draw)=>{work();draw(ctx);return ctx.getImageData(0,0,580,580).data.filter((_,i)=>i%4===3);};
   const delta=(a,b)=>{let sum=0,max=0,changed=0;for(let i=0;i<a.length;i++){
    const d=Math.abs(a[i]-b[i]);sum+=d;max=Math.max(max,d);if(d>4)changed++;
   }return{mean:sum/a.length,changed,max};};
   const geometryTrace=(draw)=>{
     const C=[];const rec={save(){},restore(){},beginPath(){C.push(['B'])},moveTo(...p){C.push(['M',...p])},lineTo(...p){C.push(['L',...p])},quadraticCurveTo(...p){C.push(['Q',...p])},bezierCurveTo(...p){C.push(['C',...p])},closePath(){C.push(['Z'])},stroke(){},fill(){},set globalAlpha(x){}};
     draw(rec);return C;
   };
   const tracePoints=C=>{
     const pts=[];let prev=null,first=null;for(const c of C){let p;switch(c[0]){
      case 'M':prev={x:c[1],y:c[2]};first=prev;pts.push(prev);break;
      case 'L':if(!prev)break;p={x:c[1],y:c[2]};for(let i=1;i<=4;i++){const u=i/4;pts.push({x:prev.x+(p.x-prev.x)*u,y:prev.y+(p.y-prev.y)*u});}prev=p;break;
      case 'C':if(!prev)break;{const a=prev,b={x:c[1],y:c[2]},d={x:c[3],y:c[4]},e={x:c[5],y:c[6]};for(let i=1;i<=8;i++){const u=i/8,v=1-u;pts.push({x:v*v*v*a.x+3*v*v*u*b.x+3*v*u*u*d.x+u*u*u*e.x,y:v*v*v*a.y+3*v*v*u*b.y+3*v*u*u*d.y+u*u*u*e.y});}prev=e;}break;
      case 'Q':if(!prev)break;{const a=prev,b={x:c[1],y:c[2]},e={x:c[3],y:c[4]};for(let i=1;i<=8;i++){const u=i/8,v=1-u;pts.push({x:v*v*a.x+2*v*u*b.x+u*u*e.x,y:v*v*a.y+2*v*u*b.y+u*u*e.y});}prev=e;}break;
      case 'Z':if(prev&&first&&Math.hypot(prev.x-first.x,prev.y-first.y)>1e-7)pts.push(first);prev=first;break;
     }}return pts.filter(p=>Number.isFinite(p.x+p.y));
   };
   const sampleArc=(P,n=160)=>{
     if(P.length<2)return [];
     const lens=[0];for(let i=1;i<P.length;i++)lens[i]=lens[i-1]+Math.hypot(P[i].x-P[i-1].x,P[i].y-P[i-1].y);
     const max=lens.at(-1);if(max<1e-9)return[];let j=1;const out=[];
     for(let k=0;k<n;k++){const a=max*k/(n-1);while(j<lens.length-1&&lens[j]<a)j++;
      const u=(a-lens[j-1])/Math.max(1e-10,lens[j]-lens[j-1]);out.push({x:P[j-1].x*(1-u)+P[j].x*u,y:P[j-1].y*(1-u)+P[j].y*u});}
     return out;
   };
   const aligned=(A,B)=>{const a=sampleArc(A),b=sampleArc(B);if(!a.length||!b.length)return{mean:Infinity,max:Infinity};
    let sum=0,max=0;for(let k=0;k<a.length;k++){const d=Math.hypot(a[k].x-b[k].x,a[k].y-b[k].y);sum+=d;max=Math.max(max,d);}return{mean:sum/a.length,max};
   };
   const haus=(A,B)=>{const a=sampleArc(A),b=sampleArc(B);if(!a.length||!b.length)return Infinity;
    const one=(x,y)=>{let mx=0;for(const p of x){let best=Infinity;for(const q of y)best=Math.min(best,Math.hypot(p.x-q.x,p.y-q.y));mx=Math.max(mx,best);}return mx;};return Math.max(one(a,b),one(b,a));};
   try{
    state.fourierMode=false;state.morph.profileModeTransition='phase';state.morph.profileModeTransitionPercent=30;
    for(const knots of ['same','unequal'])for(const profile of ['segments','spline-local','spline-whole'])for(const rounding of [0,55,120]){
     const src=createLayer('sim-a'),dst=createLayer('sim-b');
     const spline=profile!=='segments',whole=profile==='spline-whole';
     Object.assign(src,{N:7,K:2,spiralEnabled:false,closedLoop:true,radius:180,rotation:0,rounding,
       profileMode:spline?'spline':'segments',wholeCurveSpline:whole,splineRenderMode:'smooth',
       lineVisible:true,fill:false,profileNodes:inNodes});
     Object.assign(dst,src,{id:'sim-b',profileNodes:knots==='same'?dstNodesSame:dstNodesUnequal});
     const drawer=(t)=>ctx=>{ctx.beginPath();drawAngularAnchorMorph(ctx,dst,src,dst,t,1,'phase','linear');};
     const staticDraw=ctx=>{for(const p of buildOrbitPolylines(dst)){ctx.beginPath();
       const round=getRoundingStrength(dst.rounding);
       if(useSmoothSplinePath(dst,round,p))splinePathForDraw(ctx,p.points,p.closed,round,p.cornerFlags||[],p.bridgeRoundFlags||[],whole);
       else roundPolylineForDraw(ctx,p.points,p.closed,round,p.cornerFlags||[]);
       ctx.stroke();}};
     const frames=steps.map(t=>({t,pixels:paint(drawer(t)),commands:geometryTrace(drawer(t))}));
     const stat=paint(staticDraw),staticCmd=geometryTrace(staticDraw);
     const near=frames.at(-2),end=frames.at(-1),
      nearPts=tracePoints(near.commands),endPts=tracePoints(end.commands),statPts=tracePoints(staticCmd);
     const metrics=frames.slice(1).map((f,i)=>{
       const prev=frames[i],dt=f.t-prev.t;
       const a=tracePoints(prev.commands),b=tracePoints(f.commands);
       return{to:f.t,dt,pxDiff:delta(f.pixels,prev.pixels).mean,
        pxRate:delta(f.pixels,prev.pixels).mean/dt,
        arcMean:aligned(a,b).mean,arcMax:aligned(a,b).max,arcRate:aligned(a,b).mean/dt,
        curveSegments:f.commands.filter(q=>q[0]==='C').length,lineSegments:f.commands.filter(q=>q[0]==='L').length};
     });
     const terminal=metrics.at(-1);
     results.push({knots,profile,rounding,
       endpointPixels:delta(end.pixels,stat),nearToFinalPixels:delta(near.pixels,end.pixels),
       endpointGeometry:{aligned:aligned(endPts,statPts),hausdorff:haus(endPts,statPts),nearToEnd:aligned(nearPts,endPts),nearToStatic:haus(nearPts,statPts)},
       endCommandCount:end.commands.length,staticCommandCount:staticCmd.length,
       nearArcRate:terminal.arcRate,lateRates:metrics.filter(m=>m.to>=.95),allRates:metrics
     });
    }
   }finally{state.fourierMode=saved.fourier;state.morph.profileModeTransition=saved.mode;state.morph.profileModeTransitionPercent=saved.pct;}
   return results;
  })()`,{label:'measure actual Polygon linear Morph with local/whole splines and rounding',timeoutMs:160000});
  const errors=uncaughtExceptions(h.events);
  const out={source:'Somata 10.4.19.24 unmodified; Chromium Canvas2D, --disable-gpu',date:'2026-10-28',cases:result,uncaught:errors};
  fs.writeFileSync('/mnt/data/somata_linear_morph_simulation.json',JSON.stringify(out,null,2));
  for(const r of result){console.log([r.knots.padEnd(8),r.profile.padEnd(13),'round='+String(r.rounding).padStart(3),
     'endPx='+r.endpointPixels.mean.toFixed(5),'endHaus='+r.endpointGeometry.hausdorff.toFixed(3),
     'lastSpeed='+r.nearArcRate.toFixed(2),'prevSpeed='+r.lateRates.at(-2).arcRate.toFixed(2),
     'C='+r.lateRates.at(-1).curveSegments].join(' '));}
  console.log('uncaughtExceptions',errors.length,'cases',result.length);
 }finally{await h.close();}
})().catch(err=>{console.error('SIM FAILED',err.stack||err);process.exitCode=1});
