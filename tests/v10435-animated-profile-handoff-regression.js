'use strict';
// Real authored 'Animation' edits and Blue Polygon spline->spline Morph must
// interpolate the final curve, not freeze the old knots until the last frame.
// A nonzero Spiral continuous edit must keep the exact GPU Bézier pair rather
// than silently substituting an opacity-only fade.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:130,evalTimeoutMs:35000});
 try{
  const result=await h.evaluate(`(()=>{
   const old={layers:state.layers,activeLayer:state.activeLayerId,transition:state.morph.profileModeTransition,
    percent:state.morph.profileModeTransitionPercent,fourier:state.fourierMode};
   const oldBegin=WebGPUSpiralBezierMorphRenderer.beginStaticEdit;
   const output={};
   const approx=(a,b)=>Math.abs(a-b)<1e-6;
   const clone=v=>JSON.parse(JSON.stringify(v));
   const snap=(layer,time)=>{
    const copy=SomataRenderLayerSnapshot.create(layer);
    const frame={layer:copy,sourceLayer:layer,layerIndex:0,
     blueMorphProvider:{active:false},orangeMorphProvider:{active:false},greenMorphProvider:{active:false}};
    SomataTestMorph.applyFrame(frame,time);
    return{nodes:clone(copy.profileNodes),opacity:copy.opacity,kind:frame.geometryProvider?.kind||'none',
      exactPair:!!frame.spiralEditMorph,diagnostics:clone(SomataTestMorph.status().last)};
   };
   const extract=(ctx)=>ctx.commands.filter(c=>c[0]==='B').flatMap(c=>c.slice(1));
   const recorder=()=>({commands:[],save(){},restore(){},beginPath(){},moveTo(...p){this.commands.push(['M',...p]);},
    lineTo(...p){this.commands.push(['L',...p]);},bezierCurveTo(...p){this.commands.push(['B',...p]);},
    closePath(){},stroke(){},get globalAlpha(){return 1;},set globalAlpha(x){},get __suppressFill(){return true;}});
   try{
    state.fourierMode=false;
    const p=createLayer('v10435-static-poly');
    Object.assign(p,{N:7,K:2,radius:220,rounding:45,spiralEnabled:false,
     profileMode:'spline',opacity:100,profileNodes:[{x:0,y:0},{x:.19,y:.3},{x:.5,y:-.4},{x:.78,y:.1},{x:1,y:0}],
     testMorph:{enabled:true,mode:'circleSlide',slide:'phase',duration:1}});
    state.layers=[p];state.activeLayerId=p.id;
    SomataTestMorph.updateTask();
    snap(p,10000); // Seed before the authored edit, without animating.
    const from=clone(p.profileNodes);
    p.profileNodes=[{x:0,y:0},{x:.47,y:-.6},{x:1,y:0}];
    const to=clone(p.profileNodes);
    snap(p,10500); // Begin the edit, t=0
    const early=snap(p,10750),late=snap(p,11490),end=snap(p,11520);
    output.animation={fromLength:from.length,toLength:to.length,earlyLength:early.nodes.length,
      nearLength:late.nodes.length,earlyY:early.nodes.map(x=>x.y),lateY:late.nodes.map(x=>x.y),
      endMatches:JSON.stringify(end.nodes)===JSON.stringify(to),
      kind:early.kind,activeAfter:SomataTestMorph.status().active};
    // Same-count spline knots used to bypass the exact-bezier path and ignore
    // the user's curvature phase. It should now interpolate actual controls.
    const a=createLayer('v10435-src'),b=createLayer('v10435-dst');
    Object.assign(a,{N:7,K:2,radius:220,spiralEnabled:false,rounding:45,
      profileMode:'spline',closedLoop:true,fill:false,
      profileNodes:[{x:0,y:0},{x:.2,y:.45},{x:.5,y:-.2},{x:.8,y:.13},{x:1,y:0}]});
    Object.assign(b,a,{id:'v10435-dst',profileNodes:[{x:0,y:0},{x:.2,y:-.3},{x:.5,y:.4},{x:.8,y:-.22},{x:1,y:0}]});
    state.morph.profileModeTransitionPercent=30;
    output.polygon={};
    for(const phase of ['phase','start','end']){
      state.morph.profileModeTransition=phase;
      output.polygon[phase]=[0,.45,.99999,1].map(t=>{
       const ctx=recorder();drawAngularAnchorMorph(ctx,b,a,b,t,1,'phase','angular');return extract(ctx);
      });
    }
    const diff=(a,b)=>a.length===b.length&&a.length?
      a.reduce((m,v,i)=>Math.max(m,Math.abs(v-b[i])),0):Infinity;
    output.polyDiff={middle:diff(output.polygon.start[1],output.polygon.end[1]),
      start:diff(output.polygon.start[0],output.polygon.end[0]),
      end:diff(output.polygon.start[3],output.polygon.end[3]),
      near:diff(output.polygon.phase[2],output.polygon.phase[3]),
      points:output.polygon.phase[3].length};
    // Confirm that nonzero continuous Spiral edits select the GPU geometry
    // rather than an invisible 2-endpoint opacity fade.
    const spiral=createLayer('v10435-spiral');
    Object.assign(spiral,{N:7,K:2,radius:220,opacity:100,spiralEnabled:true,spiralOrder:3,
      spiralClosed:true,spiralTangential:true,profileMode:'spline',
      profileNodes:clone(from),testMorph:{enabled:true,mode:'circleSlide',spiralType:'continuous',duration:1}});
    state.layers=[spiral];state.activeLayerId=spiral.id;
    SomataTestMorph.updateTask();snap(spiral,20000);
    spiral.profileNodes=clone(to);
    let begins=0;
    WebGPUSpiralBezierMorphRenderer.beginStaticEdit=function(i,pair){begins++;return true;};
    snap(spiral,20500);
    const mid=snap(spiral,21000);
    output.spiral={begins,pair:mid.exactPair,forcedFade:mid.diagnostics?.forcedContinuousFade,
      opacity:mid.opacity,renderKind:mid.kind};
   }finally{
    WebGPUSpiralBezierMorphRenderer.beginStaticEdit=oldBegin;
    state.layers=old.layers;state.activeLayerId=old.activeLayer;
    state.morph.profileModeTransition=old.transition;
    state.morph.profileModeTransitionPercent=old.percent;
    state.fourierMode=old.fourier;
    SomataTestMorph.updateTask();
   }
   return{animation:output.animation,polyDiff:output.polyDiff,spiral:output.spiral};
  })()`,{label:'static Animation uneven knots + exact nonfade Spiral + Blue polygon spline handles'});
  assert(result.animation.earlyLength===result.animation.nearLength&&result.animation.earlyLength>=5,
   'authored Animation did not use a stable normalized knot representation: '+JSON.stringify(result.animation));
  assert(result.animation.earlyY.some((v,i)=>Math.abs(v-result.animation.lateY[i])>.01),
   'authored Animation profile is frozen until the last frame: '+JSON.stringify(result.animation));
  assert(result.animation.endMatches&&!result.animation.activeAfter,'authored target must settle exactly: '+JSON.stringify(result.animation));
  assert(result.animation.kind==='blue-circle-slide','Polygon Animation did not use the actual geometry provider');
  assert(result.polyDiff.points>40&&result.polyDiff.middle>1,
   'Blue Polygon spline curvature ignores Beginning/End schedule: '+JSON.stringify(result.polyDiff));
  assert(result.polyDiff.start<1e-6&&result.polyDiff.end<1e-6&&result.polyDiff.near<.2,
   'Polygon exact endpoint or near-end curve differs: '+JSON.stringify(result.polyDiff));
  assert(result.spiral.begins>0&&result.spiral.pair&&result.spiral.forcedFade===false&&result.spiral.opacity===100,
   'continuous nonzero Spiral edit was replaced by an opacity-only fade: '+JSON.stringify(result.spiral));
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10435: Animation knot transition, Blue Polygon spline curvature timeline, continuous Spiral exact GPU pair');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v10435',e.stack||e);process.exitCode=1;});
