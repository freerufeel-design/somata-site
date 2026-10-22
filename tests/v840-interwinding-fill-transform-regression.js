// Somata 8.4: strict Spiral + Corridor interwinding Fill performance without geometry changes.
// The same test can be run on 8.3.0 with SOMATA_BASELINE=1 for numerical parity.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:24000});
  try{
    const result=await h.evaluate(`(()=>{
      const original=getMotionTunnelLagRadians;
      const oldTunnel=state.tunnel.active;
      let calls=0;
      window.getMotionTunnelLagRadians=function(...args){calls++;return original(...args);};
      try{
        state.tunnel.active=true;
        const layer=createLayer('v840-interwinding');
        layer.spiralEnabled=true;layer.spiralClosed=true;layer.spiralFillEnabled=true;
        layer.spiralFillType='interwinding';layer.fill=true;layer.N=12;layer.K=5;
        const branchCount=8,pointCount=128,copyCount=24;
        const paths=Array.from({length:branchCount},(_,branch)=>({
          spiralBranchIndex:branch,branchPhase:branch/branchCount,closed:false,
          points:Array.from({length:pointCount},(_,i)=>{
            const t=i/(pointCount-1),a=t*5.7+branch*.34,rad=50+branch*11+t*105;
            return{x:rad*Math.cos(a),y:rad*Math.sin(a)};
          })
        }));
        const copies=Array.from({length:copyCount},(_,i)=>({copyId:i,position:i+.12,scale:.96-i*.031}));
        const visibleInstances={copies,alphas:copies.map(()=>1),fillAlphas:copies.map(()=>1)};
        const frames=5, samples=[];let triangles=0,total=0;
        for(let frame=0;frame<frames;frame++){
          const f={frameId:8400+frame,layer,geometryPlan:{sourceData:{paths}},visibleInstances};
          const t0=performance.now(),mesh=FillMeshPreparer.prepareInterwindingCorridor(f,paths);
          if(!mesh?.fanFloatCount||!mesh.complete)throw Error('interwinding mesh missing on frame '+frame);
          total+=performance.now()-t0;triangles=mesh.fanTriangleCount;
          const data=mesh.fanData;
          let h1=2166136261>>>0,h2=0;
          const f32=new Float32Array(1),u32=new Uint32Array(f32.buffer);
          for(let i=0;i<mesh.fanFloatCount;i++){
            f32[0]=data[i];const x=u32[0];h1=Math.imul(h1^x,16777619)>>>0;h2=(h2+(Math.imul(x^i,2654435761)>>>0))>>>0;
          }
          samples.push([mesh.fanFloatCount,h1,h2]);
        }
        return{calls,triangles,checksum:samples,ms:total,pointsPerFrame:branchCount*copyCount*pointCount,expectedMinCalls:copyCount*frames,boot:window.__spiroAppBootComplete===true};
      }finally{window.getMotionTunnelLagRadians=original;state.tunnel.active=oldTunnel;}
    })()`,{label:'v840 interwinding transform mesh',timeoutMs:24000});
    if(!result.boot||!result.triangles||!result.checksum?.length)throw Error('empty/failed mesh: '+JSON.stringify(result));
    if(!process.env.SOMATA_BASELINE&&result.calls>result.expectedMinCalls)throw Error('motion angle recomputed inside point loop: '+JSON.stringify(result));
    const uncaught=uncaughtExceptions(h.events);if(uncaught.length)throw Error(uncaught.slice(0,3).join(' | '));
    console.log('V840_RESULT '+JSON.stringify(result));
  }finally{await h.close();}
})().catch(e=>{console.error('FAIL v840',e.stack||e);process.exitCode=1;});
