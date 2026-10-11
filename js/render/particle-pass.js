// SpiroStar v527 — independent GPU particle pass with WebGPU instancing + GPU fallback.
window.__spiroRegisterModule?.('js/render/particle-pass');
const particleFallbackScratchByLayer=new Map();
function particleFallbackHash(i,salt=0){let x=(Math.imul((i+1)|0,1103515245)^Math.imul((salt+1)|0,2654435761))>>>0;x^=x>>>16;x=Math.imul(x,2246822519)>>>0;x^=x>>>13;return(x>>>0)/4294967295;}
function particleFallbackColors(cfg,layer){
    if(cfg.colorMode==='line')return[layer?.strokeColor||'#ffffff'];
    if(cfg.colorMode==='palette'){try{const c=getPlaylistPaletteColors(cfg.paletteKey);if(c?.length)return c;}catch(_){}}
    return{stardust:['#ffffff','#e0f2fe'],flame:['#ffffff','#ffe066','#ff8a1f','#ff2d0a'],laser:['#fff7c2','#f9a8d4','#a7f3d0','#ffffff'],feather:['#ffffff','#e2e8f0'],eye:['#38bdf8','#ffffff'],plasma:['#f0abfc','#c084fc','#8b5cf6']}[cfg.style]||['#ffffff'];
}
function queueParticleGpuFallback(frameCtx,cfg){
    try{
        const table=getLayerFramePathTable(frameCtx,true);if(!(table?.total>1)||!table?.segs?.length)return false;
        const count=Math.max(0,Math.min(1200,Math.round(cfg.density*cfg.densityMultiplier))),now=(Number(frameCtx?.frame?.now)||performance.now())/1000,total=table.total,colors=particleFallbackColors(cfg,frameCtx.layer),items=[];if(!count)return true;
        const scatter=Math.min(280,(cfg.scatter/100)*cfg.scatterMultiplier*Math.max(10,cfg.sizePx*8)),sizeVar=Math.min(3,(cfg.sizeVariation/100)*cfg.sizeVariationMultiplier),speed=(cfg.speedPercent*cfg.speedMultiplier)/100,tw=cfg.twinkle/100,turns=Math.max(0,Number(cfg.spiralTurns)||0);
        for(let i=0;i<count;i++){
            const seed=particleFallbackHash(i,17),seed2=particleFallbackHash(i,71);let ph=(i+.5)/count+now*(.008+speed*.055)+seed*.021;ph-=Math.floor(ph);let envelope=1;
            if(cfg.mode==='cornerFade'){const si=i%table.segs.length,seg=table.segs[si],local=(now*(.035+speed*.11)+seed)%1,tt=(i&1)?local:1-local,d=seg.start+seg.len*tt;ph=d/total;envelope=Math.pow(Math.max(0,Math.sin(Math.PI*local)),.72);}
            const d=ph*total,pnt=pointAtPathDistance(table,Math.min(total-1e-7,d),{x:0,y:0}),p2=pointAtPathDistance(table,Math.min(total-1e-7,d+Math.max(.25,total/count*.08)),{x:0,y:0});let tx=p2.x-pnt.x,ty=p2.y-pnt.y,tl=Math.hypot(tx,ty);if(tl<1e-6){tx=1;ty=0;tl=1;}tx/=tl;ty/=tl;const nx=-ty,ny=tx,h1=seed-.5,h2=seed2-.5;let x=pnt.x+nx*h1*2*scatter+tx*h2*.7*scatter,y=pnt.y+ny*h1*2*scatter+ty*h2*.7*scatter,depth=1;
            if(cfg.mode==='spiralZ'){const helix=now*(2.2+speed*8.5)+seed*Math.PI*2+ph*Math.PI*2*turns;x+=nx*Math.sin(helix)*cfg.spiralRadiusPx*cfg.spiralRadiusMultiplier;y+=ny*Math.sin(helix)*cfg.spiralRadiusPx*cfg.spiralRadiusMultiplier;depth=.68+.48*(.5+.5*Math.cos(helix));envelope*=.65+.35*(.5+.5*Math.cos(helix));}
            const wave=.5+.5*Math.sin(now*(5+seed*4)+seed*31),twinkleSize=(1-tw)+tw*(.72+.28*wave),twinkleAlpha=(1-tw)+tw*(.12+.88*wave),sv=Math.max(.12,1+(seed2*2-1)*sizeVar),styleScale=cfg.style==='feather'?.58:1,rad=Math.max(.35,cfg.sizePx*twinkleSize*depth*sv*styleScale);
            items.push({px:x,py:y,rad,color:colors[i%colors.length],brightness:100,intensityAlpha:(cfg.opacity/100)*envelope*twinkleAlpha,lampIdentityIndex:i});
        }
        const type={stardust:'star',flame:'softCore',laser:'star',feather:'softCore',eye:'ring',plasma:'softCore'}[cfg.style]||'star',visualPlan={items},drawPlan={config:{webgl:true,blendMode:'lighter'},preparedStyle:{effectiveSoftness:cfg.style==='laser'?38:(cfg.style==='feather'?24:72),type}};
        const tunnelActive=typeof state!=='undefined'&&state?.tunnel?.active===true,copies=frameCtx?.visibleInstances?.copies||[],alphas=frameCtx?.visibleInstances?.particleAlphas||frameCtx?.visibleInstances?.alphas||[];
        if(tunnelActive){if(!copies.length)return true;if(LampGPURenderer?.queueCorridorVisualPlan?.(mainCtx,visualPlan,1,drawPlan,copies,alphas,frameCtx)===true){renderBackendTelemetry?.mark?.('particles','gpu','GPU Corridor particle fallback');return true;}}
        const a=Math.max(0,Math.min(1,Number(alphas?.[0]??1)));mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);const ok=LampGPURenderer?.queueVisualPlan?.(mainCtx,visualPlan,a,drawPlan)===true;mainCtx.restore();if(ok)renderBackendTelemetry?.mark?.('particles','gpu','GPU particle fallback');return ok;
    }catch(_){return false;}
}
function renderLayerParticlePass(frameCtx){
    const cfg=typeof normalizeParticleConfig==='function'?normalizeParticleConfig(frameCtx?.layer?.particles):null;
    if(!cfg?.enabled||frameCtx?.layer?.visible===false)return false;
    try{
        // v533: when Base/Glow already own a deferred Layer Scene, keep particles in the
        // exact same GPU command stream. This removes the extra transparent overlay submit
        // and browser-canvas composition from Morph + Particles frames while preserving the
        // established pass order: Sweep(30) -> Particles(35) -> Web(40) -> Lamps.
        if(frameCtx?.frame?.gpuLayerSceneDeferred===true){
            const scene=WebGPUStrokeRenderer?.getDeferredLayerSceneTexture?.(frameCtx.frameId),rec=scene?.texture?WebGPUParticleRenderer?.encodeToLayerScene?.(scene.texture,frameCtx,mainCtx):null;
            if(rec?.handled){if(rec.commandBuffer)queueLayerSceneEffectCommand(frameCtx,35,rec.commandBuffer,'particles',rec.onSubmitted);renderBackendTelemetry?.mark?.('particles','gpu','deferred Layer Scene particles');return true;}
        }
        const strictSpiral=typeof isStrictSpiralWebGPUFrame==='function'?isStrictSpiralWebGPUFrame(frameCtx):(typeof isSpiralLayer==='function'&&isSpiralLayer(frameCtx.layer)&&state?.fourierMode!==true);
        // Spiral 6.8 keeps particles in the same deferred GPU Layer Scene as the retained
        // cubic base. Do not spill them into the compatibility WebGPU overlay canvas: although
        // that overlay is GPU-rasterised, it is a second presentation surface and breaks the
        // single-scene ordering/performance contract used by the other Spiral effects.
        if(strictSpiral){renderBackendTelemetry?.mark?.('particles','gpu','Spiral Layer-Scene-only particles warmup');try{requestMainCanvasRender?.();}catch(_){}return false;}
        const ok=WebGPUParticleRenderer?.queueLayer?.(frameCtx,mainCtx)===true;
        if(ok){renderBackendTelemetry?.mark?.('particles','gpu','WebGPU contour particles overlay');return true;}
        if(strictSpiral){renderBackendTelemetry?.mark?.('particles','gpu','Spiral particles GPU-only warmup');return false;}
        return queueParticleGpuFallback(frameCtx,cfg);
    }catch(_){if(typeof isStrictSpiralWebGPUFrame==='function'?isStrictSpiralWebGPUFrame(frameCtx):(typeof isSpiralLayer==='function'&&isSpiralLayer(frameCtx?.layer)&&state?.fourierMode!==true))return false;return queueParticleGpuFallback(frameCtx,cfg);}
}
function flushParticleFrameQueue(){try{return WebGPUParticleRenderer?.flush?.()===true;}catch(_){return false;}}
