// SpiroStar v521 — packed Corner Lamp resource for topology Morph.
// Preserve the historical stateful corner identity/inertia machine, but feed it directly from
// MorphFrame's aligned numeric endpoint arrays. This removes CPU Morph path object materialization,
// generic path-table construction and duplicate arc walks. The remaining numeric O(N) scan is
// allocation-light and the stateful visible population stays bounded <=260.
window.__spiroRegisterModule?.('js/geometry/lamp-corner-resource');

const GPU_LAMP_CORNER_MAX=260;
const gpuLampCornerRuntime={resources:new WeakMap(),resourceSet:new Set(),lastError:'',stats:{requests:0,builds:0,hits:0,framePointEvaluations:0,cornerTests:0,nearestSegmentTests:0,canonicalIdentityHits:0,legacyIdentityMigrations:0,cpuPathBuildsAvoided:0,pathTableBuildsAvoided:0,frameOutputs:0,fallbacks:0}};

function gpuLampCornerPlanForFrame(frameCtx){const li=Number(frameCtx?.layerIndex)||0,src=runtimeState?.morph?.sourceGeometry?.[li]||[],dst=runtimeState?.morph?.targetGeometry?.[li]||[];if(!src.length||!dst.length||typeof getMorphFrameInterpolationPlan!=='function')return null;return getMorphFrameInterpolationPlan(li,src,dst,'canonical');}
function gpuMorphCornerLampIneligibleReason(frameCtx){
    if(!frameCtx?.layer)return'no-frame';if(!frameCtx.morphFrameActive||frameCtx.greenMorphEnabled||frameCtx.minimalFadeEnabled)return'not-blue-topology-morph';if(frameCtx.blueMorphProvider?.mode==='fade')return'fade-provider';if(!['topology','calm'].includes(state?.morph?.mode))return'morph-mode-needs-compat';
    if(typeof gpuMorphLampPositionMode==='function'&&gpuMorphLampPositionMode(frameCtx)!=='corners')return'not-corner-lamps';const cfg=frameCtx.layerLampConfig||ensureLayerLampState?.(frameCtx.layer)||state.lamps||{},motion=cfg?.morphMotionMode||'linear';if(!['linear','ghost'].includes(motion))return'corner-motion-needs-compat';
    if(typeof gpuMorphArcIneligibleReason==='function'){const r=gpuMorphArcIneligibleReason(frameCtx);if(r)return r;}const plan=gpuLampCornerPlanForFrame(frameCtx);if(!plan?.records?.some(r=>r?.sp&&r?.dp&&r.n>1))return'phase-plan-unavailable';return'';
}
function canUseGpuMorphCornerLampsFrame(frameCtx){return gpuMorphCornerLampIneligibleReason(frameCtx)==='';}
function gpuLampCornerPoint(rec,i,t,out=null){
    const n=rec.n,idx=((i%n)+n)%n,o=idx*3,u=(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(t):Math.max(0,Math.min(1,Number(t)||0)));
    if(rec.useRadial&&rec.srcPolarAligned&&rec.dstPolarAligned){const po=idx*2,sr=rec.srcPolarAligned[po],sa=rec.srcPolarAligned[po+1],tr=rec.dstPolarAligned[po],ta=rec.dstPolarAligned[po+1]+(rec.rotates?rec.rotationDelta*(1-u):0);let d=ta-sa;if(state?.morph?.mode==='calm')d=Math.max(-Math.PI*4,Math.min(Math.PI*4,d));const rr=sr+(tr-sr)*u,aa=sa+d*u;const p=out||{x:0,y:0};p.x=rr*Math.cos(aa);p.y=rr*Math.sin(aa);return p;}
    const sx=rec.srcXYZ[o],sy=rec.srcXYZ[o+1],tx0=rec.dstXYZ[o],ty0=rec.dstXYZ[o+1],rot=rec.rotates?rec.rotationDelta*(1-u):0,c=Math.cos(rot),s=Math.sin(rot),tx=tx0*c-ty0*s,ty=tx0*s+ty0*c;const p=out||{x:0,y:0};p.x=sx+(tx-sx)*u;p.y=sy+(ty-sy)*u;return p;
}
function buildGpuLampCornerResource(frameCtx){
    const layer=frameCtx?.layer,plan=gpuLampCornerPlanForFrame(frameCtx);if(!layer||!plan)return null;const serial=Math.max(0,Number(runtimeState?.morph?.lampCycleSerial)||0);let hit=gpuLampCornerRuntime.resources.get(layer);if(hit&&hit.serial===serial&&hit.planSerial===plan.serial){gpuLampCornerRuntime.stats.hits++;return hit;}
    const paths=[];for(const rec of plan.records){if(!rec?.sp||!rec?.dp||rec.n<2)continue;const n=rec.n,segCapacity=rec.closed?n:n-1;paths.push({rec,n,closed:Boolean(rec.closed),flags:Array.isArray(rec.sp?.cornerFlags)?rec.sp.cornerFlags:(Array.isArray(rec.dp?.cornerFlags)?rec.dp.cornerFlags:[]),x:new Float64Array(n),y:new Float64Array(n),cum:new Float64Array(segCapacity),len:new Float64Array(segCapacity),active:new Uint32Array(segCapacity),scratch:{x:0,y:0},activeCount:0,total:0});}
    if(!paths.length)return null;hit={layer,layerIndex:frameCtx.layerIndex,serial,planSerial:plan.serial,paths};gpuLampCornerRuntime.resources.set(layer,hit);gpuLampCornerRuntime.resourceSet.add(hit);gpuLampCornerRuntime.stats.builds++;return hit;
}
function updateGpuLampCornerPath(path,t){
    const {rec,n,x,y,cum,len,active,closed,scratch}=path;for(let i=0;i<n;i++){gpuLampCornerPoint(rec,i,t,scratch);x[i]=scratch.x;y[i]=scratch.y;}
    const count=closed?n:n-1;let total=0,write=0;
    for(let i=0;i<count;i++){const j=(i+1)%n,d=Math.hypot(x[j]-x[i],y[j]-y[i]);if(d>1e-6){cum[i]=total;len[i]=d;active[write++]=i;total+=d;}else{cum[i]=total;len[i]=0;}}
    path.activeCount=write;path.total=total;gpuLampCornerRuntime.stats.framePointEvaluations+=n;return path;
}
function gpuLampCornerNearestFraction(path,ax,ay){
    const {n,x,y,cum,len,active,activeCount,total}=path;if(!(total>1e-8)||!activeCount)return 0;let bestD=Infinity,bestDistance=0;
    // Same segment order and strict '<' tie rule as nearestLampFractionOnPath().
    for(let ai=0;ai<activeCount;ai++){const i=active[ai],j=(i+1)%n,vx=x[j]-x[i],vy=y[j]-y[i],den=vx*vx+vy*vy,u=den>1e-12?Math.max(0,Math.min(1,((ax-x[i])*vx+(ay-y[i])*vy)/den)):0,qx=x[i]+vx*u,qy=y[i]+vy*u,dx=qx-ax,dy=qy-ay,d=dx*dx+dy*dy;if(d<bestD){bestD=d;bestDistance=cum[i]+len[i]*u;}gpuLampCornerRuntime.stats.nearestSegmentTests++;}
    return Math.max(0,Math.min(1,bestDistance/total));
}
function gpuLampCornerPointAtFraction(path,fraction){
    const {n,closed,x,y,cum,len,active,activeCount,total}=path;if(!(total>1e-8)||n<2||!activeCount)return null;let f=Number(fraction)||0;f=closed?((f%1)+1)%1:Math.max(0,Math.min(1,f));const target=Math.min(total-1e-9,Math.max(0,f*total));let lo=0,hi=activeCount-1;while(lo<hi){const mid=(lo+hi)>>1,i=active[mid];if(cum[i]+len[i]<target)lo=mid+1;else hi=mid;}const i=active[lo],j=(i+1)%n,u=len[i]>1e-12?Math.max(0,Math.min(1,(target-cum[i])/len[i])):0;return{x:x[i]+(x[j]-x[i])*u,y:y[i]+(y[j]-y[i])*u};
}
function gpuLampCornerAdvanceFraction(current,target,path,dtMs){
    let c=Number(current)||0,t=Number(target)||0,delta=t-c;if(path.closed)delta=((delta+.5)%1+1)%1-.5;const total=Math.max(1,Number(path.total)||1),cycleMs=Math.max(100,Number(runtimeState.morph?.transitionMs)||Math.max(.5,Number(state.morph?.intervalSec)||5)*1000),cycleSec=Math.max(.1,cycleMs/1000),speed=Math.max(120,total/cycleSec*2.5),step=(speed*Math.max(0,dtMs)/1000)/total;if(Math.abs(delta)<=step+1e-9)c=t;else c+=Math.sign(delta)*step;return path.closed?((c%1)+1)%1:Math.max(0,Math.min(1,c));
}
function evaluateGpuLampCornerResource(resource,t,maxPoints=GPU_LAMP_CORNER_MAX,nowMs=performance.now()){
    const layer=resource?.layer;if(!layer||!resource?.paths?.length)return[];const now=Number.isFinite(Number(nowMs))?Number(nowMs):performance.now();cleanupLampRuntime(now);const layerKey=String(layer.id||resource.layerIndex),targets=[];
    for(let pi=0;pi<resource.paths.length;pi++){const path=updateGpuLampCornerPath(resource.paths[pi],t),n=path.n,flags=path.flags||[];if(n<2)continue;for(let i=0;i<n;i++){if(!path.closed&&(i===0||i===n-1))continue;const prev=(i-1+n)%n,next=(i+1)%n,ax=path.x[i]-path.x[prev],ay=path.y[i]-path.y[prev],bx=path.x[next]-path.x[i],by=path.y[next]-path.y[i],al=Math.hypot(ax,ay),bl=Math.hypot(bx,by);if(al<1e-6||bl<1e-6)continue;const dot=Math.max(-1,Math.min(1,(ax*bx+ay*by)/(al*bl))),turn=Math.acos(dot)*180/Math.PI;gpuLampCornerRuntime.stats.cornerTests++;if(!flags[i]&&turn<9)continue;const q=Math.max(0,Math.min(1,(turn-2)/16)),strength=q*q*(3-2*q);if(strength<=.002)continue;const fraction=path.total>1e-8?Math.max(0,Math.min(1,(Number(path.cum[i])||0)/path.total)):0;targets.push({pathIndex:pi,pointIndex:i,fraction,strength});if(targets.length>=maxPoints)break;}if(targets.length>=maxPoints)break;}
    const prefix=`${layerKey}:corner:`,existing=[];for(const [key,e] of lampMotionRuntime.corners){if(key.startsWith(prefix))existing.push([key,e]);}const used=new Set();
    for(const target of targets){const path=resource.paths[target.pathIndex],canonical=`${prefix}${target.pathIndex}:${target.pointIndex}`;let key=canonical,e=lampMotionRuntime.corners.get(canonical);
        if(e){used.add(canonical);gpuLampCornerRuntime.stats.canonicalIdentityHits++;}
        else{
            // Migration is needed only for runtime records created by older builds. Once migrated,
            // every subsequent frame is an O(1) path+vertex lookup instead of all-pairs rematching.
            let best=null,bestCost=Infinity;for(const [oldKey,oldEntry] of existing){if(used.has(oldKey)||oldEntry.pathIndex!==target.pathIndex)continue;let d=Math.abs((Number(oldEntry.targetS??oldEntry.s)||0)-target.fraction);if(path?.closed)d=Math.min(d,1-d);if(d<bestCost){bestCost=d;best=[oldKey,oldEntry];}}
            if(best&&bestCost<.34){const oldKey=best[0];e=best[1];used.add(oldKey);lampMotionRuntime.corners.delete(oldKey);lampMotionRuntime.corners.set(canonical,e);used.add(canonical);gpuLampCornerRuntime.stats.legacyIdentityMigrations++;}
            else{e={pathIndex:target.pathIndex,s:target.fraction,targetS:target.fraction,level:0,last:now,lastSeen:now};lampMotionRuntime.corners.set(canonical,e);used.add(canonical);}
        }
        e.pathIndex=target.pathIndex;e.targetS=target.fraction;e.target=Math.max(0,Math.min(1,Number(target.strength)||0));e.lastSeen=now;
    }
    for(const [key,e] of existing)if(!used.has(key))e.target=0;const out=[];
    for(const [key,e] of lampMotionRuntime.corners){if(!key.startsWith(prefix))continue;const path=resource.paths[e.pathIndex];if(!path){e.target=0;continue;}const rawDt=Math.max(0,now-(e.last||now)),dt=rawDt>1250?0:rawDt;e.last=now;const inertiaMs=lampCornerInertiaMs(state.lamps),targetLevel=Math.max(0,Math.min(1,Number(e.target)||0));e.level=moveLampLevel(e.level,targetLevel,dt,inertiaMs);e.s=gpuLampCornerAdvanceFraction(e.s,e.targetS,path,dt);if(Math.abs(e.level-targetLevel)>.002)lampAdaptiveFrame.needsSettle=true;const p=gpuLampCornerPointAtFraction(path,e.s);if(p&&e.level>.002)out.push({...p,pathIndex:e.pathIndex,lampLevel:e.level,lampId:key,lampSeed:lampHash32(key)});}
    gpuLampCornerRuntime.stats.frameOutputs+=out.length;return capLampPointList(out,maxPoints);
}
function prepareGpuMorphCornerLampFrame(frameCtx,maxPoints=GPU_LAMP_CORNER_MAX){
    gpuLampCornerRuntime.stats.requests++;const reason=gpuMorphCornerLampIneligibleReason(frameCtx);if(reason){gpuLampCornerRuntime.stats.fallbacks++;gpuLampCornerRuntime.lastError=reason;return null;}const rec=buildGpuLampCornerResource(frameCtx);if(!rec)return null;const t=(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(frameCtx.blueMorphProvider?.geometryT):Math.max(0,Math.min(1,Number(frameCtx.blueMorphProvider?.geometryT)||0)));const sharedNow=Number(frameCtx?.frame?.now??frameCtx?.now);let points=evaluateGpuLampCornerResource(rec,t,maxPoints,Number.isFinite(sharedNow)?sharedNow:performance.now());points=preserveBlueMorphLampIdentity(frameCtx.layerIndex,points);gpuLampCornerRuntime.stats.cpuPathBuildsAvoided++;gpuLampCornerRuntime.stats.pathTableBuildsAvoided+=rec.paths.length;return{gpuLampNative:true,gpuLampNativeKind:'bounded-corners',gpuLampCornerResource:rec,gpuMorphT:t,frameId:Number(frameCtx.frameId)||0,attachmentPoints:points,attachmentCount:points.length};
}
window.__spiroGpuLampCornerStatus=()=>({lastError:gpuLampCornerRuntime.lastError,stats:{...gpuLampCornerRuntime.stats},resources:[...gpuLampCornerRuntime.resourceSet].map(r=>({layerIndex:r.layerIndex,serial:r.serial,pathCount:r.paths.length,pointCount:r.paths.reduce((n,p)=>n+p.n,0)})),contract:'Topology/Calm Corner lamps read MorphFrame aligned packed endpoints directly. Exact vertex arc fractions come from the already-built cumulative path table (no per-corner nearest-segment scan); lamp IDs are deterministic path+vertex keys with O(1) steady-state identity lookup, and frame time is shared with the main frame clock. No CPU Morph path objects or generic path-length tables are materialized.'});
