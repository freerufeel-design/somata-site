// Run this identical benchmark file against 8.2 and 8.3. The baseline's
// fallback represents repeated per-copy work before the per-frame cache.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:12000});
 try{
  const r=await h.evaluate(`(()=>{
   const old={...state.tunnel};
   state.tunnel.active=true;state.tunnel.paletteLagEnabled=true;state.tunnel.colorShiftEnabled=true;
   try{
    const layer=createLayer('corridor-bench');
    const copies=Array.from({length:120},(_,i)=>({scale:1/(i+1),position:i+.33,copyId:i,colorIndex:i}));
    const ctx={frameId:1900,layer,sourceLayer:layer,effectLayerSource:layer,visibleInstances:{copies,alphas:copies.map(()=>1)},tunnelBaseStrokeColor:'#b79449',tunnelBaseFillColor:'#558cdd',tunnelPaletteProfile:resolveTunnelPaletteProfile('#b79449',layer),tunnelFillPaletteProfile:resolveTunnelPaletteProfile('#558cdd',layer)};
    const hasCache=!!window.SomataCorridorCopyFrame;
    function run(frames){let x=0;const begin=performance.now();for(let f=0;f<frames;f++){
      ctx.frameId++;
      for(let pass=0;pass<3;pass++){
        for(let i=0;i<copies.length;i++){
          const copy=copies[i];
          const a=hasCache?SomataCorridorCopyFrame.stroke(ctx,copy,i):getTunnelCopyColor(ctx.tunnelBaseStrokeColor,copy,ctx.tunnelPaletteProfile);
          const b=hasCache?SomataCorridorCopyFrame.fill(ctx,copy,i):getTunnelCopyColor(ctx.tunnelBaseFillColor,copy,ctx.tunnelFillPaletteProfile);
          const c=hasCache?SomataCorridorCopyFrame.rotation(ctx,copy,i):getMotionTunnelLagRadians(copy,layer);
          x+=a.length+b.length+c;
        }
      }
    }return{ms:performance.now()-begin,checksum:x};}
    run(10);const measurements=[run(100),run(100),run(100)];
    return{hasCache,measurements,medianMs:measurements.map(r=>r.ms).sort((a,b)=>a-b)[1],consistent:measurements.every(r=>r.checksum===measurements[0].checksum)};
   }finally{Object.assign(state.tunnel,old);}
  })()`,{timeoutMs:11000,label:'Corridor attributes benchmark'});
  if(!r.consistent||uncaughtExceptions(h.events).length)throw Error('benchmark failure');
  console.log('COPY_BENCH_JSON '+JSON.stringify(r));
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
