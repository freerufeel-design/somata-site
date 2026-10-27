'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:25000});
 try{
  const result=await h.evaluate(`(()=>{
    const base={spiralEnabled:true,spiralClosed:false,spiralOrder:1,spiralTangential:true,N:3,K:1,rounding:0,profileMode:'segments',profileNodes:[{x:0,y:0},{x:1,y:0}]};
    const s=Object.assign(createLayer('source'),base),d=Object.assign(createLayer('target'),{...base,N:4});
    const ctx=document.createElement('canvas').getContext('2d');
    const renderSample=(n)=>{
      const l={...s,N:Math.round(n),__spiralAnimatedN:n};const pts=[];
      const m=ctx.moveTo.bind(ctx),line=ctx.lineTo.bind(ctx);
      ctx.moveTo=(x,y)=>{pts.push({x,y});return m(x,y)};
      ctx.lineTo=(x,y)=>{pts.push({x,y});return line(x,y)};
      MorphRendering.drawAngularAnchorMorph(ctx,l,s,d,.5,1,'phase');
      return{n,coords:pts.slice(0,14),total:pts.length};
    };
    const draws=[3,3.25,3.49,3.5,3.51,3.75,4].map(renderSample);
    const resourceFor=(sourceOrder,targetOrder,sourceEnabled=true,targetEnabled=true)=>{
      const a={...s,spiralOrder:sourceOrder,spiralEnabled:sourceEnabled},b={...d,spiralOrder:targetOrder,spiralEnabled:targetEnabled};
      state.layers=[a];state.morph.mode='circleSlide';state.morph.spiralMorphType='phaseCircle';
      runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];runtimeState.morph.active=true;
      const r=WebGPUSpiralBezierMorphRenderer.debugBuildCpuResource(0);
      return{mapped:r?.carrierMapped,paths:r?.pathCount,cubics:r?.cubicCount,forceCartesian:r?.data?.[22],sourcePoint:r?.data?.slice(0,2).join(','),destPoint:r?.data?.slice(8,10).join(','),hasSource:r?.data?.[20],hasDest:r?.data?.[21],samples:r?.data?Array.from(r.data.slice(0,24)):null};
    };
    const polygonToSpiral=resourceFor(0,1),spiralToSpiral=resourceFor(1,1),ordinaryPolygonToSpiral=resourceFor(0,1,false,true);
    runtimeState.morph.active=false;
    return{draws,polygonToSpiral,spiralToSpiral,ordinaryPolygonToSpiral};
  })()`,{timeoutMs:24000,label:'drawn spiral 3->4 and polygon phase'});
  for(const d of result.draws){assert(d.total>12,JSON.stringify(d));for(const p of d.coords)assert(Number.isFinite(p.x)&&Number.isFinite(p.y));}
  // This checks the *drawn Canvas vertices*, not merely the calculated
  // carrier delta. At fixed transition progress, fractional N must reshape
  // the actual visible stroke across the former 3.5 rounding boundary.
  const drawnY=result.draws.map(row=>row.coords[7].y);
  assert(drawnY[0]-drawnY[drawnY.length-1]>90,'the shape did not morph from triangle to square');
  for(let i=1;i<drawnY.length;i++)assert(drawnY[i]<drawnY[i-1], 'rendered spiral profile stopped changing or reversed at fractional N');
  for(let i=1;i<result.draws.length;i++){
    const a=result.draws[i-1],b=result.draws[i];
    const j=6;const gap=Math.hypot(a.coords[j].x-b.coords[j].x,a.coords[j].y-b.coords[j].y);
    assert(gap<Math.max(45,Math.abs(a.n-b.n)*150),'angle jumped at fractional N '+JSON.stringify({from:a.n,to:b.n,gap}));
  }
  assert.equal(result.polygonToSpiral.mapped,false,'order 0 polygon was incorrectly sent down nonzero spiral carrier');
  assert.equal(result.polygonToSpiral.forceCartesian,1,'polygon -> spiral must interpolate the endpoints in XY');
  assert.equal(result.ordinaryPolygonToSpiral.mapped,false);
  assert.equal(result.ordinaryPolygonToSpiral.forceCartesian,1);
  assert.equal(result.spiralToSpiral.mapped,true,'true Spiral -> Spiral retains its phase-carrier');
  assert.equal(uncaughtExceptions(h.events).length,0);
  console.log('PASS: actual Canvas morph and polygon->spiral carrier routing',JSON.stringify({samples:result.draws.length,polygonToSpiral:result.polygonToSpiral.mapped,strictSpiral:result.spiralToSpiral.mapped}));
 }finally{await h.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1});
