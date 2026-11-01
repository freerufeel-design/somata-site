'use strict';
// Finite Geometry > Animation: live edit starts at the current authored contour,
// finishes at the destination contour, then holds the same deterministic static frame.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:130,evalTimeoutMs:60000});
 try{
  const out=await h.evaluate(`(()=>{
   const saved={layers:state.layers,id:state.activeLayerId,blue:runtimeState.morph.active};
   const c=document.createElement('canvas');c.width=500;c.height=500;
   const ctx=c.getContext('2d',{willReadFrequently:true});
   const draw=frame=>{ctx.resetTransform();ctx.clearRect(0,0,500,500);ctx.translate(250,250);
    ctx.lineWidth=2;ctx.strokeStyle='white';ctx.__suppressFill=true;
    if(frame.geometryProvider){const p=frame.geometryProvider,slide=p.kind==='blue-circle-slide';
      (slide?drawCircleSlideMorph:drawLinearAnchorMorph)(ctx,frame.layer,p.sourceLayer,p.targetLayer,p.progress,1,p.slideTypeOverride);
    }else renderLayerOrbitPaths(ctx,frame.layer);
    const rgba=ctx.getImageData(0,0,500,500).data,a=new Uint8Array(250000);
    for(let i=0;i<a.length;i++)a[i]=rgba[i*4+3];return a;
   };
   const diff=(a,b)=>{let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum/a.length;};
   const frame=layer=>({sourceLayer:layer,layer:SomataRenderLayerSnapshot.create(layer),
     blueMorphProvider:{active:false},orangeMorphProvider:{active:false},greenMorphProvider:{active:false}});
   const results=[];
   try{
    runtimeState.morph.active=false;
    for(const mode of ['topology','calm','circleSlide'])for(const profile of ['segments','spline'])
     for(const change of ['rounding','nodes','topology']){
      const layer=createLayer('v11-static-'+mode+'-'+profile+'-'+change);
      Object.assign(layer,{N:7,K:2,radius:175,spiralEnabled:false,closedLoop:true,profileMode:profile,
       profileNodes:[{x:0,y:0},{x:.19,y:.38},{x:.45,y:-.18},{x:.71,y:.33},{x:1,y:0}],
       rounding:70,fill:false,roundingMode:'standard',testMorph:{enabled:true,mode,duration:1}});
      state.layers=[layer];state.activeLayerId=layer.id;SomataTestMorph.updateTask();
      const from=frame(layer);const before=draw(from);
      if(change==='rounding')layer.rounding=18;
      if(change==='nodes')layer.profileNodes=[{x:0,y:0},{x:.08,y:-.3},{x:.26,y:.23},{x:.56,y:-.36},{x:1,y:0}];
      if(change==='topology'){layer.N=9;layer.K=3;}
      const now=performance.now();
      const start=frame(layer),result0=SomataTestMorph.applyFrame(start,now);
      const at0=draw(start);
      const nearStart=frame(layer);SomataTestMorph.applyFrame(nearStart,now+.01);
      const nearStartPixels=draw(nearStart);
      const mid=frame(layer);SomataTestMorph.applyFrame(mid,now+500);
      const nearEnd=frame(layer);SomataTestMorph.applyFrame(nearEnd,now+999.99);
      const nearEndPixels=draw(nearEnd);
      const atEnd=frame(layer);SomataTestMorph.applyFrame(atEnd,now+1000);
      const end=draw(atEnd);
      const staticFrame=frame(layer);const staticPixels=draw(staticFrame);
      const idle=frame(layer),running=SomataTestMorph.applyFrame(idle,now+1001);
      const idlePixels=draw(idle);
      results.push({mode,profile,change,result0,startDiff:diff(before,at0),
       nearStartDiff:diff(before,nearStartPixels),nearEndDiff:diff(nearEndPixels,staticPixels),
       endDiff:diff(end,staticPixels),idleDiff:diff(end,idlePixels),
       stopped:!SomataTestMorph.status().active&&!running,
       midKind:mid.geometryProvider?.kind,firstKind:start.geometryProvider?.kind});
     }
   }finally{state.layers=saved.layers;state.activeLayerId=saved.id;runtimeState.morph.active=saved.blue;SomataTestMorph.updateTask();}
   return results;
  })()`,{label:'manual Geometry animation exact endpoints',timeoutMs:60000});
  for(const c of out)if(c.startDiff>=.08||c.nearStartDiff>=.08||c.nearEndDiff>=.08||c.endDiff>=.08||c.idleDiff>=.08)console.log(JSON.stringify(c));
  for(const c of out){
    assert(c.result0&&c.stopped,'Manual animation must start and stop: '+JSON.stringify(c));
    assert(c.startDiff<.08&&c.nearStartDiff<.08,'Manual animation changed initial contour: '+JSON.stringify(c));
    assert(c.endDiff<.08&&c.nearEndDiff<.08,'Last tween frame differs from authored static: '+JSON.stringify(c));
    assert(c.idleDiff<.08,'Stopped animation snaps on its next frame: '+JSON.stringify(c));
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v11 finite manual edits: 18 mode/profile/rounding/node/topology scenarios; exact start and stopped endpoints');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v11 static animation endpoint',e.stack||e);process.exitCode=1;});
