'use strict';
// User-facing policy: the whole-curve switch controls whether authored
// profile junctions are fitted as one spline or remain local/sharp, in both
// static and GPU Morph endpoint construction. No second Morph-only smoothing.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:150,evalTimeoutMs:60000});
 try{
  const res=await h.evaluate(`(()=>{
    const original={layers:state.layers,active:state.activeLayerId,src:runtimeState.morph.renderSourceLayers,dst:runtimeState.morph.renderTargetLayers};
    const results=[];
    const nodes=[{x:0,y:0},{x:.16,y:.33},{x:.50,y:-.29},{x:.79,y:.21},{x:1,y:0}];
    const flatten=cs=>(cs||[]).flatMap(q=>[q.p0.x,q.p0.y,q.c1.x,q.c1.y,q.c2.x,q.c2.y,q.p3.x,q.p3.y]);
    const sample=(cs)=>{const ret=[];for(const q of cs||[])for(let i=0;i<=8;i++){
      const t=i/8,u=1-t;ret.push({x:u*u*u*q.p0.x+3*u*u*t*q.c1.x+3*u*t*t*q.c2.x+t*t*t*q.p3.x,
        y:u*u*u*q.p0.y+3*u*u*t*q.c1.y+3*u*t*t*q.c2.y+t*t*t*q.p3.y});
    }return ret;};
    const dist=(aa,bb)=>{const A=sample(aa),B=sample(bb);if(!A.length||!B.length)return Infinity;
      const directed=(a,b)=>Math.max(...a.map(q=>Math.min(...b.map(p=>Math.hypot(p.x-q.x,p.y-q.y)))));
      return Math.max(directed(A,B),directed(B,A));};
    try{
      const p=[{x:0,y:0},{x:1,y:-.7},{x:2,y:0},{x:3,y:.7},{x:4,y:0}],flags=[false,false,true,false,false];
      const collect=whole=>{
        const steps=[];
        const rec={moveTo:(x,y)=>steps.push(['M',x,y]),lineTo:(x,y)=>steps.push(['L',x,y]),
          bezierCurveTo:(a,b,c,d,x,y)=>steps.push(['C',a,b,c,d,x,y]),
          closePath:()=>steps.push(['Z'])};
        splinePathForDraw(rec,p,false,0,flags,[],whole);
        return steps;
      };
      const piecewise=collect(false),global=collect(true);
      results.push({polygon:true,local:piecewise,whole:global,
        curved:piecewise.some(x=>x[0]==='C')&&global.some(x=>x[0]==='C'),
        changed:JSON.stringify(piecewise)!==JSON.stringify(global),
        // Local spline must preserve a hard run boundary; whole mode must
        // create a differentiable spline across the same authored junction.
        localHasJunctionLine:piecewise.some(x=>x[0]==='L'&&Math.abs(x[1]-2)<1e-8)});
      const input=document.getElementById('paramWholeCurveSpline');
      const layer=createLayer('WholeCurveSpline');
      Object.assign(layer,{N:4,K:1,spiralEnabled:true,spiralOrder:1,spiralClosed:true,spiralRoundSeams:true,
        rounding:40,profileMode:'spline',radius:220,spiralTangential:true,profileNodes:nodes});
      state.layers=[layer];state.activeLayerId=layer.id;syncSidebarInputs();
      results.push({ui:!!input,defaultOff:input?.checked===false,defaultProp:layer.wholeCurveSpline===false});
      const spec={radius:220,delta:Math.PI/2,targetScale:1.24,tangential:1,
        closed:true,roundSeams:true,roundingFrac:.40,profileNodes:nodes};
      const build=()=>__spiroBuildSpiralCarrierPath(layer,{x:220,y:0},spec);
      const local=build();
      input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));
      const whole=build();
      input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));
      const localAgain=build();
      results.push({localCount:local._bezierSegments.length,wholeCount:whole._bezierSegments.length,
        localStable:JSON.stringify(flatten(local._bezierSegments))===JSON.stringify(flatten(localAgain._bezierSegments)),
        differingCurve:dist(local._bezierSegments,whole._bezierSegments),
        storeFalse:layer.wholeCurveSpline===false});
      for(const enabled of [false,true]){
        const a=createLayer('a'),b=createLayer('b');
        Object.assign(a,layer,{profileNodes:nodes,wholeCurveSpline:enabled});
        Object.assign(b,a,{profileNodes:nodes.map((p,i)=>({...p,y:p.y*(i%2?-.7:1.5)}))});
        state.layers=[a];runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];
        const p0=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,0),
              pm=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,.5),
              p1=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,1);
        const f0=p0.carrierFrames?.[0],f1=p1.carrierFrames?.[0];
        const ref=(layer,fr)=>__spiroBuildSpiralCarrierPath(layer,fr.anchor,{
          radius:220,delta:fr.delta,targetScale:fr.targetScale,tangential:fr.tangential,
          closed:true,roundSeams:true,roundingFrac:.40,profileNodes:layer.profileNodes
        })._bezierSegments;
        const startRef=ref(a,f0),endRef=ref(b,f1);
        results.push({enabled,start:p0?.paths?.[0]?.length,middle:pm?.paths?.[0]?.length,end:p1?.paths?.[0]?.length,
          finite:pm?.paths?.[0]?.every(q=>[q.p0,q.c1,q.c2,q.p3].every(p=>Number.isFinite(p.x+p.y))),
          change:dist(p0?.paths?.[0],p1?.paths?.[0]),
          staticStartDistance:dist(p0?.paths?.[0],startRef),staticEndDistance:dist(p1?.paths?.[0],endRef)});
      }
    }finally{state.layers=original.layers;state.activeLayerId=original.active;
      runtimeState.morph.renderSourceLayers=original.src;runtimeState.morph.renderTargetLayers=original.dst;}
    return results;
  })()`,{label:'single whole-curve spline checkbox and consistent static / Morph rail'});
  assert(res[0].polygon&&res[0].curved&&res[0].changed&&res[0].localHasJunctionLine,'Polygon local vs full spline differ: '+JSON.stringify(res[0]));
  assert(res[1].ui&&res[1].defaultOff&&res[1].defaultProp,'new checkbox missing or defaults incorrectly: '+JSON.stringify(res[1]));
  assert(res[2].storeFalse&&res[2].localStable,'turning checkbox off does not restore local spline: '+JSON.stringify(res[2]));
  assert(res[2].differingCurve>.05,'on/off must visibly change the built spline: '+JSON.stringify(res[2]));
  for(const x of res.slice(3))assert(x.start>0&&x.middle>0&&x.end>0&&x.finite&&x.change>.1&&x.staticStartDistance<4&&x.staticEndDistance<4,'Morph invalid: '+JSON.stringify(x));
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10448: UI defaults off, local/whole curves differ, static toggle round-trip, both Morph modes finite');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v10448',e.stack||e);process.exitCode=1});
