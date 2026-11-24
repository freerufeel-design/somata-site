// A narrow, shared resident Fourier carrier for arbitrary contour lamps.
// CPU retains semantic identities, density and visual envelopes; the vertex
// shader samples the exact same screen-space polyline as the indexed stroke.
const FOURIER_LAMP_WGSL = /* wgsl */ `
fn sampleFourierLamp(fraction:f32)->vec2<f32> {
    let first=morphArcSegments[0u];
    let last=morphArcSegments[287u];
    let closed=u.root1.w < -1.5;
    let total=last.w+select(0.0,distance(last.xy,first.xy),closed);
    let arcTarget=clamp(fraction,0.0,1.0)*total;
    if(arcTarget>=last.w){
        if(!closed){return last.xy;}
        let span=total-last.w;
        return mix(last.xy,first.xy,clamp((arcTarget-last.w)/max(span,1e-12),0.0,1.0));
    }
    var lo=0u; var hi=287u;
    loop { if(hi-lo<=1u){break;} let mid=(lo+hi)/2u;
        if(morphArcSegments[mid].w<arcTarget){lo=mid;}else{hi=mid;}
    }
    let a=morphArcSegments[lo]; let b=morphArcSegments[hi];
    return mix(a.xy,b.xy,clamp((arcTarget-a.w)/max(b.w-a.w,1e-12),0.0,1.0));
}
`;
function fourierLampPlanEligible(frameCtx, configState, lampReady) {
  const plan=frameCtx?.effectsPlan?.lamps, set=plan?.sets?.[0], cfg=set?.config || plan?.baseConfig;
  if (!lampReady || configState?.tunnel?.active || configState?.lamps?.freezeLight || configState?.lamps?.freezeRain ||
      frameCtx?.geometryPlan?.kind !== 'static' || frameCtx.geometryPlan.dynamic || frameCtx.geometryMorphEnabled ||
      frameCtx.morphFrameActive || frameCtx.greenMorphEnabled || frameCtx.minimalFadeEnabled || frameCtx.forcedLampMorph ||
      frameCtx.staticDrawData?.paths?.length !== 1 || plan?.enabled !== true || plan.tunnelActive ||
      plan.sets?.length !== 1 || plan.instances?.copies?.length !== 1 || set.gpuLampNative ||
      cfg?.positionMode !== 'arbitrary' || cfg.morphMotionMode === 'key' || cfg.extinguishIntersections === true || cfg.webgl === false) return false;
  const snap=typeof cfg.snapToContour==='boolean'?cfg.snapToContour:
    typeof cfg.snapToPolygon==='boolean'&&typeof cfg.stickToRounding==='boolean'?cfg.snapToPolygon||cfg.stickToRounding:
    typeof cfg.snapToPolygon==='boolean'?cfg.snapToPolygon:typeof cfg.stickToRounding==='boolean'?cfg.stickToRounding:true;
  return snap && set.points?.length>0 && set.points.every(p=>p.pathIndex===0 && Number.isFinite(p.lampAttachFraction) && p.lampAttachFraction>=0 && p.lampAttachFraction<=1);
}
function fourierLampSingleRail(commands) {
  const paths=commands?.flatMap(c=>c.subpaths || []) || [];
  if(paths.length!==1 || paths[0].gpuFourier?.rail?.outCount!==288 || paths[0].points?.length) return null;
  const rail=paths[0].gpuFourier, m=rail.matrix;
  if(!m || m.length!==6 || !m.every(Number.isFinite)) return null;
  const sx=Math.hypot(m[0],m[1]), sy=Math.hypot(m[2],m[3]);
  if(sx<=1e-8 || Math.abs(sx-sy)>sx*1e-6 || Math.abs(m[0]*m[2]+m[1]*m[3])>sx*sy*1e-6) return null;
  return rail;
}
export { FOURIER_LAMP_WGSL, fourierLampPlanEligible, fourierLampSingleRail };
