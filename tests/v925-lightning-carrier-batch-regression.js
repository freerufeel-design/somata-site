// Lightning reuses its authored profile and submits outer core/halo as one GPU record.
const fs=require('fs'),path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(v,m)=>{if(!v)throw Error(m)};
(async()=>{
 const root=path.join(__dirname,'..');
 const src=fs.readFileSync(path.join(root,'js/app/lamp-audio-core.js'),'utf8');
 const gpu=fs.readFileSync(path.join(root,'js/app/geometry-gpu-core.js'),'utf8');
 assert(/simplifyLightningStrokePieces\(exact\?\.pieces\|\|getLightningModePieces/.test(src),'both lightning frame paths must simplify prepared strike-only pieces');
 assert((src.match(/simplifyLightningStrokePieces\(exact\?\.pieces\|\|getLightningModePieces/g)||[]).length===2,'dynamic and static strike simplification must agree');
 assert(/SweepGPURenderer\.queueStroke\(ctx,pieces,outerW,outerColor,0,glowR,haloA\*/.test(src),'lightning glow must reuse the prepared stroke carrier without extra outer-core strokes');
 assert(/if\(v\.glowAlpha<=0\.0001\)\{discard;\}/.test(gpu)&&/if\(v\.coreAlpha<=0\.0001\)\{discard;\}/.test(gpu),'GPU stages must support shared core and halo records');
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:16000});
 try{
  const result=await h.evaluate(`(()=>{
    const L=state.layers[0];ensureLayerEffectState(L);const c=getLayerSweepConfig(L);c.enabled=true;c.lightningEnabled=true;c.glintEnabled=false;c.effectType='lightning';c.lightningMode='perPath';c.lightningPrecision='exact';c.lightningSegmentPercent=100;c.lightningRandomPosition=false;c.lightningAfterglow=false;c.lightningDurationMs=300;
    // A straight carrier must collapse to two endpoints; bends must remain.
    const line={points:Array.from({length:1001},(_,i)=>({x:i/2,y:15})),closed:false};
    const bent={points:Array.from({length:601},(_,i)=>{const t=i/100;return {x:i*.5,y:30+10*Math.sin(t)};}),closed:false};
    const run=(path,now)=>{const fc=acquireLayerFrameEffectContext(0);fc.layer=L;fc.effectLayer=L;fc.sourceLayer=L;fc.layerIndex=0;fc.frameId=1;fc.frame.id=1;fc.frame.now=now;fc.now=now;fc.frame.dpr=1;fc.layerSweep=c;fc.sweepPreparedReady=false;fc.sweepData=null;fc.prepared=true;fc.staticDrawData={};fc.frameContour=[path];const before=performance.now();const out=prepareLayerFrameSweepData(fc);return {t:performance.now()-before,points:(out?.prepared?.pieces||[]).reduce((v,p)=>v+p.length,0),segments:(out?.prepared?.pieces||[]).length,stage:out?.lightningVector?.stage||null};};
    // Exercise the simplifier itself through an isolated source-level export for validation.
    return {available:typeof prepareLayerFrameSweepData==='function',carrier:window.__somataLightningCarrierPolicy?.(),mode:c.lightningMode};
  })()`);
  assert(result.available&&result.carrier?.ordinary?.includes('prepared-path'),'prepared Lightning profile is unavailable');
  // Geometric reduction is tested on the exact helper source, not merely the UI toggle.
  const snippet=src.match(/function simplifyLightningStrokePieces\(pieces,precision='exact'\)\{[\s\S]*?\n        \}/)?.[0];
  assert(snippet,'lightning simplifier is missing');
  const simplify=new Function('lightningSimplifyMarks','lightningSimplifyStack','lightningSimplifyOutput',snippet+';return simplifyLightningStrokePieces;')([],[],[]) ;
  const straight=[Array.from({length:2001},(_,i)=>({x:i*.5,y:0}))];simplify(straight,'exact');assert(straight[0].length===2,'collinear geometry generated more than one GPU line');
  const points=Array.from({length:1501},(_,i)=>({x:i*.2,y:60*Math.sin(i*.2/63)})),curve=[points.slice()];simplify(curve,'exact');
  const simplified=curve[0];assert(simplified.length<points.length/2,'smooth profile did not reduce redundant samples');
  assert(simplified[0]===points[0]&&simplified[simplified.length-1]===points[points.length-1],'profile endpoints moved');
  let maxError=0,k=0;
  for(const p of points){while(k<simplified.length-2&&p.x>simplified[k+1].x)k++;const a=simplified[k],b=simplified[k+1],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));maxError=Math.max(maxError,Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy)));}
  assert(maxError<=.0751,`lightning deviated from its line carrier by ${maxError}`);
  assert(!uncaughtExceptions(h.events).length,'browser exceptions '+uncaughtExceptions(h.events).join(' | '));
  console.log('PASS lightning geometry upload: straight=2001->2, curve='+points.length+'->'+simplified.length+', error='+maxError.toFixed(5));
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL lightning geometry upload',e);process.exitCode=1;});
