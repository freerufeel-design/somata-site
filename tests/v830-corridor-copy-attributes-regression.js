// 8.3.0: exact original colour/motion semantics, one lookup per copy/frame
// across FeatureHost-scoped passes and both GPU and Canvas consumers.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const check=(v,msg)=>{if(!v)throw Error(msg)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:200,evalTimeoutMs:12000});
 try{
  const result=await h.evaluate(`(()=>{
   const old={...state.tunnel},oldMotion={...state.motion};
   try{
    state.tunnel.active=true;state.tunnel.paletteLagEnabled=true;state.tunnel.colorShiftEnabled=true;
    const layer=createLayer('v830-attributes');layer.strokeColor='#334455';layer.fillColor='#778899';
    const copies=Array.from({length:36},(_,i)=>({scale:1-i/50,position:i+.34,colorIndex:i,copyId:i}));
    const frame={frameId:3301,layer,sourceLayer:layer,effectLayerSource:layer,visibleInstances:{copies,alphas:copies.map(()=>1)},tunnelBaseStrokeColor:'#334455',tunnelBaseFillColor:'#778899',tunnelPaletteProfile:resolveTunnelPaletteProfile('#334455',layer),tunnelFillPaletteProfile:resolveTunnelPaletteProfile('#778899',layer),baseAlpha:1};
    const expected=copies.map(c=>({stroke:getTunnelCopyColor(frame.tunnelBaseStrokeColor,c,frame.tunnelPaletteProfile),fill:getTunnelCopyColor(frame.tunnelBaseFillColor,c,frame.tunnelFillPaletteProfile),angle:getMotionTunnelLagRadians(c,layer)}));
    const begin=__somataCorridorCopyFrameStatus();
    for(const feature of ['glow','base','fill'])SomataFeatureHost.run(feature,frame,view=>{
     for(let i=0;i<copies.length;i++){
      const copy=copies[i],e=expected[i];
      if(SomataCorridorCopyFrame.stroke(view,copy,i)!==e.stroke)throw Error('stroke parity '+i);
      if(SomataCorridorCopyFrame.fill(view,copy,i)!==e.fill)throw Error('fill parity '+i);
      if(SomataCorridorCopyFrame.rotation(view,copy,i)!==e.angle)throw Error('angle parity '+i);
     }
    });
    const a=__somataCorridorCopyFrameStatus();
    const once=a.strokeBuilds-begin.strokeBuilds===copies.length&&a.fillBuilds-begin.fillBuilds===copies.length&&a.angleBuilds-begin.angleBuilds===copies.length;
    const shared=a.strokeHits-begin.strokeHits===copies.length*2&&a.fillHits-begin.fillHits===copies.length*2&&a.angleHits-begin.angleHits===copies.length*2;
    const gpu=buildCorridorGPUOptions(frame);
    const gpuIdentical=copies.every((copy,i)=>gpu.colorForCopy(copy)===expected[i].stroke&&gpu.rotationForCopy(copy)===expected[i].angle);
    // Frame generation change invalidates cached angle even with the same copy objects.
    const before=__somataCorridorCopyFrameStatus();frame.frameId++;
    SomataCorridorCopyFrame.stroke(frame,copies[0],0);SomataCorridorCopyFrame.fill(frame,copies[0],0);SomataCorridorCopyFrame.rotation(frame,copies[0],0);
    const after=__somataCorridorCopyFrameStatus();
    const invalidates=after.strokeBuilds===before.strokeBuilds+1&&after.fillBuilds===before.fillBuilds+1&&after.angleBuilds===before.angleBuilds+1;
    const other={...frame,layer:createLayer('another'),sourceLayer:createLayer('third'),frameId:frame.frameId+2};
    SomataCorridorCopyFrame.stroke(other,copies[0],0);
    const distinctLayers=__somataCorridorCopyFrameStatus().frames===after.frames+1;
    return{once,shared,gpuIdentical,invalidates,distinctLayers,boot:__spiroAppBootComplete===true};
   }finally{Object.assign(state.tunnel,old);Object.assign(state.motion,oldMotion);}
  })()`,{label:'v8.3 shared copy fields',timeoutMs:10000});
  for(const [key,value] of Object.entries(result))check(value===true,`${key}: ${value}`);
  check(uncaughtExceptions(h.events).length===0,'uncaught '+uncaughtExceptions(h.events).join(' | '));
  console.log('PASS v8.3 Corridor copy colour and rotation parity, FeatureHost reuse, GPU/Canvas cache, generation invalidation',result);
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v8.3',e.stack||e);process.exitCode=1;});
