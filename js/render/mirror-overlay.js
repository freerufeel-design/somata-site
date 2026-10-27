window.__spiroRegisterModule?.('js/render/mirror-overlay');
/**
 * Somata 9.2 — independent optical postprocess.
 * Geometry produces an edge mask in VIEWPORT pixels; the source is any
 * CanvasImageSource (the rendered scene by default, or an external image/video).
 * No geometry or GPU render-path flags are changed by this postprocess.
 * Every active layer consumes the prior layer's reflected output.
 */
window.SomataMirror = (() => {
    let mediaSource = null;
    let mediaUrl = null;
    let frames = [];
    let width = 0, height = 0, dpr = 1;
    let frameSerial = 0;
    let sourceBuffer = null, sourceCtx = null;
    let workingBuffer = null, workingCtx = null;
    let lastMask = Object.freeze({ width:0,height:0,layers:[] });
    const finite = x => Number.isFinite(Number(x));
    function surface(canvas,w,h) {
        if (!canvas) canvas=document.createElement('canvas');
        if (canvas.width !== w) canvas.width=w;
        if (canvas.height !== h) canvas.height=h;
        return canvas;
    }
    function begin(frame) {
        frames=[];
        width=Math.max(1,Number(frame?.w)||1);
        height=Math.max(1,Number(frame?.h)||1);
        dpr=Math.max(.1,Number(frame?.dpr)||1);
        frameSerial=Number(frame?.id)||frameSerial+1;
    }
    function captureLayer(frame) {
        if ((state.mirrorMode!==true && state.roundingGuidesOverlayEnabled!==true) || frame?.layer?.visible===false) return;
        const layer=frame?.layer;
        if (!layer) return;
        // Use already materialized frame geometry, not a new strict-Spiral CPU
        // morph evaluation that would invalidate its GPU ownership contract.
        let paths=frame.geometryPlan?.framePaths || frame.staticDrawData?.paths || frame.canonicalGeometry?.paths;
        if (!Array.isArray(paths) || !paths.length) {
            try { paths=getCachedLayerDrawData(layer)?.paths||[]; } catch (_) { paths=[]; }
        }
        const originX=width/2+(Number(state.panX)||0)+(Number(frame.frame?.motionPanX)||0);
        const originY=height/2+(Number(state.panY)||0)+(Number(frame.frame?.motionPanY)||0);
        const angle=(Number(frame.frame?.motionRotationRad)||0)+(Number(frame.combinedRotationRad)||0);
        const s=(Number(state.zoom)||1)*(Number(frame.combinedScale)||1);
        const ca=Math.cos(angle)*s,sa=Math.sin(angle)*s;
        const maxSegments=state.mirrorMode===true ? 320 : 600;
        const candidates=[];
        // Traverse the same sampled Corridor copies without allocating filter/map arrays.
        const copies=state.tunnel?.active===true && Array.isArray(frame.visibleInstances?.copies)
            ? frame.visibleInstances.copies : null;
        const copyCount=copies?copies.length:1;
        const copyStride=copies?Math.max(1,Math.ceil(copyCount/4)):1;
        for(let copyIndex=0;copyIndex<copyCount;copyIndex+=copyStride){
            const copyScale=copies?Number(copies[copyIndex].scale)||1:1;
            for (const path of paths) {
                const pts=path?.points||[];
                if (pts.length<2) continue;
                const count=(path.closed===true?pts.length:pts.length-1);
                for(let i=0;i<count;i++) {
                    const a=pts[i],b=pts[(i+1)%pts.length];
                    if (!finite(a?.x)||!finite(a?.y)||!finite(b?.x)||!finite(b?.y)) continue;
                    const xx=Number(a.x),yy=Number(a.y),uu=Number(b.x),vv=Number(b.y);
                    const x1=originX+copyScale*(ca*xx-sa*yy),y1=originY+copyScale*(sa*xx+ca*yy);
                    const x2=originX+copyScale*(ca*uu-sa*vv),y2=originY+copyScale*(sa*uu+ca*vv);
                    const len=Math.hypot(x2-x1,y2-y1);
                    if (len<.5||!finite(len)) continue;
                    candidates.push({x1,y1,x2,y2,len,extended:path.extendedProfileRail===true});
                }
            }
        }
        if (candidates.length>maxSegments) {
            // Sampling indices never precede their output index, so compact in-place.
            const step=candidates.length/maxSegments;
            for(let i=0;i<maxSegments;i++)candidates[i]=candidates[Math.floor((i+.5)*step)];
            candidates.length=maxSegments;
        }
        if (candidates.length)frames.push({layerId:layer.id||String(frame.layerIndex||0),
            spiral:layer.spiralEnabled===true,extended:layer.extendedProfileEnabled===true,
            rounding:Number(layer.rounding)||0, segments:candidates});
    }
    function drawCover(ctx,source,w,h) {
        const sw=Number(source?.videoWidth)||Number(source?.naturalWidth)||Number(source?.width)||w;
        const sh=Number(source?.videoHeight)||Number(source?.naturalHeight)||Number(source?.height)||h;
        if (!(sw>0&&sh>0)) return false;
        const scale=Math.max(w/sw,h/sh),dw=sw*scale,dh=sh*scale;
        ctx.drawImage(source,(w-dw)/2,(h-dh)/2,dw,dh);
        return true;
    }
    function clearCanvas(ctx,w,h) {
        ctx.setTransform(1,0,0,1,0,0);
        ctx.clearRect(0,0,w*dpr,h*dpr);
        ctx.setTransform(dpr,0,0,dpr,0,0);
    }
    // Universal geometry mask: each edge defines an infinite tangent and a
    // finite width half-strip on its reflected side. This is deliberately
    // source-independent, so a video frame can replace the scene unchanged.
    function reflectLayer(ctx,source,layer,w,h,quota) {
        const edges=layer.segments;
        const limit=Math.max(1,Math.min(edges.length,quota));
        const dist=Math.hypot(w,h)*1.8;
        const stripWidth=Math.min(dist,Math.max(22,Math.min(w,h)*1.3/Math.sqrt(limit)));
        for(let index=0;index<limit;index++){
            const e=edges[Math.floor((index+.5)*edges.length/limit)];
            const dx=e.x2-e.x1,dy=e.y2-e.y1;
            const L=Math.hypot(dx,dy);if(!(L>1e-4))continue;
            const ux=dx/L,uy=dy/L;
            const nx=-uy,ny=ux;
            // Alternate reflected sides; this produces a bilateral
            // kaleidoscope instead of overwriting everything on one half-plane.
            const side=(index%2===0)?1:-1;
            const px=(e.x1+e.x2)*.5,py=(e.y1+e.y2)*.5;
            const nxSide=side*nx,nySide=side*ny;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(px-ux*dist,py-uy*dist);
            ctx.lineTo(px+ux*dist,py+uy*dist);
            ctx.lineTo(px+ux*dist+nxSide*stripWidth,py+uy*dist+nySide*stripWidth);
            ctx.lineTo(px-ux*dist+nxSide*stripWidth,py-uy*dist+nySide*stripWidth);
            ctx.closePath();ctx.clip();
            // M = I - 2 nnᵀ; t = 2 n(n·P). M mirrors the pixels under the
            // infinitely extended edge without changing geometry source.
            const a=1-2*nx*nx,b=-2*nx*ny,c=b,d=1-2*ny*ny;
            const lineDot=nx*px+ny*py,tx=2*nx*lineDot,ty=2*ny*lineDot;
            ctx.transform(a,b,c,d,tx,ty);
            ctx.drawImage(source,0,0,w,h);
            ctx.restore();
        }
    }
    function drawConstructionGuides(ctx,w,h) {
        if(state.roundingGuidesOverlayEnabled!==true)return;
        const alpha=Math.max(0,Math.min(1,(Number(state.roundingGuideOpacity)||0)/100));
        if(alpha<=0)return;
        ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle=state.roundingGuideColor||'#94a3b8';ctx.lineWidth=1;
        ctx.setLineDash(state.roundingGuidesDashed===false?[]:[4,3]);
        for(const layer of frames){
            if(layer.rounding<=0)continue;
            const segments=layer.segments;
            for(const edge of segments){
                const ux=(edge.x2-edge.x1)/edge.len,uy=(edge.y2-edge.y1)/edge.len;
                const extra=Math.min(75,Math.max(12,edge.len*.4));
                ctx.beginPath();ctx.moveTo(edge.x1-ux*extra,edge.y1-uy*extra);
                ctx.lineTo(edge.x2+ux*extra,edge.y2+uy*extra);ctx.stroke();
            }
        }
        ctx.restore();
    }
    function present(frame,gpuPresented) {
        const canvas=document.getElementById('somataMirrorCanvas');
        if(!canvas)return;
        const enabled=state.mirrorMode===true,guide=state.roundingGuidesOverlayEnabled===true;
        if(!enabled&&!guide){canvas.style.display='none';return;}
        const w=Math.max(1,Number(frame?.w)||width),h=Math.max(1,Number(frame?.h)||height);
        const px=Math.max(1,Math.round(w*dpr)),py=Math.max(1,Math.round(h*dpr));
        if(canvas.width!==px)canvas.width=px;
        if(canvas.height!==py)canvas.height=py;
        const ctx=canvas.getContext('2d',{alpha:true});if(!ctx)return;
        clearCanvas(ctx,w,h);
        if(enabled) {
            sourceBuffer=surface(sourceBuffer,px,py);
            sourceCtx=sourceCtx||sourceBuffer.getContext('2d',{alpha:true});
            workingBuffer=surface(workingBuffer,px,py);
            workingCtx=workingCtx||workingBuffer.getContext('2d',{alpha:true});
            const finalGpu=document.getElementById('finalGpuCanvas');
            const main=document.getElementById('mainCanvas');
            const finalVisible=finalGpu&&getComputedStyle(finalGpu).display!=='none';
            const scene=finalVisible?finalGpu:main;
            let usable=false;
            clearCanvas(sourceCtx,w,h);
            try{if(scene&&scene.width&&scene.height){sourceCtx.drawImage(scene,0,0,w,h);usable=true;}}catch(_){}
            if(!usable&&main&&scene!==main){try{sourceCtx.drawImage(main,0,0,w,h);usable=true;}catch(_){}}
            if(mediaSource){
                const live=Number(mediaSource.readyState)||0;
                if(live===0||live>=2){
                    try{clearCanvas(sourceCtx,w,h);usable=drawCover(sourceCtx,mediaSource,w,h);}catch(_){}
                }
            }
            if(usable){
                // Each layer uses the result of the previous one. Source and
                // destination are separate to avoid Canvas drawImage feedback.
                const usableLayers=[];
                for(const layer of frames){
                    if(layer.segments.length)usableLayers.push(layer);
                    if(usableLayers.length===16)break;
                }
                const budget=Math.max(12,Math.floor(48/Math.max(1,usableLayers.length)));
                for(const layer of usableLayers){
                    clearCanvas(workingCtx,w,h);
                    workingCtx.drawImage(sourceBuffer,0,0,w,h);
                    reflectLayer(workingCtx,sourceBuffer,layer,w,h,budget);
                    const c=sourceBuffer;sourceBuffer=workingBuffer;workingBuffer=c;
                    const x=sourceCtx;sourceCtx=workingCtx;workingCtx=x;
                }
                ctx.drawImage(sourceBuffer,0,0,w,h);
            }
        }
        drawConstructionGuides(ctx,w,h);
        canvas.style.display='block';
        lastMask={width:w,height:h,frameId:frameSerial,layers:frames.map(f=>({layerId:f.layerId,spiral:f.spiral,extended:f.extended,segments:f.segments.map(e=>({x1:e.x1,y1:e.y1,x2:e.x2,y2:e.y2}))}))};
    }
    // Public source contract; the picker can be attached later without
    // changing masks or reflection, and source can be a playing <video>.
    function setSource(source) {mediaSource=source||null;return true;}
    function setSourceUrl(url,kind='image') {
        if(mediaUrl?.startsWith('blob:'))URL.revokeObjectURL(mediaUrl);
        mediaUrl=url||null;
        if(!url){mediaSource=null;return null;}
        const el=document.createElement(kind==='video'?'video':'img');
        if(kind==='video'){el.muted=true;el.loop=true;el.playsInline=true;el.autoplay=true;}
        el.src=url;
        if(kind==='video')el.play().catch(()=>{});
        mediaSource=el;
        return el;
    }
    return Object.freeze({begin,captureLayer,present,setSource,setSourceUrl,getMask:()=>lastMask,getSource:()=>mediaSource});
})();
