window.__spiroRegisterModule?.('js/render/geometry-circles-pass');

// Geometry-circle overlay is a self-contained geometry feature. It consumes prepared
// geometry and emits its own GPU commands; changing Spiral/Morph/Base orchestration does
// not alter the circle fitting or overlay contract.
function distanceOriginToSegment(a,b){
    const ax=Number(a?.x)||0,ay=Number(a?.y)||0,bx=Number(b?.x)||0,by=Number(b?.y)||0;
    const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
    if(den<=1e-12)return Math.hypot(ax,ay);
    const t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/den));
    return Math.hypot(ax+dx*t,ay+dy*t);
}
function solveCircle3x3(m,b){
    const a=[m[0].slice(),m[1].slice(),m[2].slice()],v=b.slice();
    for(let c=0;c<3;c++){
        let pivot=c;for(let r=c+1;r<3;r++)if(Math.abs(a[r][c])>Math.abs(a[pivot][c]))pivot=r;
        if(Math.abs(a[pivot][c])<1e-10)return null;
        if(pivot!==c){[a[c],a[pivot]]=[a[pivot],a[c]];[v[c],v[pivot]]=[v[pivot],v[c]];}
        const div=a[c][c];for(let j=c;j<3;j++)a[c][j]/=div;v[c]/=div;
        for(let r=0;r<3;r++){if(r===c)continue;const f=a[r][c];if(Math.abs(f)<1e-14)continue;for(let j=c;j<3;j++)a[r][j]-=f*a[c][j];v[r]-=f*v[c];}
    }
    return v;
}
function fitCircleThroughKeyPoints(points){
    if(!Array.isArray(points)||points.length<3){
        const r=points?.length?points.reduce((sum,p)=>sum+Math.hypot(Number(p?.x)||0,Number(p?.y)||0),0)/points.length:0;
        return r>0?{x:0,y:0,r}:null;
    }
    let sxx=0,sxy=0,sx=0,syy=0,sy=0,n=0,bx=0,by=0,bc=0;
    for(const p of points){const x=Number(p?.x)||0,y=Number(p?.y)||0,q=x*x+y*y;const ax=2*x,ay=2*y;sxx+=ax*ax;sxy+=ax*ay;sx+=ax;syy+=ay*ay;sy+=ay;n++;bx+=ax*q;by+=ay*q;bc+=q;}
    const sol=solveCircle3x3([[sxx,sxy,sx],[sxy,syy,sy],[sx,sy,n]],[bx,by,bc]);
    if(!sol)return null;const [cx,cy,c]=sol,r2=cx*cx+cy*cy+c;if(!(r2>1e-9))return null;return{x:cx,y:cy,r:Math.sqrt(r2)};
}
function computeLayerGeometryCircles(paths,cfg){
    const all=[],keys=[];let outer=0,inner=Infinity;
    for(const path of paths||[]){
        const pts=path?.points||[],flags=path?.cornerFlags||[];if(!pts.length)continue;
        for(let i=0;i<pts.length;i++){const p=pts[i],r=Math.hypot(Number(p?.x)||0,Number(p?.y)||0);outer=Math.max(outer,r);all.push(p);if(flags[i])keys.push(p);}
        for(let i=0;i<pts.length-1;i++)inner=Math.min(inner,distanceOriginToSegment(pts[i],pts[i+1]));
        if(path.closed&&pts.length>1)inner=Math.min(inner,distanceOriginToSegment(pts[pts.length-1],pts[0]));
    }
    if(!all.length)return[];if(!Number.isFinite(inner))inner=Math.min(...all.map(p=>Math.hypot(Number(p?.x)||0,Number(p?.y)||0)));
    const out=[];
    if(cfg.circumscribed===true&&outer>0)out.push({kind:'circumscribed',x:0,y:0,r:outer});
    if(cfg.inscribed===true&&inner>0)out.push({kind:'inscribed',x:0,y:0,r:inner});
    if(cfg.median===true&&outer>0&&inner>0)out.push({kind:'median',x:0,y:0,r:(outer+inner)/2});
    if(cfg.keyPoints===true){
        const source=keys.length>=3?keys:all;const fitted=fitCircleThroughKeyPoints(source);if(fitted)out.push({kind:'keyPoints',...fitted});
    }
    return out;
}
function buildGeometryCircleGPUCommands(frameCtx,circles){
    if(!GeometryGPURenderer.isAvailable()||!circles?.length)return null;
    const layer=frameCtx.layer,copies=frameCtx.visibleInstances?.copies||[{scale:1}],alphas=frameCtx.visibleInstances?.alphas||[1];
    const rec=createGeometryGLRecordingContext(mainCtx);rec.__suppressFill=true;
    try{
        for(let i=0;i<copies.length;i++){
            const copy=copies[i],alpha=Number(alphas[i]??1);if(alpha<=.001)continue;
            rec.save();
            if(state.tunnel.active){applyMotionTunnelLag(rec,copy,frameCtx.layer);rec.scale(Number(copy?.scale)||1,Number(copy?.scale)||1);}
            applyLayerFrameEffectTransform(rec,frameCtx);
            rec.globalAlpha=Math.max(0,Math.min(1,frameCtx.baseAlpha*alpha));
            rec.strokeStyle=getTunnelCopyColor(layer.strokeColor||'#ffffff',copy,frameCtx.tunnelPaletteProfile);rec.fillStyle='transparent';
            rec.lineWidth=Math.max(.5,Number(frameCtx.strokeWidth)||1.5)/Math.max(.001,Math.abs(Number(frameCtx.combinedScale)||1));
            for(const c of circles){if(!(c.r>0))continue;rec.beginPath();rec.arc(c.x,c.y,c.r,0,Math.PI*2);rec.stroke();}
            rec.restore();
        }
    }catch(_){return null;}
    return rec.unsupported||!rec.commands?.length?null:rec.commands;
}
function getLayerGeometryCircleFrameData(frameCtx){
    if(frameCtx?._geometryCircleFrameData!==undefined)return frameCtx._geometryCircleFrameData;
    const layer=frameCtx?.layer,cfg=getLiveGeometryCircleConfig(frameCtx);if(!layer||cfg?.enabled!==true||(!cfg.circumscribed&&!cfg.inscribed&&!cfg.median&&!cfg.keyPoints))return frameCtx?(frameCtx._geometryCircleFrameData=null):null;
    const paths=getLayerFrameAuxiliaryPaths(frameCtx),circles=computeLayerGeometryCircles(paths,cfg);if(!circles.length)return frameCtx?(frameCtx._geometryCircleFrameData=null):null;
    const gpuAllowed=(typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed());
    const commands=gpuAllowed&&!state.showRoundingGuides?buildGeometryCircleGPUCommands(frameCtx,circles):null,data={circles,commands};if(frameCtx)frameCtx._geometryCircleFrameData=data;return data;
}
function renderLayerGeometryCirclesPass(frameCtx){
    const data=getLayerGeometryCircleFrameData(frameCtx);if(!data)return;const {circles,commands}=data,layer=frameCtx.layer;

    if(frameCtx.frame?.gpuLayerSceneDeferred&&commands?.length){
        const scene=SomataLayerSceneService.resident(frameCtx);
        const rec=scene?.texture?WebGPUStrokeRenderer.encodeGeometryCirclesToLayerScene?.(scene.texture,commands):null;
        if(rec?.handled){if(rec.commandBuffer)SomataLayerSceneService.queue(frameCtx,somataEffectPhase('geometry',28),rec.commandBuffer,'geometry-circles');renderBackendTelemetry.mark('geometryCircles','gpu','resident Layer Scene');return;}
        if(SomataGeometryPolicy.isStrict(frameCtx)){renderBackendTelemetry.mark('geometryCircles','gpu','strict Spiral geometry circles GPU unavailable');renderBackendTelemetry.mark('geometry','gpu','strict Spiral geometry circles GPU unavailable');somataGpuContractError('SPIRAL_GEOMETRY_CIRCLES_GPU_UNAVAILABLE',frameCtx,{stage:'layer-scene'});try{requestMainCanvasRender?.();}catch(_){}return;}
        if(!materializeDeferredLayerScene(frameCtx))return;
    }
    if(SomataGeometryPolicy.isStrict(frameCtx)){renderBackendTelemetry.mark('geometryCircles','gpu','strict Spiral geometry circles missing resident Layer Scene');renderBackendTelemetry.mark('geometry','gpu','strict Spiral geometry circles missing resident Layer Scene');somataGpuContractError('SPIRAL_GEOMETRY_CIRCLES_NO_SCENE',frameCtx,{stage:'resident-scene'});try{requestMainCanvasRender?.();}catch(_){}return;}
    if(commands&&GeometryGPURenderer.render(commands,mainCtx)){renderBackendTelemetry.mark('geometryCircles','gpu','Geometry GPU renderer');return;}
    somataGpuDiagnosticError('geometry-circles','render','GPU geometry circles unavailable; pass skipped',frameCtx,{fallback:'skip-geometry-circles',recovered:true});
    try{requestMainCanvasRender?.();}catch(_){}

}

window.SomataGeometryCircles=Object.freeze({
    compute:computeLayerGeometryCircles,
    frameData:getLayerGeometryCircleFrameData,
    render:renderLayerGeometryCirclesPass
});
