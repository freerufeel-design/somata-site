'use strict';
// Differential test: Spiral topology preflight and Fill contour/copy fast paths.
const assert = require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions} = require('./lib/browser-harness');
(async()=>{
  const h = await createBrowserHarness({disableGpu:true,loadDelayMs:150,evalTimeoutMs:20000});
  try {
    const r = await h.evaluate(`(()=>{
      const prevTunnel=state.tunnel.active;
      const layer=createLayer('qa-spiral-fill-10413');
      Object.assign(layer,{spiralEnabled:true,spiralClosed:true,spiralFillEnabled:true,
        spiralFillType:'interwinding',fill:true,N:10,K:3,spiralOrder:2,spiralStepLinked:false});
      const path=(branch, count=9, phase=0)=>({
        closed:false,alpha:1,spiralBranchIndex:branch,branchPhase:branch/8,
        points:Array.from({length:count},(_,i)=>{
          const a=(branch*.27)+(i*.095)+phase, radius=42+branch*2+i*5;
          return {x:Math.cos(a)*radius,y:Math.sin(a)*radius};
        })
      });
      const info=m=>m?{complete:m.complete,fanFloatCount:m.fanFloatCount,
        fanTriangleCount:m.fanTriangleCount,anchor:m.anchor,
        data:Array.from((m.fanData||[]).subarray(0,m.fanFloatCount||0))}:null;
      const out={};
      try {
        out.topology=[];
        for(const count of [0,1,2,3,4,7,8,12]){
          const paths=Array.from({length:count},(_,i)=>path(count-i));
          if(count>=3)paths.splice(1,0,{closed:true,points:path(31).points});
          if(count>=4)paths.push({closed:false,points:[{x:0,y:0}]});
          const input={paths};
          const before=paths.map(x=>x.spiralBranchIndex??null);
          out.topology.push({count,ok:FillMeshPreparer.hasSpiralBandTopology(input,layer),
            intact:JSON.stringify(paths.map(x=>x.spiralBranchIndex??null))===JSON.stringify(before)});
        }
        // Topology preflight must not call Array.filter/sort or allocate paths.
        // On this ordinary Array a deliberately overridden filter would fail.
        const guarded=[path(0),path(1),path(2),path(3)];
        guarded.filter=()=>{throw new Error('topology preflight unexpectedly filtered paths');};
        out.fastpath=FillMeshPreparer.hasSpiralBandTopology({paths:guarded},layer);
        out.disabled=[];
        for(const change of [{spiralFillEnabled:false},{spiralClosed:false},{spiralEnabled:false}]){
          const l={...layer,...change};
          out.disabled.push(FillMeshPreparer.hasSpiralBandTopology({paths:[path(0),path(1)]},l));
        }
        out.bands=[];
        for(const n of [4,8,12]){
          const data={paths:Array.from({length:n},(_,i)=>path(n-i,8))};
          const bands=FillMeshPreparer.buildSpiralBandContours(data,layer);
          out.bands.push(bands?.map(b=>b.points.map(p=>[p.x,p.y]))??null);
        }
        const poly=n=>Array.from({length:n},(_,i)=>({x:170*Math.cos(i/n*Math.PI*2),y:100*Math.sin(i/n*Math.PI*2)}));
        out.contour=[];
        const ctx={layer,frameId:1,geometryPlan:{dynamic:false}};
        for(const [n,jitter] of [[4,1e-10],[10,0],[46,1e-8],[7,1e-7]]){
          const points=poly(n),t={...points[0]};
          const near={x:t.x+jitter,y:t.y-jitter};
          const rec={screenPaths:[{closed:true,points:[points[0],near,...points.slice(1),t]}]};
          ctx.frameId++;
          out.contour.push(info(FillMeshPreparer.prepareFrameContour(ctx,rec)));
        }
        out.corridor=[];
        state.tunnel.active=true;
        const cctx={layer,frameId:100,geometryPlan:{dynamic:false},visibleInstances:{
          copies:[{scale:1},{scale:0.01},{scale:0.87},{scale:0},{scale:0.72},{scale:-2},{scale:0.41}],
          fillAlphas:[1,0.0005,0.9,1,0.3,1,0.0006],alphas:[1,1,1,1,1,1,1]
        }};
        for(const pts of [4,9,16]){
          cctx.frameId++;
          const paths=Array.from({length:8},(_,i)=>path(i,pts));
          out.corridor.push(info(FillMeshPreparer.prepareInterwindingCorridor(cctx,paths)));
        }
        return out;
      } finally { state.tunnel.active=prevTunnel; FillMeshPreparer.reset(); }
    })()`,{timeoutMs:20000,label:'v10413 spiral fill contour parity'});
    assert.equal(r.topology.length,8);
    assert(r.topology.every(x=>x.intact),'topology preflight mutated paths');
    assert.equal(r.fastpath,true,'preflight should count without filtering');
    assert.deepEqual(r.disabled,[false,false,true]);
    assert.equal(r.bands[1].length,4);
    for (const type of ['contour','corridor']) for (const [i,m] of r[type].entries()) {
      assert(m?.complete,`${type} #${i} did not prepare`);
      assert(m.fanFloatCount>0 && m.fanFloatCount===m.data.length,`${type} #${i} missing data`);
      assert.equal(m.fanTriangleCount,m.fanFloatCount/6);
    }
    assert.deepEqual(uncaughtExceptions(h.events),[]);
    if(process.env.SOMATA_PARITY_SNAPSHOT==='1')console.log('SNAPSHOT:'+JSON.stringify(r));
    console.log('PASS Somata 10.4.13 Spiral Fill topology/contour/copy parity');
  } finally { await h.close(); }
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
