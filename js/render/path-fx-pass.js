// SpiroStar v510 — GPU Path FX render pass
// Sprite + Moving Line are isolated from the main render orchestrator and queued into
// one frame-wide WebGPU overlay pass. No per-copy command encoder or queue.submit.
window.__spiroRegisterModule?.('js/render/path-fx-pass');

const pathFxFrameQueueStats={queued:0,directFallbacks:0,failed:0,framesFlushed:0};


// v522.3 — visual fallback for Line/Sprite.
// Built-in and custom sprites can be drawn directly into mainCanvas using the same typed
// arc-length carrier as the WebGPU Path FX renderer. This is intentionally independent from
// the WebGPU overlay: a successfully created/queued GPU pass is not sufficient evidence that
// pixels reached the presentation surface on every browser/driver combination.
const canvasLineSpriteAtlasCache=new Map();
const canvasLineSpriteImageCache=new Map();
const canvasLineSpriteStats={prepared:0,draws:0,segments:0,customLoads:0,customReady:0,customErrors:0,emergencyBase:0};

function canvasSpriteAtlas(layer,cfg){
    const type=normalizeLineSpriteType(cfg?.type),preset=getLineSpritePreset(type);
    const primary=cfg?.matchLineColor!==false?(layer?.strokeColor||'#ffffff'):(cfg?.color||preset.primary);
    const secondary=cfg?.secondaryColor||preset.secondary;
    const key=`${type}|${primary}|${secondary}`;let hit=canvasLineSpriteAtlasCache.get(key);if(hit)return hit;
    const c=document.createElement('canvas');c.width=1024;c.height=128;const x=c.getContext('2d');if(!x)return null;
    x.clearRect(0,0,c.width,c.height);x.lineCap='round';x.lineJoin='round';
    const ink='#07111f';
    if(type==='snake'){
        x.strokeStyle=primary;x.lineWidth=62;x.beginPath();x.moveTo(28,76);x.bezierCurveTo(170,18,330,105,500,61);x.bezierCurveTo(660,18,795,98,905,62);x.stroke();
        x.strokeStyle=secondary;x.lineWidth=14;x.setLineDash([28,22]);x.beginPath();x.moveTo(75,68);x.bezierCurveTo(230,25,365,98,510,60);x.bezierCurveTo(650,25,785,92,884,62);x.stroke();x.setLineDash([]);
        x.fillStyle=primary;x.beginPath();x.ellipse(944,62,63,48,0,0,Math.PI*2);x.fill();
        x.strokeStyle=secondary;x.lineWidth=15;x.beginPath();x.moveTo(904,76);x.quadraticCurveTo(946,104,985,74);x.stroke();
        x.fillStyle=ink;x.beginPath();x.arc(960,49,7,0,Math.PI*2);x.fill();
        x.strokeStyle='#fb7185';x.lineWidth=5;x.beginPath();x.moveTo(999,69);x.lineTo(1022,59);x.moveTo(999,69);x.lineTo(1020,79);x.stroke();
    }else if(type==='bones'){
        x.strokeStyle=primary;x.fillStyle=primary;x.lineWidth=22;
        for(let cx=42;cx<1000;cx+=92){x.beginPath();x.moveTo(cx-26,64);x.lineTo(cx+26,64);x.stroke();for(const ex of [cx-29,cx+29])for(const ey of [55,73]){x.beginPath();x.arc(ex,ey,10,0,Math.PI*2);x.fill();}}
        x.strokeStyle=secondary;x.lineWidth=5;for(let cx=42;cx<1000;cx+=92){x.beginPath();x.moveTo(cx-18,64);x.lineTo(cx+18,64);x.stroke();}
    }else if(type==='dachshund'){
        x.fillStyle=primary;x.fillRect(135,39,710,52);x.beginPath();x.ellipse(135,65,26,26,0,0,Math.PI*2);x.ellipse(845,65,26,26,0,0,Math.PI*2);x.fill();
        x.beginPath();x.ellipse(917,56,70,48,-.12,0,Math.PI*2);x.fill();
        x.strokeStyle=primary;x.lineWidth=18;x.beginPath();x.moveTo(118,54);x.quadraticCurveTo(60,28,18,45);x.stroke();
        x.fillStyle=secondary;x.fillRect(165,77,650,10);for(let cx=210;cx<820;cx+=180){x.fillRect(cx,82,18,39);x.fillRect(cx+48,82,18,39);}
        x.fillStyle=ink;x.beginPath();x.arc(942,45,6,0,Math.PI*2);x.fill();
    }else if(type==='dragon'){
        x.strokeStyle=primary;x.lineWidth=58;x.beginPath();x.moveTo(25,70);x.bezierCurveTo(200,20,350,105,520,62);x.bezierCurveTo(690,20,820,92,914,58);x.stroke();
        x.fillStyle=secondary;for(let px=110;px<900;px+=72){x.beginPath();x.moveTo(px,39);x.lineTo(px+20,5);x.lineTo(px+38,42);x.closePath();x.fill();}
        x.fillStyle=primary;x.beginPath();x.moveTo(885,29);x.lineTo(1003,45);x.lineTo(975,95);x.lineTo(884,85);x.closePath();x.fill();
        x.fillStyle=secondary;x.beginPath();x.moveTo(965,72);x.lineTo(1022,91);x.lineTo(978,52);x.closePath();x.fill();
        x.fillStyle=ink;x.beginPath();x.arc(958,50,6,0,Math.PI*2);x.fill();
    }else{
        for(let i=0;i<19;i++){const cx=34+i*53,r=27+(i%2?5:0);x.fillStyle=i%2?secondary:primary;x.beginPath();x.arc(cx,64,r,0,Math.PI*2);x.fill();}
        x.fillStyle=primary;x.beginPath();x.arc(986,62,39,0,Math.PI*2);x.fill();x.fillStyle=ink;x.beginPath();x.arc(997,50,6,0,Math.PI*2);x.fill();
    }
    canvasLineSpriteAtlasCache.set(key,c);return c;
}

function canvasSpriteSource(layer,cfg){
    const data=String(cfg?.imageDataUrl||'');if(!data)return canvasSpriteAtlas(layer,cfg);
    let rec=canvasLineSpriteImageCache.get(data);
    if(rec?.ready&&rec.image)return rec.image;
    if(!rec){
        const image=new Image();rec={image,ready:false,error:false};canvasLineSpriteImageCache.set(data,rec);canvasLineSpriteStats.customLoads++;
        image.onload=()=>{rec.ready=true;canvasLineSpriteStats.customReady++;requestMainCanvasRender();};
        image.onerror=()=>{rec.error=true;canvasLineSpriteStats.customErrors++;requestMainCanvasRender();};
        image.src=data;
    }
    // Never return an empty source while a custom image is decoding: the selected built-in
    // preset remains a visible fallback and is replaced on the next frame after onload.
    return canvasSpriteAtlas(layer,cfg);
}

function getCanvasSpriteCarrierTable(frameCtx,effect){
    let table=frameCtx?._pathFxCanvasSpriteTable||null;
    const typed=t=>Boolean(t?.gpuSegmentData instanceof Float32Array&&Math.max(0,Number(t?.gpuSegmentFloatCount)||0)>=8&&Math.max(0,Number(t?.segmentCount)||0)>0);
    if(typed(table))return table;
    if(typed(effect?.table)){table=effect.table;frameCtx._pathFxCanvasSpriteTable=table;return table;}
    try{table=getLayerFramePathFxTable(frameCtx);}catch(_){table=null;}
    if(typed(table)){frameCtx._pathFxCanvasSpriteTable=table;return table;}
    return null;
}

function prepareLayerSpriteCanvasFallback(frameCtx,effect){
    const table=getCanvasSpriteCarrierTable(frameCtx,effect);const ok=Boolean(table);
    if(ok)canvasLineSpriteStats.prepared++;return ok;
}

function canvasSpriteMotionOffset(cfg,globalDist,pathLocalDist,scale,now){
    if(!cfg?.enabled)return 0;const type=cfg.type==='sine'?'seaRaft':cfg.type,amp=(Math.max(0,Number(cfg.amplitudePx)||0)*Math.max(0,Number.isFinite(Number(cfg.amplitudeMultiplier))?Number(cfg.amplitudeMultiplier):1))/Math.max(.0001,scale);if(amp<=1e-7)return 0;
    const wl=Math.max(2,(Number(cfg.wavelengthPx)||36)*Math.max(.01,Number.isFinite(Number(cfg.wavelengthMultiplier))?Number(cfg.wavelengthMultiplier):2))/Math.max(.0001,scale),speed=Math.max(0,Number(cfg.speedPercent)||0)/100,time=(Number(now)||performance.now())*.001,travel=time*60*speed/Math.max(.0001,scale),phase=time*Math.PI*2*speed;
    if(type==='seaRaft')return Math.sin(Math.PI*2*(globalDist-travel)/wl)*amp;
    const cell=Math.floor(pathLocalDist/wl),t=((pathLocalDist/wl)%1+1)%1,anchored=Math.sin(Math.PI*t);
    if(type==='jumpRope')return anchored*Math.sin(phase+cell*.37)*amp;
    return anchored*Math.sin(Math.PI*2*t-phase)*amp;
}

function spriteConstructionSegmentCount(layer){
    const N=Math.max(2,Math.round(Number(layer?.N)||2)),K=Math.max(1,Math.round(Number(layer?.K)||1));
    return Math.max(1,Math.round(N/Math.max(1,gcd(N,K))));
}

function drawCanvasSpriteCarrier(ctx,table,layer,cfg,alpha,now,motionCfg=null){
    const data=table?.gpuSegmentData,index=table?.gpuPathIndexData,count=Math.max(0,Number(table?.segmentCount)||0);if(!(data instanceof Float32Array)||!count)return false;
    const src=canvasSpriteSource(layer,cfg);if(!src||!(src.width>0)||!(src.height>0))return false;
    const preset=getLineSpritePreset(cfg?.type),width=Math.max(.2,(Number(layer?.strokeWidth)||1.5)*getLayerStrokeWidthMultiplier(layer)*Math.max(.2,Number(cfg?.widthPercent)||preset.widthPercent)/100*Math.max(.01,Number(cfg?.widthMultiplier)||1));
    const placement=normalizeLineSpritePlacement(cfg?.mode),everyN=Math.max(1,Math.round(Number(cfg?.everyN)||2)),total=Math.max(.0001,Number(table.total)||0),constructionSegments=spriteConstructionSegmentCount(layer);
    const tr=ctx.getTransform?.(),sx=Math.hypot(Number(tr?.a)||0,Number(tr?.b)||0),sy=Math.hypot(Number(tr?.c)||0,Number(tr?.d)||0),scale=Math.sqrt(Math.max(1e-8,sx*sy));
    ctx.save();ctx.globalAlpha*=Math.max(0,Math.min(1,Number(alpha)||0));ctx.imageSmoothingEnabled=true;
    let drawn=0;
    const drawPiece=(ax0,ay0,bx0,by0,gStart,gEnd,pathStart,pathLen,uvStart,uvEnd)=>{
        let ax=ax0,ay=ay0,bx=bx0,by=by0,len=Math.hypot(bx-ax,by-ay);if(!(len>1e-7)||uvEnd<=uvStart+1e-8)return;
        if(motionCfg?.enabled===true){const dx=bx-ax,dy=by-ay,dl=Math.max(1e-9,len),nx=-dy/dl,ny=dx/dl,l0=gStart-pathStart,l1=gEnd-pathStart,oa=canvasSpriteMotionOffset(motionCfg,gStart,l0,scale,now),ob=canvasSpriteMotionOffset(motionCfg,gEnd,l1,scale,now);ax+=nx*oa;ay+=ny*oa;bx+=nx*ob;by+=ny*ob;len=Math.hypot(bx-ax,by-ay);if(!(len>1e-7))return;}
        const sw=Math.max(.01,(uvEnd-uvStart)*src.width),sourceX=uvStart*src.width,ang=Math.atan2(by-ay,bx-ax);
        ctx.save();ctx.translate(ax,ay);ctx.rotate(ang);ctx.drawImage(src,sourceX,0,sw,src.height,0,-width*.5,len+.35,width);ctx.restore();drawn++;canvasLineSpriteStats.segments++;
    };
    try{
        for(let i=0;i<count;i++){
            const o=i*8,packed=index instanceof Uint32Array?index[i]:0,pi=packed&0x00ffffff;
            if(placement==='everyNthPath'&&(pi%everyN)!==0)continue;
            const ax0=Number(data[o])||0,ay0=Number(data[o+1])||0,bx0=Number(data[o+2])||0,by0=Number(data[o+3])||0,g0=Number(data[o+4])||0,baseLen=Math.max(0,Number(data[o+5])||0),pathStart=Number(data[o+6])||0,pathLen=Math.max(.0001,Number(data[o+7])||0);if(!(baseLen>1e-7))continue;
            const dx=bx0-ax0,dy=by0-ay0;
            if(placement==='perSegment'||placement==='everyNth'){
                const logicalLen=pathLen/constructionSegments,localA=Math.max(0,g0-pathStart),localB=Math.min(pathLen,localA+baseLen);let cur=localA,guard=0;
                while(cur<localB-1e-8&&guard++<constructionSegments+2){
                    const segIndex=Math.min(constructionSegments-1,Math.max(0,Math.floor((cur+1e-9)/logicalLen))),segStart=segIndex*logicalLen,segEnd=Math.min(pathLen,segStart+logicalLen),pieceEnd=Math.min(localB,segEnd);
                    if(placement==='perSegment'||(segIndex%everyN)===0){
                        const t0=Math.max(0,Math.min(1,(cur-localA)/baseLen)),t1=Math.max(0,Math.min(1,(pieceEnd-localA)/baseLen));
                        const u0=Math.max(0,Math.min(1,(cur-segStart)/logicalLen)),u1=Math.max(0,Math.min(1,(pieceEnd-segStart)/logicalLen));
                        drawPiece(ax0+dx*t0,ay0+dy*t0,ax0+dx*t1,ay0+dy*t1,pathStart+cur,pathStart+pieceEnd,pathStart,pathLen,u0,u1);
                    }
                    cur=Math.max(pieceEnd,cur+1e-8);
                }
                continue;
            }
            const start=placement==='whole'?0:pathStart,span=placement==='whole'?total:pathLen,u0=Math.max(0,Math.min(1,(g0-start)/span)),u1=Math.max(0,Math.min(1,(g0+baseLen-start)/span));
            drawPiece(ax0,ay0,bx0,by0,g0,g0+baseLen,pathStart,pathLen,u0,u1);
        }
    }finally{ctx.restore();}
    if(drawn)canvasLineSpriteStats.draws++;return drawn>0;
}

function getCanvasMotionCarrierTable(frameCtx,effect){
    const typed=t=>Boolean(t?.gpuSegmentData instanceof Float32Array&&Math.max(0,Number(t?.gpuSegmentFloatCount)||0)>=8&&Math.max(0,Number(t?.segmentCount)||0)>0);
    let table=frameCtx?._pathFxCanvasMotionTable||null;if(typed(table))return table;
    if(typed(effect?.table)){frameCtx._pathFxCanvasMotionTable=effect.table;return effect.table;}
    try{table=getLayerFramePathFxTable(frameCtx);}catch(_){table=null;}
    if(typed(table)){frameCtx._pathFxCanvasMotionTable=table;return table;}return null;
}
function prepareLayerMotionCanvasFallback(frameCtx,effect){return Boolean(getCanvasMotionCarrierTable(frameCtx,effect));}
function drawCanvasMotionCarrier(ctx,table,layer,cfg,alpha,now){
    const data=table?.gpuSegmentData,count=Math.max(0,Number(table?.segmentCount)||0);if(!(data instanceof Float32Array)||!count)return false;
    const tr=ctx.getTransform?.(),sx=Math.hypot(Number(tr?.a)||0,Number(tr?.b)||0),sy=Math.hypot(Number(tr?.c)||0,Number(tr?.d)||0),scale=Math.sqrt(Math.max(1e-8,sx*sy));
    const width=Math.max(.2,(Number(layer?.strokeWidth)||1.5)*getLayerStrokeWidthMultiplier(layer)*Math.max(.2,Number(cfg?.widthPercent)||100)/100);
    ctx.save();ctx.globalAlpha*=Math.max(0,Math.min(1,Number(alpha)||0));ctx.strokeStyle=layer?.strokeColor||'#ffffff';ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();let pieces=0;
    try{
        for(let i=0;i<count;i++){
            const o=i*8,ax=Number(data[o])||0,ay=Number(data[o+1])||0,bx=Number(data[o+2])||0,by=Number(data[o+3])||0,g0=Number(data[o+4])||0,len=Math.max(0,Number(data[o+5])||0),pathStart=Number(data[o+6])||0;if(!(len>1e-7))continue;
            const dx=bx-ax,dy=by-ay,dl=Math.hypot(dx,dy);if(!(dl>1e-7))continue;const nx=-dy/dl,ny=dx/dl;
            const oa=canvasSpriteMotionOffset(cfg,g0,Math.max(0,g0-pathStart),scale,now),ob=canvasSpriteMotionOffset(cfg,g0+len,Math.max(0,g0+len-pathStart),scale,now);
            const x0=ax+nx*oa,y0=ay+ny*oa,x1=bx+nx*ob,y1=by+ny*ob;ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);pieces++;
        }
        if(pieces)ctx.stroke();
    }finally{ctx.restore();}
    return pieces>0;
}
function renderLayerMotionCanvasFallback(frameCtx,effect){
    const table=getCanvasMotionCarrierTable(frameCtx,effect);if(!table)return false;const {visibleInstances,baseAlpha}=frameCtx;let drew=false;
    for(let i=0;i<visibleInstances.copies.length;i++){
        const copy=visibleInstances.copies[i],a=visibleInstances.alphas[i];if(a<=.0001)continue;mainCtx.save();
        try{if(state.tunnel.active){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}applyLayerFrameEffectTransform(mainCtx,frameCtx);drew=drawCanvasMotionCarrier(mainCtx,table,frameCtx.layer,effect.cfg,baseAlpha*a,effect.now)||drew;}finally{mainCtx.restore();}
    }
    return drew;
}

function renderLayerSpriteCanvasFallback(frameCtx,effect,motionCfg=null){
    const table=getCanvasSpriteCarrierTable(frameCtx,effect);if(!table)return false;const {visibleInstances,baseAlpha}=frameCtx;let drew=false;
    for(let i=0;i<visibleInstances.copies.length;i++){
        const copy=visibleInstances.copies[i],a=visibleInstances.alphas[i];if(a<=.0001)continue;mainCtx.save();
        try{if(state.tunnel.active){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}applyLayerFrameEffectTransform(mainCtx,frameCtx);drew=drawCanvasSpriteCarrier(mainCtx,table,frameCtx.layer,effect.cfg,baseAlpha*a,effect.now,motionCfg)||drew;}finally{mainCtx.restore();}
    }
    return drew;
}

function renderPathFxEmergencyBase(frameCtx){
    if(!frameCtx?.drawLayerInstances)return false;const old=mainCtx.__suppressFill;mainCtx.__suppressFill=true;
    try{frameCtx.drawLayerInstances(mainCtx);canvasLineSpriteStats.emergencyBase++;return true;}catch(_){return false;}finally{if(old===undefined)delete mainCtx.__suppressFill;else mainCtx.__suppressFill=old;}
}

window.__spiroCanvasLineSpriteStatus=()=>({...canvasLineSpriteStats,atlases:canvasLineSpriteAtlasCache.size,customImages:canvasLineSpriteImageCache.size,contract:'Canvas continuous-UV sprite fallback uses the same typed arc carrier and keeps Sprite visible when WebGPU overlay presentation fails.'});

function queueLayerPathFxPass(frameCtx,effect,effectMode,motionCfg=null){
    const {visibleInstances,baseAlpha}=frameCtx;let healthy=true;
    const queueMark=typeof WebGPUPathFxRenderer.overlayQueueMark==='function'?WebGPUPathFxRenderer.overlayQueueMark():null;
    for(let i=0;i<visibleInstances.copies.length;i++){
        const copy=visibleInstances.copies[i],a=visibleInstances.alphas[i];if(a<=.0001)continue;
        mainCtx.save();
        try{
            if(state.tunnel.active){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}
            applyLayerFrameEffectTransform(mainCtx,frameCtx);
            let rec=null;
            if(typeof WebGPUPathFxRenderer.queueOverlayDraw==='function'){
                rec=WebGPUPathFxRenderer.queueOverlayDraw(effect.table,frameCtx.layer,effect.cfg,baseAlpha*a,mainCtx,effectMode,effect.now,motionCfg);
                if(rec?.handled)pathFxFrameQueueStats.queued++;
            }else{
                rec=WebGPUPathFxRenderer.drawToOverlay(effect.table,frameCtx.layer,effect.cfg,baseAlpha*a,mainCtx,effectMode,effect.now,motionCfg);
                pathFxFrameQueueStats.directFallbacks++;
            }
            if(!rec?.handled){healthy=false;pathFxFrameQueueStats.failed++;break;}
        }finally{mainCtx.restore();}
    }
    if(!healthy&&queueMark!==null)try{WebGPUPathFxRenderer.rollbackOverlayQueue?.(queueMark);}catch(_){}
    return healthy;
}

function renderLayerMotionFxPass(frameCtx){
    if(typeof somataCpuBackendForced==='function'&&somataCpuBackendForced()){const effect=frameCtx?.effectsPlan?.motion;if(!effect?.enabled)return;const ok=renderLayerMotionCanvasFallback(frameCtx,effect);renderBackendTelemetry.mark('motion','canvas',ok?'CPU moving-line deformation':'CPU moving-line carrier unavailable',!ok);if(!ok&&frameCtx?._pathFxReplacementCommitted===true)renderPathFxEmergencyBase(frameCtx);return;}
    const effect=frameCtx.effectsPlan?.motion;if(!effect?.enabled)return;
    const strictSpiral=typeof isStrictSpiralWebGPUFrame==='function'?isStrictSpiralWebGPUFrame(frameCtx):Boolean(frameCtx?.layer&&typeof isSpiralLayer==='function'&&isSpiralLayer(frameCtx.layer)&&state?.fourierMode!==true);
    if(frameCtx?._pathFxCanvasSprite===true){
        if(strictSpiral){renderBackendTelemetry.mark('motion','gpu','Spiral Path FX waits for WebGPU; Canvas Sprite bridge disabled');somataGpuContractError?.('SPIRAL_PATH_FX_GPU_UNAVAILABLE',frameCtx,{stage:'carrier'});try{requestMainCanvasRender?.();}catch(_){ }return;}
        renderBackendTelemetry.mark('motion','canvas','deformation folded into Canvas Sprite fallback');return;
    }
    if(frameCtx?._pathFxPrequeuedMotion===true){renderBackendTelemetry.mark('motion','gpu',String(frameCtx?._pathFxReplacementKind||'').startsWith('sprite')?'deformation folded into prequeued textured Sprite':'prequeued Moving Line replacement');return;}WebGPUPathFxRenderer.warmup();
    const sprite=frameCtx.effectsPlan?.sprite;if(sprite?.enabled&&!lineSpritePlacementIsSparse(sprite?.cfg?.mode)&&WebGPUPathFxRenderer.isReady()){renderBackendTelemetry.mark('motion','gpu','deformation folded into textured Sprite');return;}
    if(!WebGPUPathFxRenderer.isReady()){const st=WebGPUPathFxRenderer.status?.()||{};renderBackendTelemetry.mark('motion',strictSpiral?'gpu':'canvas',strictSpiral?(st.lastError?`Spiral GPU Path FX unavailable: ${st.lastError}`:'Spiral GPU Path FX warming'):(st.lastError?`GPU Path FX: ${st.lastError}`:'GPU Path FX warming'),false);if(strictSpiral){somataGpuContractError?.('SPIRAL_PATH_FX_RENDERER_UNAVAILABLE',frameCtx,{status:st});try{requestMainCanvasRender?.();}catch(_){ }}return;}
    const healthy=queueLayerPathFxPass(frameCtx,effect,'motion',effect.cfg);
    renderBackendTelemetry.mark('motion',strictSpiral||healthy?'gpu':'canvas',healthy?`queued WebGPU ${effect.cfg?.type||'seaRaft'} deformation`:(strictSpiral?'Spiral Path FX GPU-only queue unavailable':'Path FX unavailable'),!strictSpiral&&!healthy);
    if(strictSpiral&&!healthy){somataGpuContractError?.('SPIRAL_PATH_FX_QUEUE_FAILED',frameCtx,{type:effect.cfg?.type||null});try{requestMainCanvasRender?.();}catch(_){ }}
}

function renderLayerSpritePass(frameCtx){
    if(typeof somataCpuBackendForced==='function'&&somataCpuBackendForced()){const effect=frameCtx?.effectsPlan?.sprite;if(!effect?.enabled)return;const ok=renderLayerSpriteCanvasFallback(frameCtx,effect,frameCtx.effectsPlan?.motion?.cfg||null);renderBackendTelemetry.mark('sprite','canvas',ok?'CPU preference sprite':'CPU preference sprite unavailable',!ok);return;}
    const effect=frameCtx.effectsPlan?.sprite;if(!effect?.enabled)return;
    const strictSpiral=typeof isStrictSpiralWebGPUFrame==='function'?isStrictSpiralWebGPUFrame(frameCtx):Boolean(frameCtx?.layer&&typeof isSpiralLayer==='function'&&isSpiralLayer(frameCtx.layer)&&state?.fourierMode!==true);
    const motionCfg=frameCtx.effectsPlan?.motion?.enabled===true?frameCtx.effectsPlan.motion.cfg:null;
    // v522.12: a successfully prequeued Sprite is authoritative.  Do not run the Canvas
    // fallback first, otherwise the normal successful fallback masks WebGPU on every frame.
    if(frameCtx?._pathFxPrequeuedSprite===true){renderBackendTelemetry.mark('sprite','gpu','prequeued continuous WebGPU sprite-stroke');return;}
    if(frameCtx?._pathFxCanvasSprite===true){
        if(strictSpiral){renderBackendTelemetry.mark('sprite','gpu','Spiral Sprite waits for WebGPU; Canvas bridge disabled');somataGpuContractError?.('SPIRAL_SPRITE_GPU_UNAVAILABLE',frameCtx,{stage:'carrier'});try{requestMainCanvasRender?.();}catch(_){ }return;}
        const healthy=renderLayerSpriteCanvasFallback(frameCtx,effect,motionCfg);
        if(healthy){renderBackendTelemetry.mark('sprite','canvas','continuous-UV Canvas fallback (WebGPU unavailable)',true);return;}
        if(frameCtx?._pathFxReplacementCommitted===true)renderPathFxEmergencyBase(frameCtx);
    }
    WebGPUPathFxRenderer.warmup();
    if(WebGPUPathFxRenderer.isReady()){
        const healthy=queueLayerPathFxPass(frameCtx,effect,'sprite',motionCfg);
        if(healthy){renderBackendTelemetry.mark('sprite','gpu','queued continuous WebGPU sprite-stroke');return;}
    }
    // Sparse placements do not replace the base in preflight, so non-Spiral compatibility
    // can still use Canvas. Strict Spiral never crosses the GPU/Canvas presentation boundary.
    if(strictSpiral){renderBackendTelemetry.mark('sprite','gpu','Spiral Sprite GPU-only queue unavailable');somataGpuContractError?.('SPIRAL_SPRITE_QUEUE_FAILED',frameCtx);try{requestMainCanvasRender?.();}catch(_){ }return;}
    if(prepareLayerSpriteCanvasFallback(frameCtx,effect)&&renderLayerSpriteCanvasFallback(frameCtx,effect,motionCfg)){
        const st=WebGPUPathFxRenderer.status?.()||{};renderBackendTelemetry.mark('sprite','canvas',st.lastError?`Canvas fallback after WebGPU error: ${st.lastError}`:'Canvas fallback while WebGPU unavailable',true);return;
    }
    renderBackendTelemetry.mark('sprite','canvas','Sprite renderer unavailable',true);
    if(frameCtx?._pathFxReplacementCommitted===true)renderPathFxEmergencyBase(frameCtx);
}

function flushPathFxFrameQueue(){
    if(typeof WebGPUPathFxRenderer?.flushOverlayFrame!=='function')return true;
    const ok=WebGPUPathFxRenderer.flushOverlayFrame();if(ok)pathFxFrameQueueStats.framesFlushed++;return ok;
}

window.__spiroPathFxFrameQueueStatus=()=>({...pathFxFrameQueueStats,renderer:WebGPUPathFxRenderer.status?.()?.overlayQueue||null,contract:'Sprite + Moving Line queue all visible copies across all layers and flush once per main frame.'});
