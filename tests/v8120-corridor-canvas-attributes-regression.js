// Somata 8.12: batch cache access may not change the Canvas visual output.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:170,evalTimeoutMs:12000});
 try{
  const result=await h.evaluate(`(()=>{
    const oldTunnel={...state.tunnel};
    try{
      Object.assign(state.tunnel,{active:true,paletteLagEnabled:true,colorShiftEnabled:true,colorShiftCumulative:false});
      const l=createLayer('v812-canvas');Object.assign(l,{N:7,K:2,radius:95,strokeColor:'#346abc',fillColor:'#dd7766cc'});
      const copies=Array.from({length:18},(_,i)=>({scale:1-i*.03,position:i+.37,copyId:i,colorIndex:i}));
      const attrs={frameId:8120,layer:l,sourceLayer:l,effectLayer:l,
        tunnelBaseStrokeColor:l.strokeColor,tunnelBaseFillColor:l.fillColor,
        tunnelPaletteProfile:resolveTunnelPaletteProfile(l.strokeColor,l),
        tunnelFillPaletteProfile:resolveTunnelPaletteProfile(l.fillColor,l),
        visibleInstances:{copies,alphas:copies.map((_,i)=>i===2?0:(.2+i*.025)),fillAlphas:copies.map(()=>.24)},
        geometryPlan:{kind:'static',dynamic:false},geometryMorphEnabled:false,
        strokeWidth:2,lineProfileStrokeOnly:false,lineProfileApplication:'stroke',
        drawLayerGeometry:(ctx,alpha)=>{ctx.globalAlpha=alpha;ctx.beginPath();ctx.arc(0,0,9,0,Math.PI*2);ctx.fill();if(!ctx.__suppressStroke)ctx.stroke();}
      };
      prepareMainLayerVectorMaster(attrs);
      if(typeof attrs.drawLayerInstances!=='function'||typeof attrs.drawLayerFillInstances!=='function')throw Error('missing drawing callbacks');
      function setup(){const c=document.createElement('canvas');c.width=320;c.height=320;const x=c.getContext('2d',{willReadFrequently:true});x.translate(160,160);x.lineWidth=1.6;return{x,c};}
      const a=setup(),b=setup(),f=setup(),g=setup();
      // Direct authoritative Corridor formulas, no frame-attributes cache.
      const oldDraw=(ctx,fill)=>{const alphas=fill?attrs.visibleInstances.fillAlphas:attrs.visibleInstances.alphas;
        const previous=ctx.__suppressStroke;if(fill)ctx.__suppressStroke=true;
        for(let i=0;i<copies.length;i++){
          const copy=copies[i],alpha=Math.max(0,Math.min(1,Number(alphas[i])||0));if(alpha<=.0001)continue;
          ctx.save();ctx.strokeStyle=getTunnelCopyColor(l.strokeColor,copy,attrs.tunnelPaletteProfile);
          ctx.fillStyle=getTunnelCopyColor(l.fillColor,copy,attrs.tunnelFillPaletteProfile);
          const angle=getMotionTunnelLagRadians(copy,l);if(Math.abs(angle)>1e-12)ctx.rotate(angle);
          ctx.scale(copy.scale,copy.scale);
          attrs.drawLayerGeometry(ctx,alpha);
          ctx.restore();
        }
        if(previous===undefined)delete ctx.__suppressStroke;else ctx.__suppressStroke=previous;
      };
      // Use mock commands to certify exact colors, rotations, alpha and per-copy ordering.
      const records=[];const origStroke=SomataCorridorCopyFrame.strokeAt;
      const origRotation=SomataCorridorCopyFrame.rotationAt;
      let indexCount=0;const vals=[];
      SomataCorridorCopyFrame.strokeAt=function(e,c,i){vals.push({kind:'stroke',i,result:origStroke(e,c,i)});return vals[vals.length-1].result;};
      SomataCorridorCopyFrame.rotationAt=function(e,c,i){const r=origRotation(e,c,i);vals.push({kind:'rotation',i,result:r});return r;};
      try{attrs.drawLayerInstances(a.x,true);attrs.drawLayerFillInstances(f.x);}finally{SomataCorridorCopyFrame.strokeAt=origStroke;SomataCorridorCopyFrame.rotationAt=origRotation;}
      for(const v of vals){const copy=copies[v.i];const expected=v.kind==='stroke'?getTunnelCopyColor(l.strokeColor,copy,attrs.tunnelPaletteProfile):getMotionTunnelLagRadians(copy,l);if(v.result!==expected)throw Error('attribute parity '+v.kind+' '+v.i);}
      // Check against equivalent draw callback path on an identical context,
      // using the authoritative per-copy colour/rotation formulas.
      // Use a lightweight mock: pixels independently tested in v890.
      oldDraw(b.x,false);oldDraw(g.x,true);
      const pixels=(canvas)=>canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      function difference(one,two){const x=pixels(one),y=pixels(two);let bad=0;for(let i=0;i<x.length;i++)if(x[i]!==y[i])bad++;return bad;}
      const baseDiff=difference(a.c,b.c),fillDiff=difference(f.c,g.c);
      if(baseDiff||fillDiff)throw Error('Canvas pixel drift: base='+baseDiff+' fill='+fillDiff);
      const status=__somataCorridorCopyFrameStatus();attrs.frameId++;
      attrs.drawLayerInstances(b.x,true);attrs.drawLayerFillInstances(g.x);
      if(__somataCorridorCopyFrameStatus().frames<=status.frames)throw Error('cache was not invalidated by new frame');
      return {ok:true,checks:vals.length,baseDiff,fillDiff,frames:__somataCorridorCopyFrameStatus().frames,boot:__spiroAppBootComplete===true};
    }finally{Object.assign(state.tunnel,oldTunnel);}
  })()`,{timeoutMs:10000,label:'Corridor Canvas attribute parity'});
  if(!result.ok||!result.boot||uncaughtExceptions(h.events).length)throw Error('regression '+JSON.stringify(result)+' '+uncaughtExceptions(h.events).join(' | '));
  console.log('PASS v8120 Corridor Canvas attribute parity, fill role, new-frame invalidation',result);
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL v8120',e.stack||e);process.exitCode=1});
