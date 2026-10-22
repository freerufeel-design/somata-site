// Compare old view-based lookup with the new pass-scoped access to the SAME cache.
// Browser run does not render pixels; it measures only CPU glue overhead.
const {createBrowserHarness}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:13000});
 try{
 const r=await h.evaluate(`(()=>{
  const old={...state.tunnel};
  try{
   Object.assign(state.tunnel,{active:true,paletteLagEnabled:true,colorShiftEnabled:true,colorShiftCumulative:false});
   const layer=createLayer('lookup-bench');const copies=Array.from({length:160},(_,i)=>({scale:Math.max(.02,1-i/180),position:i+.32,copyId:i,colorIndex:i}));
   const view={frameId:1020,layer,sourceLayer:layer,effectLayer:layer,visibleInstances:{copies,alphas:copies.map(()=>1)},tunnelBaseStrokeColor:'#aabbdd',tunnelBaseFillColor:'#776633',tunnelPaletteProfile:resolveTunnelPaletteProfile('#aabbdd',layer),tunnelFillPaletteProfile:resolveTunnelPaletteProfile('#776633',layer)};
   function run(mode,frames){let sum=0;const start=performance.now();for(let f=0;f<frames;f++){
    view.frameId++;
    for(let pass=0;pass<3;pass++){
     const cache=mode==='batch'?SomataCorridorCopyFrame.batch(view):null;
     for(let i=0;i<copies.length;i++){
      const copy=copies[i];
      const stroke=mode==='batch'?SomataCorridorCopyFrame.strokeAt(cache,copy,i):SomataCorridorCopyFrame.stroke(view,copy,i);
      const fill=mode==='batch'?SomataCorridorCopyFrame.fillAt(cache,copy,i):SomataCorridorCopyFrame.fill(view,copy,i);
      const angle=mode==='batch'?SomataCorridorCopyFrame.rotationAt(cache,copy,i):SomataCorridorCopyFrame.rotation(view,copy,i);
      sum+=stroke.length+fill.length+angle;
     }
    }
   }return{ms:performance.now()-start,sum};}
   run('old',10);run('batch',10);
   const a=run('old',100),b=run('batch',100),c=run('batch',100),d=run('old',100);
   if(a.sum!==b.sum||a.sum!==c.sum||a.sum!==d.sum)throw Error('visual-value checksum changed');
   const oldMedian=(a.ms+d.ms)/2,newMedian=(b.ms+c.ms)/2;
   return{oldMs:+oldMedian.toFixed(2),batchMs:+newMedian.toFixed(2),ratio:+(oldMedian/newMedian).toFixed(3),checksum:a.sum,items:160*3*100};
  }finally{Object.assign(state.tunnel,old);}
 })()`,{timeoutMs:10000,label:'Corridor attributes lookup benchmark'});
 console.log('CANVAS_LOOKUP_BENCH_JSON '+JSON.stringify(r));
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
