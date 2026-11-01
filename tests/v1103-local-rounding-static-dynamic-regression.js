'use strict';
// A single transient hairpin in an animated contour must not turn off extra
// rounding around the entire shape. Original carrier transport is not touched.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:60000});
 try{
  const data=await h.evaluate(`(()=>{
   const pts=[{x:250,y:0},{x:210,y:60},{x:250,y:.01},{x:150,y:165},{x:0,y:250},
    {x:-150,y:165},{x:-250,y:0},{x:-150,y:-165},{x:0,y:-250},{x:150,y:-165}];
   const flags=pts.map(()=>true),before=transformSplineKnotsForRounding(pts,true,.85,flags),
    after=limitHighTurnExtraKnotSmoothing(pts,before,true,flags);
   const moved=(p,i)=>Math.hypot(p.x-pts[i].x,p.y-pts[i].y);
   const local=pts.map((_,i)=>({i,original:moved(before[i],i),limited:moved(after[i],i)}));
   const c=document.createElement('canvas');c.width=c.height=900;
   const ctx=c.getContext('2d',{willReadFrequently:true}),oldMode=state.morph.mode;
   const render=fn=>{ctx.resetTransform();ctx.clearRect(0,0,900,900);ctx.translate(450,450);
    ctx.strokeStyle='white';ctx.lineWidth=2;ctx.globalAlpha=1;ctx.__suppressFill=true;ctx.__suppressStroke=false;fn();
    const d=ctx.getImageData(0,0,900,900).data,pixels=new Uint8Array(810000);
    for(let i=0;i<pixels.length;i++)pixels[i]=d[i*4+3];return pixels;};
   const err=(a,b)=>{let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum/a.length;};
   const cases=[];
   try{for(const mode of ['circleSlide','topology','calm']){
    state.morph.mode=mode;
    for(const rounding of [35,90,130,190]){
     const from=createLayer('from'),to=createLayer('to');
     Object.assign(from,{N:8,K:1,customSuborbits:1,radius:270,rotation:440.1,rounding,
       profileMode:'segments',profileNodes:[{x:0,y:0},{x:1,y:0}],closedLoop:true,fill:false});
     Object.assign(to,{...from,id:'to',radius:285});
     const midway={...from,radius:277.5};
     // Radius is the simplest genuinely animated change. Identical rounding
     // before/after must generate *exactly* the same contour as Static.
     const actual=render(()=> (mode==='circleSlide'?drawCircleSlideMorph:drawLinearAnchorMorph)(ctx,midway,from,to,.5,1,'sector'));
     const wanted=render(()=>renderLayerOrbitPaths(ctx,midway));
     cases.push({mode,rounding,error:err(actual,wanted)});
    }
   }}finally{state.morph.mode=oldMode;}
   const topology=[];state.morph.mode='circleSlide';
   try{
    for(const [n,k] of [[7,1],[7,2],[6,3]]){
     const from=createLayer('from'),to=createLayer('to');
     Object.assign(from,{N:n,K:k,customSuborbits:1,radius:270,rotation:440.1,rounding:165,
       profileMode:'segments',profileNodes:[{x:0,y:0},{x:1,y:0}],closedLoop:true,fill:false});
     Object.assign(to,{...from,id:'to',N:8,K:1});
     // Count actual visible quadratic/cubic operations mid-Morph; they must
     // not silently revert to the raw unsmoothed straight-edged carrier.
     let curves=0;const q=ctx.quadraticCurveTo,c=ctx.bezierCurveTo;
     ctx.quadraticCurveTo=function(...args){curves++;return q.apply(this,args);};
     ctx.bezierCurveTo=function(...args){curves++;return c.apply(this,args);};
     try{render(()=>drawCircleSlideMorph(ctx,{...to},from,to,.5,1,'sector'));}
     finally{ctx.quadraticCurveTo=q;ctx.bezierCurveTo=c;}
     topology.push({from:n+'/'+k,curves});
    }
   }finally{state.morph.mode=oldMode;}
   // Exercise the actual Geometry -> Animation state machine, not merely the
   // shared drawing helper. An N 7 -> 8 edit keeps its 165% rounding at t=.5.
   const savedLayers=state.layers,savedId=state.activeLayerId,manual=[];
   try{
    const live=createLayer('live-edit-rounding');
    Object.assign(live,{N:7,K:1,customSuborbits:1,radius:270,rotation:440.1,
      rounding:165,profileMode:'segments',profileNodes:[{x:0,y:0},{x:1,y:0}],
      closedLoop:true,fill:false,testMorph:{enabled:true,mode:'circleSlide',slide:'sector',duration:1}});
    state.layers=[live];state.activeLayerId=live.id;
    SomataTestMorph.updateTask();
    live.N=8;
    const makeFrame=()=>({sourceLayer:live,layer:SomataRenderLayerSnapshot.create(live),layerIndex:0,
       blueMorphProvider:{active:false},orangeMorphProvider:{active:false},greenMorphProvider:{active:false}});
    const at=performance.now(),start=makeFrame();SomataTestMorph.applyFrame(start,at);
    const middle=makeFrame();SomataTestMorph.applyFrame(middle,at+500);
    let curves=0;const q=ctx.quadraticCurveTo,c=ctx.bezierCurveTo;
    ctx.quadraticCurveTo=function(...args){curves++;return q.apply(this,args);};
    ctx.bezierCurveTo=function(...args){curves++;return c.apply(this,args);};
    try{render(()=>drawCircleSlideMorph(ctx,middle.layer,middle.geometryProvider.sourceLayer,
      middle.geometryProvider.targetLayer,middle.geometryProvider.progress,1,'sector'));}
    finally{ctx.quadraticCurveTo=q;ctx.bezierCurveTo=c;}
    manual.push({provider:middle.geometryProvider?.kind,rounding:middle.layer.rounding,
      sourceN:middle.geometryProvider?.sourceLayer?.N,targetN:middle.geometryProvider?.targetLayer?.N,curves});
    const end=makeFrame();SomataTestMorph.applyFrame(end,at+1000);
   }finally{state.layers=savedLayers;state.activeLayerId=savedId;SomataTestMorph.updateTask();}
   return {local,cases,topology,manual};
  })()`,{label:'local rounding plus true mid-Morph parity',timeoutMs:60000});
  assert(data.local[1].limited<.01,'hairpin itself must not bulge');
  for(const i of [4,5,6,7,8,9]){
   assert(data.local[i].original>15,'test must visibly smooth distant corner '+i);
   assert(data.local[i].limited>data.local[i].original*.95,'remote rounding suppressed by unrelated hairpin: '+JSON.stringify(data.local[i]));
  }
  for(const c of data.cases)assert(c.error<.01,'static/dynamic rounding mismatch: '+JSON.stringify(c));
  for(const c of data.topology)assert(c.curves>=6,'moving N/K changed to unrounded rail: '+JSON.stringify(c));
  for(const c of data.manual){
    assert.equal(c.provider,'blue-circle-slide','finite geometry animation must use circle-slide carrier');
    assert.equal(c.rounding,165,'finite geometry animation must retain rounding at mid-phase');
    assert.equal(c.sourceN,7);assert.equal(c.targetN,8);
    assert(c.curves>=6,'manual Geometry -> Animation lost rounded joints: '+JSON.stringify(c));
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 11.0.3: isolated 180° guard, six unrelated corners retain extra rounding; 12 exact static/dynamic intermediate frames; 3 moving N/K profiles and a real 7->8 finite edit retain fillets');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v1103 dynamic rounding',e.stack||e);process.exitCode=1;});
