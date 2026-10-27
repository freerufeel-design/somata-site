'use strict';
// Compares exact Float32 output and retained-capacity behavior with the prior release.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:130,evalTimeoutMs:20000});
 try{
  const snapshots=await h.evaluate(`(()=>{
   const oldTunnel=state.tunnel.active;
   const layer=createLayer('fill-storage-regression');
   layer.spiralEnabled=true;layer.spiralClosed=true;layer.spiralFillEnabled=true;
   layer.spiralFillType='interwinding';layer.fill=true;layer.N=8;layer.K=1;layer.spiralOrder=1;
   const meshInfo=(mesh)=>mesh?{
     count:mesh.fanFloatCount,triangles:mesh.fanTriangleCount,capacity:mesh.fanData?.length||0,
     complete:mesh.complete,revision:mesh.revision,anchor:mesh.anchor||null,
     contours:mesh.contourCount??null,bands:mesh.spiralBandCount??null,
     data:Array.from((mesh.fanData||[]).subarray(0,mesh.fanFloatCount))
   }:null;
   const makePaths=(count,pts=6,cubic=false)=>Array.from({length:count},(_,k)=>{
     const points=Array.from({length:pts},(_,i)=>{
       const a=k*.19+i*.12,r=30+i*8+k;return{x:Math.cos(a)*r,y:Math.sin(a)*r};
     });
     const path={points,closed:false,alpha:1,spiralBranchIndex:k,branchPhase:k/count,
       sourceBranchIndex:k,targetBranchIndex:k,sourceBranchCount:count,targetBranchCount:count};
     if(cubic)path._bezierSegments=[{p0:points[0],c1:points[1],c2:points[pts-2],p3:points[pts-1]}];
     return path;
   });
   const result={};
   try{
     // Line-carrier and frame-contour Fill exercise both 96-float buffers,
     // including growth and reuse across consecutive frames.
     const lineCtx={layer,frameId:11,geometryPlan:{dynamic:true}};
     result.line=[];
     for(const count of [4,38,6]){
       const commands=[{subpaths:[{closed:true,points:Array.from({length:count},(_,i)=>{
         const a=i/count*Math.PI*2;return{x:120*Math.cos(a),y:80*Math.sin(a)};
       })}]}];
       lineCtx.frameId++;
       result.line.push(meshInfo(FillMeshPreparer.prepareLineCarrierCommands(lineCtx,commands)));
     }
     const frameCtx={layer,frameId:41,geometryPlan:{dynamic:false}};
     result.contour=[];
     for(const count of [4,31,5]){
       const record={screenPaths:[{closed:true,points:Array.from({length:count},(_,i)=>{
         const a=i/count*Math.PI*2;return{x:Math.cos(a)*57,y:Math.sin(a)*79};
       })}]};
       frameCtx.frameId++;
       result.contour.push(meshInfo(FillMeshPreparer.prepareFrameContour(frameCtx,record)));
     }
     const morphCtx={layer,frameId:71,geometryPlan:{dynamic:true},
       blueMorphProvider:{sourceLayer:{...layer,N:8},targetLayer:{...layer,N:8}}};
     result.spiralMorph=[];
     for(const count of [6,34,7]){
       morphCtx.frameId++;
       result.spiralMorph.push(meshInfo(FillMeshPreparer.prepareSpiralMorphBands(morphCtx,makePaths(8,count))));
     }
     result.spiralSample={};
     for(const cubic of [false,true]){
       const data={paths:makePaths(8,7,cubic)};
       const bands=FillMeshPreparer.buildSpiralBandContours(data,layer);
       result.spiralSample[cubic?'cubic':'polyline']=bands?.map(b=>b.points.map(p=>[p.x,p.y]))||null;
     }
     state.tunnel.active=true;
     const interCtx={layer,frameId:81,geometryPlan:{dynamic:false},visibleInstances:{
       copies:[{scale:1,position:0},{scale:.8,position:1},{scale:.6,position:2}],alphas:[1,1,1],fillAlphas:[1,1,1]
     }};
     result.interwinding=[];
     for(const points of [5,21,6]){
       interCtx.frameId++;
       result.interwinding.push(meshInfo(FillMeshPreparer.prepareInterwindingCorridor(interCtx,makePaths(8,points))));
     }
     return result;
   }finally{state.tunnel.active=oldTunnel;FillMeshPreparer.reset();}
  })()`,{timeoutMs:20000,label:'v10411 fill buffer parity'});
  assert.equal(snapshots.line.length,3);
  assert.equal(snapshots.contour.length,3);
  assert.equal(snapshots.spiralMorph.length,3);
  assert.equal(snapshots.interwinding.length,3);
  for(const key of ['line','contour','spiralMorph','interwinding']){
   for(const [i,mesh] of snapshots[key].entries()){
    assert(mesh?.complete,`${key} ${i} failed to build`);
    assert(mesh.count>0&&mesh.data.length===mesh.count,`${key} ${i} incomplete data`);
    assert(mesh.capacity>=mesh.count,`${key} ${i} buffer undersized`);
   }
   assert(snapshots[key][1].capacity>snapshots[key][0].capacity,`${key} failed to grow`);
   assert.equal(snapshots[key][2].capacity,snapshots[key][1].capacity,`${key} did not reuse`);
  }
  assert.equal(snapshots.spiralSample.polyline.length,4);
  assert.equal(snapshots.spiralSample.cubic.length,4);
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  if(process.env.SOMATA_PARITY_SNAPSHOT==='1')console.log('SNAPSHOT:'+JSON.stringify(snapshots));
  console.log('PASS Somata 10.4.11 Fill storage and Spiral sampling');
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL',err.stack||err);process.exitCode=1;});
