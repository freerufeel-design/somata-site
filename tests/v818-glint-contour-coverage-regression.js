const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(v,m)=>{if(!v)throw new Error(m)};
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120});try{
const r=await h.evaluate(`(()=>{
 const l=state.layers[0],fresh=createLayer(),cfg={...getLayerSweepConfig(l),enabled:true,glintEnabled:true,effectType:'glint',mode:'perPath',lengthPercent:18};
 const paths=[0,1,2].map(i=>({points:[{x:i*200,y:0},{x:i*200+100,y:0},{x:i*200+100,y:100}],closed:false}));
 const prepared=getPreparedSweepFrame(paths,l,.38,1200,cfg,0);
 const pieceCount=prepared.pieces.length;
 const hit=new Set((prepared.pieces||[]).map(piece=>Math.floor((Number(piece?.[0]?.x)||0)/200)));
 const segmentCfg={...cfg,mode:'perSegment'};
 const eachSegment=getPreparedSweepFrame(paths,l,.38,1202,segmentCfg,0);
 const segmentPieces=eachSegment.pieces.length;
 const segmentHit=[...new Set(eachSegment.pieces.map(piece=>Math.floor((Number(piece?.[0]?.x)||0)/200)))].sort();
 const oldCfg={...cfg,mode:'whole'};
 const previous=getPreparedSweepFrame(paths,l,.38,1201,oldCfg,0);
 const cfgByLayer=state.layers.slice(0,3).map(layer=>{const c=getLayerSweepConfig(layer);return {mode:c.mode,glint:c.glintEnabled}});
 return{defaultMode:fresh.sweep.mode,contourCount:prepared.visible.length,pieces:pieceCount,segmentPieces,segmentHit,hit:[...hit].sort(),wholeMode:previous.mode||oldCfg.mode,byLayer:cfgByLayer};
})()`);
assert(r.defaultMode==='perPath','New Glint mode must cover each independent contour: '+JSON.stringify(r));
assert(r.contourCount===3&&r.pieces>=3&&r.hit.join(',')==='0,1,2','Glint misses an independent contour: '+JSON.stringify(r));
assert(r.segmentPieces>=6&&r.segmentHit.join(',')==='0,1,2','Explicit per-segment Glint must reach all contours: '+JSON.stringify(r));
assert(r.wholeMode==='whole','Previously authored whole-mode must remain supported');
assert(uncaughtExceptions(h.events).length===0,'Uncaught browser errors');
console.log('V818 GLINT CONTOUR COVERAGE: PASS',JSON.stringify(r));
}finally{await h.close()}})().catch(e=>{console.error('V818 GLINT CONTOUR COVERAGE: FAIL',e.stack||e);process.exit(1)});
