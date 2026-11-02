'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:50000});
 try{
  const report=await h.evaluate(`(()=>{
   const raw=[{x:0,y:0},{x:.22,y:.58},{x:.48,y:-.36},{x:.75,y:.43},{x:1,y:0}];
   const base={...state.layers[0],N:5,K:2,radius:135,radiusMultiplier:1,rotation:0,
    customSuborbits:null,closedLoop:true,spiralEnabled:false,chaosStar:false,
    rounding:0,roundingMode:'standard',roundingShape:'spline',wholeCurveSpline:false,
    lineJoinType:'rounded',profileNodes:raw};
   const source={...base,profileMode:'segments',__morphExactProfileNodes:raw};
   const target={...base,profileMode:'spline',__morphExactProfileNodes:raw,
     profileNodes:Array.from({length:12},(_,i)=>({x:i/11,y:Math.sin(i/11*Math.PI*4)*.1}))};
   if(!isAuthoredProfileTransitionPair(source,target))throw Error('mode only pair not recognized');
   const take=()=>{const rows=[],strokes=[];
    const ctx={beginPath(){rows.length=0;},moveTo:(...v)=>rows.push(['M',...v]),
      lineTo:(...v)=>rows.push(['L',...v]),bezierCurveTo:(...v)=>rows.push(['C',...v]),
      closePath:()=>rows.push(['Z']),save(){},restore(){},stroke(){strokes.push(rows.map(r=>r.slice()))},
      fill(){},scale(){},lineWidth:1,globalAlpha:1};
    return {ctx,strokes};};
   const draw=(t,reverse=false)=>{const q=take();drawAngularAnchorMorph(q.ctx,base,reverse?target:source,reverse?source:target,t,1,'shortest','linear');return q.strokes;};
   const point=(p0,c,t)=>{const u=1-t;
      if(c[0]==='L')return{x:p0.x*(1-t)+c[1]*t,y:p0.y*(1-t)+c[2]*t};
      return{x:u*u*u*p0.x+3*u*u*t*c[1]+3*u*t*t*c[3]+t*t*t*c[5],
       y:u*u*u*p0.y+3*u*u*t*c[2]+3*u*t*t*c[4]+t*t*t*c[6]};};
   const samples=strokes=>strokes.map(rows=>{let from={x:0,y:0},begin=null;const arr=[];
      for(const c of rows){if(c[0]==='M'){from={x:c[1],y:c[2]};begin={...from};arr.push({...from});}
       if(c[0]==='L'||c[0]==='C'){for(let j=1;j<=16;j++)arr.push(point(from,c,j/16));
         from=c[0]==='L'?{x:c[1],y:c[2]}:{x:c[5],y:c[6]};}
       if(c[0]==='Z'&&begin){for(let j=1;j<=16;j++)arr.push({x:from.x+(begin.x-from.x)*j/16,y:from.y+(begin.y-from.y)*j/16});from=begin;}}
      return arr;});
   const compare=(a,b)=>{
      if(a.length!==b.length)return Infinity;
      const distance=(p,segments)=>{let best=Infinity;
        for(let j=1;j<segments.length;j++){
          const v=segments[j-1],w=segments[j],dx=w.x-v.x,dy=w.y-v.y;
          const m=Math.max(0,Math.min(1,((p.x-v.x)*dx+(p.y-v.y)*dy)/Math.max(1e-14,dx*dx+dy*dy)));
          best=Math.min(best,Math.hypot(p.x-v.x-m*dx,p.y-v.y-m*dy));}
        return best;};
      let max=0;for(let i=0;i<a.length;i++){
        for(const p of a[i])max=Math.max(max,distance(p,b[i]));
        for(const p of b[i])max=Math.max(max,distance(p,a[i]));
      }
      return max;};
   const clocks={},previous={mode:state.morph.mode,transition:state.morph.profileModeTransition,pct:state.morph.profileModeTransitionPercent,active:runtimeState.morph.active};
   runtimeState.morph.active=false;
   for(const m of ['phase','start','end'])for(const reverse of [false,true]){
      state.morph.mode='topology';state.morph.profileModeTransition=m;state.morph.profileModeTransitionPercent=50;
      const xs=[0,.001,.2,.49999,.50001,.8,.999,1].map(t=>samples(draw(t,reverse)));
      const midJump=compare(xs[3],xs[4]),endJump=compare(xs[6],xs[7]);
      if(midJump>.4||endJump>.4)throw Error('bent profile jump '+m+'/'+reverse+' '+midJump+'/'+endJump);
      const final=take();drawExactPolygonMorphEndpoint(final.ctx,resolveExactPolygonMorphEndpoint(reverse?source:target),1);
      const actual=take();drawAngularAnchorMorph(actual.ctx,base,reverse?target:source,reverse?source:target,1,1,'shortest','linear');
      if(JSON.stringify(final.strokes)!==JSON.stringify(actual.strokes))throw Error('terminal source differs from static '+m+'/'+reverse);
      clocks[m+(reverse?'Reverse':'Forward')]={midJump,endJump,paths:xs[7].length};
   }
   state.morph.mode=previous.mode;state.morph.profileModeTransition=previous.transition;state.morph.profileModeTransitionPercent=previous.pct;runtimeState.morph.active=previous.active;
   // The target endpoint must not be generated from the paired spline grid.
   const targetModified={...target,__morphExactProfileNodes:[{x:0,y:0},{x:.2,y:-.35},{x:.55,y:.35},{x:1,y:0}]};
   if(!isAuthoredProfileTransitionPair(source,targetModified))throw Error('different authored profile rejected');
   const changed=take();drawAngularAnchorMorph(changed.ctx,base,source,targetModified,1,1,'shortest','linear');
   const staticChanged=take();drawExactPolygonMorphEndpoint(staticChanged.ctx,resolveExactPolygonMorphEndpoint(targetModified),1);
   if(JSON.stringify(changed.strokes)!==JSON.stringify(staticChanged.strokes))throw Error('edited bent spline handoff');
   const s=take();drawExactPolygonMorphEndpoint(s.ctx,resolveExactPolygonMorphEndpoint(target),1);
   const e=take();drawAngularAnchorMorph(e.ctx,base,source,target,1,1,'shortest','linear');
   const exact=JSON.stringify(s.strokes)===JSON.stringify(e.strokes);
   if(!exact)throw Error('terminal path differs from actual static contour');
   return {clocks,exact};
  })()`,{label:'bent authored Spline+ profile handoff',timeoutMs:50000});
  assert(report.exact);assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS bent profile avoids midphase flag switch and terminal geometry jump',JSON.stringify(report));
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
