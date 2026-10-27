'use strict';
// The closed Spiral can keep Fill topology without a separate seam correction.
// The static Fill contour must sample the very same prepared Bezier branches as Base.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:140,evalTimeoutMs:45000});
 try{
  const data=await h.evaluate(`(()=>{
   const results=[];
   const flat=c=>(c||[]).flatMap(q=>[q.p0.x,q.p0.y,q.c1.x,q.c1.y,q.c2.x,q.c2.y,q.p3.x,q.p3.y]);
   const md=(a,b)=>a.length!==b.length?Infinity:a.reduce((m,v,i)=>Math.max(m,Math.abs(v-b[i])),0);
   const P=(p,t)=>{const u=1-t;return{x:u*u*u*p.p0.x+3*u*u*t*p.c1.x+3*u*t*t*p.c2.x+t*t*t*p.p3.x,y:u*u*u*p.p0.y+3*u*u*t*p.c1.y+3*u*t*t*p.c2.y+t*t*t*p.p3.y};};
   for(const profileMode of ['segments','spline'])for(const tangent of [false,true]){
    const layer=createLayer('join-mode-test');Object.assign(layer,{N:8,K:3,spiralEnabled:true,spiralOrder:2.5,
     spiralClosed:true,spiralRoundSeams:true,spiralJoinInterpolation:false,spiralTangential:tangent,
     radius:220,rounding:65,profileMode,profileNodes:[{x:0,y:0},{x:.31,y:-.4},{x:.62,y:.33},{x:1,y:0}]});
    const anchors=[{x:220,y:0},{x:150,y:120}];
    const mk=(closed,join,anchor)=>{layer.spiralClosed=closed;layer.spiralJoinInterpolation=join;
      return __spiroBuildSpiralCarrierPath(layer,anchor,{radius:220,delta:1.05,targetScale:1.4,
       tangential:tangent?1:0,closed,roundSeams:true,roundingFrac:.65});};
    const a=mk(false,false,anchors[0]),b=mk(true,false,anchors[0]),c=mk(true,true,anchors[0]);
    const other=mk(true,false,anchors[1]);
    // Closed stays semantically eligible for Fill, even though its Base rail equals open Base.
    layer.spiralClosed=true;layer.spiralJoinInterpolation=false;layer.spiralFillEnabled=true;layer.fill=true;
    a.spiralBranchIndex=0;b.spiralBranchIndex=0;other.spiralBranchIndex=1;
    const contours=FillMeshPreparer.buildSpiralBandContours({paths:[b,other]},layer);
    const first=contours?.[0]?.points||[];const segs=b._bezierSegments||[];
    // The first rail's internal cubic knot is present in Fill; the old sampler omitted it.
    const firstKnot=segs[1]?.p0,nearest=firstKnot?first.reduce((d,p)=>Math.min(d,Math.hypot(p.x-firstKnot.x,p.y-firstKnot.y)),Infinity):Infinity;
    results.push({profileMode,tangent,openClosedDifference:md(flat(a._bezierSegments),flat(b._bezierSegments)),
      optionalJoinDifference:md(flat(b._bezierSegments),flat(c._bezierSegments)),
      available:segs.length,fillComplete:contours?.length===1,fillPointCount:first.length,nearestKnot:nearest,
      endpoint:segs[segs.length-1]?.p3,fillStart:first[0]});
   }
   return {results,defaultChecked:createLayer('default-test').spiralJoinInterpolation===true,
      checkbox:!!document.getElementById('paramSpiralJoinInterpolation'),
      parameter:SomataParameterRegistry.get('spiral.joinInterpolation')?.morph?.framePath||null};
  })()`,{label:'closed/open Base contour and Fill sharing'});
  assert.equal(data.defaultChecked,false,'new/legacy layers should default to seam interpolation OFF');
  assert.equal(data.checkbox,true);assert.equal(data.parameter,'spiralJoinInterpolation');
  assert.equal(data.results.length,4);
  for(const x of data.results){
   assert(x.available>0,'missing Bezier segments: '+JSON.stringify(x));
   assert(x.openClosedDifference<1e-8,'OFF closed Spiral differs from open Base rail: '+JSON.stringify(x));
   assert(x.fillComplete&&x.fillPointCount>8,'closed Spiral lost band Fill: '+JSON.stringify(x));
   assert(x.nearestKnot<1e-8,'Fill does not include real line Bezier join: '+JSON.stringify(x));
  }
  assert(data.results.some(x=>x.optionalJoinDifference>1e-5),'ON seam interpolation does not restore distinct closure for any case');
  const ui=await h.evaluate(`(()=>{
    const old={layers:state.layers,active:state.activeLayerId};
    try{
      const layer=createLayer('qa-real-ui-join');Object.assign(layer,{spiralEnabled:true,spiralOrder:2,spiralClosed:true});
      state.layers=[layer];state.activeLayerId=layer.id;
      if(typeof setSingleLayerSelection==='function')setSingleLayerSelection(layer);
      syncSidebarInputs();
      const input=document.getElementById('paramSpiralJoinInterpolation');
      const initial={checked:input.checked,value:layer.spiralJoinInterpolation};
      input.click();const after={checked:input.checked,value:layer.spiralJoinInterpolation};
      input.click();const back={checked:input.checked,value:layer.spiralJoinInterpolation};
      return {initial,after,back};
    }finally{state.layers=old.layers;state.activeLayerId=old.active;}
  })()`,{label:'real spiral seam toggle click'});
  assert.deepEqual(ui.initial,{checked:false,value:false});
  assert.deepEqual(ui.after,{checked:true,value:true});
  assert.deepEqual(ui.back,{checked:false,value:false});
  const morph=await h.evaluate(`(()=>{
    const save={layers:state.layers,source:runtimeState.morph.renderSourceLayers,target:runtimeState.morph.renderTargetLayers,spiral:state.morph.spiralMorphType};
    const flat=ps=>(ps||[]).flatMap(path=>path.flatMap(q=>[q.p0.x,q.p0.y,q.c1.x,q.c1.y,q.c2.x,q.c2.y,q.p3.x,q.p3.y]));
    const diff=(a,b)=>a.length!==b.length?Infinity:a.reduce((m,v,i)=>Math.max(m,Math.abs(v-b[i])),0);
    const results=[];
    try{
      state.morph.spiralMorphType='continuous';
      for(const pm of ['segments','spline'])for(const t of [0,.25,.6,.999999,1]){
        const a=createLayer('from'),b=createLayer('to');
        Object.assign(a,{N:8,K:3,spiralEnabled:true,spiralClosed:false,spiralJoinInterpolation:false,spiralOrder:2.4,spiralStepLinked:false,spiralStep:2,rounding:45,profileMode:pm,profileNodes:[{x:0,y:0},{x:.3,y:.22},{x:.7,y:-.18},{x:1,y:0}]});
        Object.assign(b,a,{spiralOrder:2.7,radius:240,profileNodes:[{x:0,y:0},{x:.22,y:-.28},{x:.64,y:.26},{x:1,y:0}]});
        state.layers=[a];runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];
        const open=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,t);
        a.spiralClosed=true;b.spiralClosed=true;
        const closed=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,t);
        results.push({pm,t,difference:diff(flat(open?.paths),flat(closed?.paths)),openPaths:open?.paths?.length,closedPaths:closed?.paths?.length});
      }
    }finally{state.layers=save.layers;runtimeState.morph.renderSourceLayers=save.source;runtimeState.morph.renderTargetLayers=save.target;state.morph.spiralMorphType=save.spiral;}
    return results;
  })()`,{label:'Morph closed without joins equals open geometry'});
  assert.equal(morph.length,10);
  for(const r of morph)assert(r.openPaths>0&&r.openPaths===r.closedPaths&&r.difference<1e-6,'Morph closed/open divergent: '+JSON.stringify(r));
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10441: unchecked closed/open Bezier equality; opt-in join corrections; static Fill follows Base cubic knots');
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL v10441',err.stack||err);process.exitCode=1;});
