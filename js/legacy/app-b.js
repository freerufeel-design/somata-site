// Somata 6.9 Modular
// Compatibility bridge B — rendering/effects not yet extracted
window.__spiroRegisterModule?.('js/legacy/app-b');
        // v59 — persistent lamp attachment runtime.  A lamp stores its position
        // as a normalized distance along its own polygon path.  When the nearest
        // attachment changes, the target distance changes but the lamp slides along
        // the path instead of jumping to the new point.
        // v181 — blue Morphing lamp identity handoff.  Geometry pairing may rotate/re-index
        // a closed contour between cycles.  Lamp appearance (scatter/size/brightness) must
        // follow the physical lamp nearest to its previous position, not the new vertex index.
        const lampMotionRuntime = { snap:new Map(), calm:new Map(), corners:new Map(), arbitraryCounts:new Map(), arbitraryPathCounts:new Map(), blueMorph:new Map(), linearGates:new Map(), topologyLinearPlans:new Map(), lastCleanup:0 };
        // v535 — every visual lamp interpolator reads the timestamp of the active render frame.
        // Multiple performance.now() samples inside one paint can disagree by several ms on a
        // heavy frame and used to make attachment inertia / colour wave / adaptive exposure look
        // like they changed speed when FPS changed.  Outside a paint there is no shared clock,
        // so fall back to the monotonic browser timer.
        function lampVisualNow(){
            const n=Number(renderRuntime?.active?renderRuntime.now:NaN);
            return Number.isFinite(n)&&n>0?n:performance.now();
        }

        // v252 — Direct geometry lamp Morphing keeps physical travel metrics for
        // colour/randomness. "Ghost" preserves v250 nearest-key visibility. "Linear"
        // uses parent-radius split / receiver-radius merge visibility. Legacy/fallback
        // collectors retain endpoint travel if exact geometry is unavailable.
        function lampLinearMorphProgress(fallback=0) {
            const p=Number(runtimeState.morph?.progress);
            return Math.max(0,Math.min(1,Number.isFinite(p)?p:(Number(fallback)||0)));
        }
        function lampEndpointTravelProgress(sx,sy,cx,cy,tx,ty,fallbackT=0) {
            sx=Number(sx)||0; sy=Number(sy)||0; cx=Number(cx)||0; cy=Number(cy)||0; tx=Number(tx)||0; ty=Number(ty)||0;
            const total=Math.hypot(tx-sx,ty-sy);
            if(!(total>1e-6))return Math.max(0,Math.min(1,Number(fallbackT)||0));
            const remaining=Math.hypot(tx-cx,ty-cy);
            return Math.max(0,Math.min(1,1-remaining/total));
        }
        function lampTopologyPresence(sourcePresent,targetPresent,travelProgress=0) {
            if(!['linear','ghost'].includes(getLampEvaluationConfig()?.morphMotionMode) || !runtimeState.morph?.active) return 1;
            const u=Math.max(0,Math.min(1,Number(travelProgress)||0));
            if(sourcePresent&&targetPresent)return 1;
            if(sourcePresent)return 1-u;
            if(targetPresent)return u;
            return 0;
        }
        function lampAdaptivePointCount(points,cfg=getLampEvaluationConfig()) {
            if(!Array.isArray(points)||!points.length)return 0;
            if(!['linear','ghost'].includes(cfg?.morphMotionMode) || !runtimeState.morph?.active)return points.length;
            let sum=0;
            for(const p of points)sum+=Math.max(0,Math.min(1,p?.lampPresence===undefined?1:Number(p.lampPresence)||0));
            return Math.max(.001,sum);
        }

        function preserveBlueMorphLampIdentity(layerIndex, points) {
            if(!Array.isArray(points) || !points.length || !runtimeState.morph?.active) return points || [];
            const layer=state.layers?.[layerIndex];
            const layerKey=String(layer?.id ?? layerIndex);
            const serial=Math.max(0, Number(runtimeState.morph.lampCycleSerial) || 0);
            const now=lampVisualNow();
            const HANDOFF_MS=140;
            const linearMode=['linear','ghost'].includes(getLampEvaluationConfig()?.morphMotionMode);
            let rt=lampMotionRuntime.blueMorph.get(layerKey);
            if(!rt){
                rt={serial:-1, assignments:new Map(), last:[], nextStable:0};
                lampMotionRuntime.blueMorph.set(layerKey,rt);
            }

            const rawKey=(p,i)=>String(p?.lampId ?? `slot:${Number.isInteger(p?.pathIndex)?p.pathIndex:-1}:${Number.isInteger(p?.vertexIndex)?p.vertexIndex:i}`);
            // Rank source and target populations separately. This keeps the full rainbow
            // distributed over the population that actually exists at each end of the phase.
            const sourceCount=Math.max(1,points.reduce((n,p)=>n+(p?.lampSourcePresent===false?0:1),0));
            const targetCount=Math.max(1,points.reduce((n,p)=>n+(p?.lampTargetPresent===false?0:1),0));
            let sourceRank=0,targetRank=0;
            const sourcePhase=new Array(points.length),targetPhase=new Array(points.length);
            for(let i=0;i<points.length;i++){
                const p=points[i];
                sourcePhase[i]=p?.lampSourcePresent===false?NaN:(sourceRank++/sourceCount);
                targetPhase[i]=p?.lampTargetPresent===false?NaN:(targetRank++/targetCount);
            }
            const previousAll=Array.isArray(rt.last)?rt.last:[];
            // At an exact merge endpoint several retiring lamps may occupy the same
            // coordinate but have zero contribution. They must NOT seed the next phase
            // palette/brightness: only the lamps that were actually visible in the last
            // painted frame are eligible. This is crucial for 1 -> many splits.
            const previousVisible=previousAll.filter(q=>Math.max(0,Math.min(1,q?.lampPresence===undefined?1:Number(q.lampPresence)||0))>.001);
            const previous=previousVisible.length?previousVisible:previousAll;
            const nearestPrevious=(p)=>{
                const px=Number(p?.x)||0,py=Number(p?.y)||0;let best=null,bestD=Infinity;
                for(const q of previous){const dx=px-(Number(q?.x)||0),dy=py-(Number(q?.y)||0),d=dx*dx+dy*dy;if(d<bestD){bestD=d;best=q;}}
                return best;
            };
            const makeNewStable=(p,entering=true,targetPhaseHint=0,fromPhaseHint=targetPhaseHint)=>{
                const stableIndex=rt.nextStable++;
                return {
                    id:`blue:${layerKey}:${stableIndex}`,
                    seed:Number.isFinite(Number(p?.lampSeed)) ? (Number(p.lampSeed)>>>0) : lampHash32(`${layerKey}:blue:${stableIndex}`),
                    index:stableIndex,
                    fromX:Number(p?.x)||0,
                    fromY:Number(p?.y)||0,
                    handoffAt:now,
                    entering,
                    fromColorPhase:wrapLampColorPhase(fromPhaseHint),
                    colorPhase:wrapLampColorPhase(targetPhaseHint),
                    fromBrightnessUnit:lampSeedUnit(Number.isFinite(Number(p?.lampSeed))?Number(p.lampSeed):lampHash32(`${layerKey}:blue:${stableIndex}`),4),
                    targetBrightnessUnit:lampSeedUnit(Number.isFinite(Number(p?.lampSeed))?Number(p.lampSeed):lampHash32(`${layerKey}:blue:${stableIndex}`),4)
                };
            };

            // Only at a cycle boundary do indices become semantically unsafe. Remap once
            // by nearest actual lamp position. Colour has its own source/target phase so
            // topology growth cannot instantly recolour the surviving lamps.
            if(rt.serial!==serial){
                const used=new Set();
                const nextAssignments=new Map();
                for(let i=0;i<points.length;i++){
                    const p=points[i];
                    const px=Number(p?.x)||0, py=Number(p?.y)||0;
                    let best=-1,bestD=Infinity;
                    for(let j=0;j<previous.length;j++){
                        if(used.has(j))continue;const q=previous[j];
                        const dx=px-(Number(q?.x)||0),dy=py-(Number(q?.y)||0),d=dx*dx+dy*dy;
                        if(d<bestD){bestD=d;best=j;}
                    }
                    const nearest=nearestPrevious(p);
                    const fallbackFrom=Number.isFinite(Number(nearest?.colorPhase))?Number(nearest.colorPhase):(Number.isFinite(sourcePhase[i])?sourcePhase[i]:(Number.isFinite(targetPhase[i])?targetPhase[i]:0));
                    const desiredTarget=Number.isFinite(targetPhase[i])?targetPhase[i]:fallbackFrom;
                    let stable;
                    if(best>=0){
                        used.add(best);const q=previous[best]||{};const fallbackIndex=rt.nextStable++;
                        const previousPhase=Number.isFinite(Number(q.colorPhase))?Number(q.colorPhase):fallbackFrom;
                        stable={
                            id:String(q.stableId || q.lampId || `blue:${layerKey}:${fallbackIndex}`),
                            seed:Number.isFinite(Number(q.lampSeed)) ? (Number(q.lampSeed)>>>0) : lampHash32(`${layerKey}:blue:${fallbackIndex}`),
                            index:Number.isFinite(Number(q.stableIndex)) ? Number(q.stableIndex) : fallbackIndex,
                            fromX:Number(q.x)||0,fromY:Number(q.y)||0,handoffAt:now,entering:false,
                            fromColorPhase:wrapLampColorPhase(previousPhase),colorPhase:wrapLampColorPhase(desiredTarget),
                            fromBrightnessUnit:Number.isFinite(Number(q.brightnessUnit))?Number(q.brightnessUnit):lampSeedUnit(Number(q.lampSeed)||0,4),
                            targetBrightnessUnit:lampSeedUnit(Number(p?.lampSeed)||0,4)
                        };
                    }else {
                        stable=makeNewStable(p,true,desiredTarget,fallbackFrom);
                        if(nearest){
                            stable.fromBrightnessUnit=Number.isFinite(Number(nearest.brightnessUnit))?Number(nearest.brightnessUnit):lampSeedUnit(Number(nearest.lampSeed)||0,4);
                            stable.targetBrightnessUnit=lampSeedUnit(Number(p?.lampSeed)||0,4);
                        }
                    }
                    nextAssignments.set(rawKey(p,i),stable);
                }
                rt.assignments=nextAssignments;rt.serial=serial;
            }

            const globalColorT=lampLinearMorphProgress(0);
            const out=new Array(points.length);
            for(let i=0;i<points.length;i++){
                const p=points[i],key=rawKey(p,i);let stable=rt.assignments.get(key);
                if(!stable){
                    const near=nearestPrevious(p);
                    const from=Number.isFinite(Number(near?.colorPhase))?Number(near.colorPhase):(Number.isFinite(sourcePhase[i])?sourcePhase[i]:0);
                    const to=Number.isFinite(targetPhase[i])?targetPhase[i]:from;
                    stable=makeNewStable(p,true,to,from);
                    if(near){
                        stable.fromBrightnessUnit=Number.isFinite(Number(near.brightnessUnit))?Number(near.brightnessUnit):lampSeedUnit(Number(near.lampSeed)||0,4);
                        stable.targetBrightnessUnit=lampSeedUnit(Number(p?.lampSeed)||0,4);
                    }
                    rt.assignments.set(key,stable);
                }
                const age=Math.max(0,now-(Number(stable.handoffAt)||0));
                const u=linearMode?1:(stable.handoffAt?Math.max(0,Math.min(1,age/HANDOFF_MS)):1);
                const ease=u*u*(3-2*u);
                const targetX=Number(p?.x)||0,targetY=Number(p?.y)||0,sx=Number(stable.fromX)||0,sy=Number(stable.fromY)||0;
                const x=u<1?sx+(targetX-sx)*ease:targetX,y=u<1?sy+(targetY-sy)*ease:targetY;
                const baseLevel=p?.lampLevel===undefined?1:Math.max(0,Math.min(1,Number(p.lampLevel)||0));
                const lampLevel=(!linearMode&&stable.entering&&u<1)?baseLevel*ease:baseLevel;
                const travelT=linearMode&&Number.isFinite(Number(p?.lampTravelProgress))
                    ? Math.max(0,Math.min(1,Number(p.lampTravelProgress))) : globalColorT;
                const lampColorPhase=lerpLampColorPhase(stable.fromColorPhase,stable.colorPhase,travelT);
                const fromBrightnessUnit=Number.isFinite(Number(stable.fromBrightnessUnit))?Number(stable.fromBrightnessUnit):lampSeedUnit(stable.seed,4);
                const targetBrightnessUnit=Number.isFinite(Number(stable.targetBrightnessUnit))?Number(stable.targetBrightnessUnit):fromBrightnessUnit;
                const lampBrightnessUnit=fromBrightnessUnit+(targetBrightnessUnit-fromBrightnessUnit)*travelT;
                out[i]={...p,x,y,lampLevel,lampId:stable.id,lampSeed:stable.seed,lampStableIndex:stable.index,lampColorPhase,lampBrightnessUnit};
                if(u>=1){stable.handoffAt=0;stable.entering=false;stable.fromX=x;stable.fromY=y;}
            }
            rt.last=out.map(p=>({
                x:Number(p.x)||0,y:Number(p.y)||0,lampLevel:p?.lampLevel===undefined?1:Number(p.lampLevel)||0,
                lampPresence:p?.lampPresence===undefined?1:Math.max(0,Math.min(1,Number(p.lampPresence)||0)),
                lampId:p.lampId,stableId:p.lampId,lampSeed:p.lampSeed,stableIndex:p.lampStableIndex,colorPhase:wrapLampColorPhase(p.lampColorPhase),
                brightnessUnit:Number.isFinite(Number(p.lampBrightnessUnit))?Number(p.lampBrightnessUnit):lampSeedUnit(Number(p.lampSeed)||0,4)
            }));
            return out;
        }
        function lampPathTable(path) {
            return buildPathLengthTable([{points:path?.points||[],closed:Boolean(path?.closed)}]);
        }
        function lampPointAtFraction(path, fraction) {
            const table=lampPathTable(path); if(table.total<=1e-8)return null;
            let f=Number(fraction)||0;
            if(path?.closed){f=((f%1)+1)%1;} else f=Math.max(0,Math.min(1,f));
            return pointAtPathDistance(table,Math.min(table.total-1e-9,Math.max(0,f*table.total)));
        }
        function nearestLampFractionOnPath(anchor,path) {
            const pts=path?.points||[]; if(pts.length<2)return {fraction:0,point:{x:Number(anchor?.x)||0,y:Number(anchor?.y)||0}};
            const table=lampPathTable(path); if(table.total<=1e-8)return {fraction:0,point:{x:pts[0].x,y:pts[0].y}};
            let bestD=Infinity,bestDistance=0,bestPoint={x:pts[0].x,y:pts[0].y};
            for(const seg of table.segs){
                const a=seg.a,b=seg.b,vx=b.x-a.x,vy=b.y-a.y,den=vx*vx+vy*vy;
                const u=den>1e-12?Math.max(0,Math.min(1,(((Number(anchor?.x)||0)-a.x)*vx+((Number(anchor?.y)||0)-a.y)*vy)/den)):0;
                const x=a.x+vx*u,y=a.y+vy*u,dx=x-(Number(anchor?.x)||0),dy=y-(Number(anchor?.y)||0),d=dx*dx+dy*dy;
                if(d<bestD){bestD=d;bestDistance=seg.start+seg.len*u;bestPoint={x,y};}
            }
            return {fraction:Math.max(0,Math.min(1,bestDistance/table.total)),point:bestPoint};
        }

        // v259 — stable local segment coordinates for true Linear Topology/Calm lamps.
        // Arc-length fractions are not topological coordinates: as neighbouring pieces
        // stretch, the same fraction moves relative to a key.  Capture the exact sampled
        // render-rail segment and the barycentric coordinate inside it at BOTH endpoints.
        // During the phase we morph those two tiny segments directly.  There is no
        // per-frame nearest search, no chase and therefore no branch-switch teleport.
        function nearestLampSegmentRefOnPath(anchor,path) {
            const pts=path?.points||[];
            if(pts.length<2)return null;
            const closed=Boolean(path?.closed),count=closed?pts.length:pts.length-1;
            const ax=Number(anchor?.x)||0,ay=Number(anchor?.y)||0;
            let best=null,bestD2=Infinity;
            for(let i=0;i<count;i++){
                const a=pts[i],b=pts[(i+1)%pts.length];
                const x0=Number(a?.x)||0,y0=Number(a?.y)||0,x1=Number(b?.x)||0,y1=Number(b?.y)||0;
                const vx=x1-x0,vy=y1-y0,den=vx*vx+vy*vy;
                const q=den>1e-12?Math.max(0,Math.min(1,((ax-x0)*vx+(ay-y0)*vy)/den)):0;
                const x=x0+vx*q,y=y0+vy*q,dx=x-ax,dy=y-ay,d2=dx*dx+dy*dy;
                if(d2<bestD2){
                    bestD2=d2;
                    best={segmentIndex:i,u:q,a:{x:x0,y:y0},b:{x:x1,y:y1},point:{x,y}};
                }
            }
            return best;
        }
        // v260/v261 — stable parameter on the sampled *rendered* rail. Unlike arc
        // length this coordinate identifies a concrete sampled render segment, so it
        // cannot drift when neighbouring pieces stretch. Unlike nearest projection it
        // cannot jump to another branch.
        function lampRenderSegmentParam(path,ref) {
            const pts=path?.points||[];
            if(!ref||pts.length<2)return NaN;
            const count=path?.closed?pts.length:pts.length-1;
            if(count<=0)return NaN;
            const i=Math.max(0,Math.min(count-1,Math.round(Number(ref.segmentIndex)||0)));
            const u=Math.max(0,Math.min(1,Number(ref.u)||0));
            let q=(i+u)/count;
            if(path?.closed)q=((q%1)+1)%1; else q=Math.max(0,Math.min(1,q));
            return q;
        }
        function lampPointAtRenderSegmentParam(path,param) {
            const pts=path?.points||[];
            if(pts.length<2||!Number.isFinite(Number(param)))return null;
            const closed=Boolean(path?.closed),count=closed?pts.length:pts.length-1;
            if(count<=0)return null;
            let q=Number(param)||0;
            q=closed?((q%1)+1)%1:Math.max(0,Math.min(1,q));
            // Open q=1 belongs to the final endpoint, not a wrapped segment.
            if(!closed&&q>=1-1e-12){const p=pts[pts.length-1];return{x:Number(p?.x)||0,y:Number(p?.y)||0};}
            const z=q*count,idx=Math.max(0,Math.min(count-1,Math.floor(z)));
            const u=Math.max(0,Math.min(1,z-idx));
            const a=pts[idx],b=pts[(idx+1)%pts.length];
            return{x:(Number(a?.x)||0)+((Number(b?.x)||0)-(Number(a?.x)||0))*u,
                   y:(Number(a?.y)||0)+((Number(b?.y)||0)-(Number(a?.y)||0))*u};
        }
        function interpolateLampRenderSegmentParam(sourceParam,targetParam,t,closed) {
            const u=Math.max(0,Math.min(1,Number(t)||0));
            let a=Number(sourceParam),b=Number(targetParam);
            if(!Number.isFinite(a)&&!Number.isFinite(b))return NaN;
            if(!Number.isFinite(a))a=b;if(!Number.isFinite(b))b=a;
            if(closed){
                a=((a%1)+1)%1;b=((b%1)+1)%1;
                let d=b-a;d=((d+.5)%1+1)%1-.5;
                return ((a+d*u)%1+1)%1;
            }
            return Math.max(0,Math.min(1,a+(b-a)*u));
        }

        function interpolateLampSegmentRefs(sourceRef,targetRef,t,fallbackSource=null,fallbackTarget=null) {
            const u=Math.max(0,Math.min(1,Number(t)||0));
            if(!sourceRef&&!targetRef){
                if(!fallbackSource&&!fallbackTarget)return null;
                const a=fallbackSource||fallbackTarget,b=fallbackTarget||fallbackSource;
                return {x:(Number(a?.x)||0)+((Number(b?.x)||0)-(Number(a?.x)||0))*u,y:(Number(a?.y)||0)+((Number(b?.y)||0)-(Number(a?.y)||0))*u};
            }
            if(!sourceRef)sourceRef=targetRef;
            if(!targetRef)targetRef=sourceRef;
            const sa=sourceRef.a||sourceRef.point,sb=sourceRef.b||sourceRef.point;
            let ta=targetRef.a||targetRef.point,tb=targetRef.b||targetRef.point;
            let tu=Math.max(0,Math.min(1,Number(targetRef.u)||0));
            const su=Math.max(0,Math.min(1,Number(sourceRef.u)||0));
            // Pair segment ends by the smaller total displacement. This removes the
            // orientation ambiguity of a sampled closed rail without ever re-selecting
            // another segment during the phase.
            const d2=(p,q)=>{const dx=(Number(p?.x)||0)-(Number(q?.x)||0),dy=(Number(p?.y)||0)-(Number(q?.y)||0);return dx*dx+dy*dy;};
            if(d2(sa,tb)+d2(sb,ta) < d2(sa,ta)+d2(sb,tb)){
                const tmp=ta;ta=tb;tb=tmp;tu=1-tu;
            }
            const ax=(Number(sa?.x)||0)+((Number(ta?.x)||0)-(Number(sa?.x)||0))*u;
            const ay=(Number(sa?.y)||0)+((Number(ta?.y)||0)-(Number(sa?.y)||0))*u;
            const bx=(Number(sb?.x)||0)+((Number(tb?.x)||0)-(Number(sb?.x)||0))*u;
            const by=(Number(sb?.y)||0)+((Number(tb?.y)||0)-(Number(sb?.y)||0))*u;
            const q=su+(tu-su)*u;
            return {x:ax+(bx-ax)*q,y:ay+(by-ay)*q};
        }
        // v233: nearest projection with arc-continuity bias. On loops/self-crossing
        // splines several contour branches may be almost equally close in Cartesian space.
        // Pure nearest-point projection can then swap branches from one frame to the next.
        // Penalize a large change of normalized arc position, while still allowing a real
        // reassignment when the geometric improvement is sufficiently large.
        function nearestLampFractionOnPathStable(anchor,path,referenceFraction) {
            const pts=path?.points||[];
            if(pts.length<2 || !Number.isFinite(Number(referenceFraction))) return nearestLampFractionOnPath(anchor,path);
            const table=lampPathTable(path);
            if(table.total<=1e-8) return nearestLampFractionOnPath(anchor,path);
            const ax=Number(anchor?.x)||0, ay=Number(anchor?.y)||0;
            let ref=Number(referenceFraction)||0;
            ref=path?.closed?((ref%1)+1)%1:Math.max(0,Math.min(1,ref));
            let bestScore=Infinity,bestDistance=0,bestPoint={x:pts[0].x,y:pts[0].y};
            // About 18% of contour length as a one-turn continuity scale. This is strong
            // enough to keep the same branch at an intersection, but weak enough to let a
            // genuinely moving topology pull the lamp to a different arc region gradually.
            const continuityScale=Math.max(8,table.total*.18);
            for(const seg of table.segs){
                const a=seg.a,b=seg.b,vx=b.x-a.x,vy=b.y-a.y,den=vx*vx+vy*vy;
                const u=den>1e-12?Math.max(0,Math.min(1,((ax-a.x)*vx+(ay-a.y)*vy)/den)):0;
                const x=a.x+vx*u,y=a.y+vy*u,dx=x-ax,dy=y-ay;
                const distance=seg.start+seg.len*u;
                const f=Math.max(0,Math.min(1,distance/table.total));
                let arcDelta=Math.abs(f-ref);
                if(path?.closed)arcDelta=Math.min(arcDelta,1-arcDelta);
                const arcPenalty=arcDelta*continuityScale;
                const score=dx*dx+dy*dy+arcPenalty*arcPenalty;
                if(score<bestScore){bestScore=score;bestDistance=distance;bestPoint={x,y};}
            }
            return {fraction:Math.max(0,Math.min(1,bestDistance/table.total)),point:bestPoint};
        }

        // v258 — branch/segment-bound projection for true Linear Topology/Calm lamps.
        // A global arc-length fraction is not a topological coordinate while the contour
        // deforms: neighbouring segments stretch by different amounts. Keep each lamp in
        // a frozen local arc neighbourhood and choose the point nearest to its CURRENT
        // construction key only inside that neighbourhood.
        function nearestLampFractionOnPathSegmentBound(anchor,path,referenceFraction,windowFraction=.1) {
            const pts=path?.points||[];
            if(pts.length<2 || !Number.isFinite(Number(referenceFraction))) return nearestLampFractionOnPath(anchor,path);
            const table=lampPathTable(path);
            if(table.total<=1e-8) return nearestLampFractionOnPath(anchor,path);
            const ax=Number(anchor?.x)||0, ay=Number(anchor?.y)||0;
            let ref=Number(referenceFraction)||0;
            ref=path?.closed?((ref%1)+1)%1:Math.max(0,Math.min(1,ref));
            const win=Math.max(.012,Math.min(.24,Number(windowFraction)||.1));
            let bestScore=Infinity,bestDistance=NaN,bestPoint=null;
            const continuityScale=Math.max(2,table.total*.025);
            for(const seg of table.segs){
                const a=seg.a,b=seg.b,vx=b.x-a.x,vy=b.y-a.y,den=vx*vx+vy*vy;
                const su=den>1e-12?Math.max(0,Math.min(1,((ax-a.x)*vx+(ay-a.y)*vy)/den)):0;
                const distance=seg.start+seg.len*su;
                const f=Math.max(0,Math.min(1,distance/table.total));
                let arcDelta=Math.abs(f-ref);
                if(path?.closed)arcDelta=Math.min(arcDelta,1-arcDelta);
                const segMargin=Math.min(.025,(seg.len/Math.max(1e-8,table.total))*.75);
                if(arcDelta>win+segMargin)continue;
                const x=a.x+vx*su,y=a.y+vy*su,dx=x-ax,dy=y-ay;
                const arcPenalty=arcDelta*continuityScale;
                const score=dx*dx+dy*dy+arcPenalty*arcPenalty;
                if(score<bestScore){bestScore=score;bestDistance=distance;bestPoint={x,y};}
            }
            if(!bestPoint)return nearestLampFractionOnPathStable(anchor,path,ref);
            return {fraction:Math.max(0,Math.min(1,bestDistance/table.total)),point:bestPoint};
        }

        function advanceLampPathFraction(current,target,closed,dtMs,responseMs=190) {
            let c=Number(current)||0,t=Number(target)||0;
            let delta=t-c;
            if(closed){delta=((delta+.5)%1+1)%1-.5;}
            const k=1-Math.exp(-Math.max(0,dtMs)/Math.max(24,responseMs));
            c+=delta*k;
            return closed?((c%1)+1)%1:Math.max(0,Math.min(1,c));
        }
        // v218 — smooth lamp motion: linear physical speed along the current contour.
        // The legacy mode above is intentionally untouched. This mode has no
        // exponential tail, so the last small remainder is consumed in one normal
        // frame instead of surviving until the morph boundary and then snapping.
        function advanceLampPathFractionLinear(current,target,path,dtMs) {
            let c=Number(current)||0,t=Number(target)||0;
            const closed=Boolean(path?.closed);
            let delta=t-c;
            if(closed)delta=((delta+.5)%1+1)%1-.5;
            const total=Math.max(1,Number(lampPathTable(path).total)||1);
            const cycleMs=Math.max(100,Number(runtimeState.morph?.transitionMs)||Math.max(.5,Number(state.morph?.intervalSec)||5)*1000);
            const cycleSec=Math.max(.1,cycleMs/1000);
            // Physical px/s normalization: large and small contours converge with the
            // same visual character. 2.5 contour-lengths/cycle leaves ample headroom
            // for a nearest-segment reassignment while retaining linear travel.
            const speedPxPerSec=Math.max(120,total/cycleSec*2.5);
            const step=(speedPxPerSec*Math.max(0,dtMs)/1000)/total;
            if(Math.abs(delta)<=step+1e-9)c=t;
            else c+=Math.sign(delta)*step;
            return closed?((c%1)+1)%1:Math.max(0,Math.min(1,c));
        }
        function lampDynamicResponseMs(cfg=getLampEvaluationConfig()) {
            const inertia=Math.max(0,Math.min(100,Number(cfg?.morphInertia??50)))/100;
            // 50% closely matches the former dynamic response; the quadratic tail
            // gives useful high-inertia travel without making low values sluggish.
            return 24 + inertia*inertia*664;
        }
        function advanceLampAttachmentFraction(current,target,path,dtMs,responseMs=190) {
            // v233: Linear light morph must never mean an instantaneous contour snap.
            // The light/presence curve remains linear, but the physical lamp travels at
            // bounded linear arc speed. A nearest-branch reassignment therefore cannot
            // teleport the lamp to another part of a spline in one frame.
            if(runtimeState.morph?.active && ['linear','ghost'].includes(getLampEvaluationConfig()?.morphMotionMode))
                return advanceLampPathFractionLinear(current,target,path,dtMs);
            if(runtimeState.morph?.active && getLampEvaluationConfig()?.morphMotionMode==='smooth')
                return advanceLampPathFractionLinear(current,target,path,dtMs);
            const dynamicMs=runtimeState.morph?.active && getLampEvaluationConfig()?.morphMotionMode==='dynamic'
                ? lampDynamicResponseMs(getLampEvaluationConfig()) : responseMs;
            return advanceLampPathFraction(current,target,Boolean(path?.closed),dtMs,dynamicMs);
        }
        function lampCornerCycleSec(cfg=getLampEvaluationConfig()){
            const fallback=Math.max(.05,Number(state.morph?.intervalSec)||5);
            try{return Math.max(.05,Number(getTapMorphIntervalSec(fallback,'full'))||fallback);}catch(_){return fallback;}
        }
        function lampCornerInertiaMs(cfg=getLampEvaluationConfig()){
            if(cfg?.cornerInertiaLinked!==false){
                const pct=Math.max(0,Math.min(100,Number(cfg?.cornerInertiaPercent??10)));
                return lampCornerCycleSec(cfg)*1000*(pct/100);
            }
            return Math.max(0,Math.min(15,Number(cfg?.cornerInertiaSec??0.5)))*1000;
        }
        function moveLampLevel(current,target,dtMs,durationMs=330) {
            const c=Math.max(0,Math.min(1,Number(current)||0));
            const t=Math.max(0,Math.min(1,Number(target)||0));
            const duration=Math.max(0,Number(durationMs)||0);
            if(duration<=.001)return t;
            const step=Math.max(0,dtMs)/duration;
            return t>c?Math.min(t,c+step):Math.max(t,c-step);
        }
        function cleanupLampRuntime(now=lampVisualNow()) {
            if(now-lampMotionRuntime.lastCleanup<1200)return;
            lampMotionRuntime.lastCleanup=now;
            for(const map of [lampMotionRuntime.snap,lampMotionRuntime.calm,lampMotionRuntime.corners]){
                for(const [key,v] of map){if(now-(v.lastSeen||now)>2200 && (v.level===undefined||v.level<.005))map.delete(key);}
            }
        }
        function collectSmoothCornerLampPoints(layerIndex, paths, maxPoints=260, animate=true) {
            const layer=state.layers[layerIndex]; if(!layer||!paths?.length)return[];
            const now=lampVisualNow(); cleanupLampRuntime(now);
            const layerKey=String(layer.id||layerIndex);
            const targets=[];
            for(let pi=0;pi<paths.length;pi++){
                const path=paths[pi],pts=path?.points||[],flags=path?.cornerFlags||[]; if(pts.length<2)continue;
                const spiralFractions=isSpiralLayer(layer)&&typeof lampVertexArcFractions==='function'?lampVertexArcFractions(path):null;
                for(let i=0;i<pts.length;i++){
                    if(!path.closed && (i===0||i===pts.length-1))continue;
                    const prev=pts[(i-1+pts.length)%pts.length],cur=pts[i],next=pts[(i+1)%pts.length];
                    const ax=cur.x-prev.x,ay=cur.y-prev.y,bx=next.x-cur.x,by=next.y-cur.y;
                    const al=Math.hypot(ax,ay),bl=Math.hypot(bx,by); if(al<1e-6||bl<1e-6)continue;
                    const dot=Math.max(-1,Math.min(1,(ax*bx+ay*by)/(al*bl)));
                    const turn=Math.acos(dot)*180/Math.PI;
                    // Static and morphing corner modes use the same real bend test.
                    // cornerFlags are hints, not the sole source of truth; otherwise
                    // valid polygon bends disappear when morphing is stopped.
                    if(!flags[i] && turn<9)continue;
                    // A nearly straight flagged point is already disappearing.  Its
                    // target intensity falls continuously with the actual bend angle,
                    // so an unfinished lamp reverses its attack without ever flashing.
                    const x=Math.max(0,Math.min(1,(turn-2)/16));
                    const strength=x*x*(3-2*x);
                    if(strength<=.002)continue;
                    const fraction=spiralFractions?Math.max(0,Math.min(1,Number(spiralFractions[i])||0)):nearestLampFractionOnPath(cur,path).fraction;
                    targets.push({pathIndex:pi,pointIndex:i,fraction,strength});
                    if(targets.length>=maxPoints)break;
                }
                if(targets.length>=maxPoints)break;
            }
            const prefix=`${layerKey}:corner:`;
            const calm=getLampEvaluationConfig()?.calmMode===true && !runtimeState.morph?.active;
            if(calm && !animate){
                const out=[];
                const seen=new Set();
                for(const target of targets){
                    const path=paths[target.pathIndex]; if(!path)continue;
                    const key=`${prefix}calm:${target.pathIndex}:${target.pointIndex}`;
                    seen.add(key);
                    // Follow the same indexed bend directly.  Geometry may move, but
                    // identity is never reassigned to a neighbouring corner.
                    const p=lampPointAtFraction(path,target.fraction);
                    if(p)out.push({...p,pathIndex:target.pathIndex,vertexIndex:target.pointIndex,lampContourFraction:target.fraction,lampLevel:animate?Math.max(.05,target.strength):1,lampId:key,lampSeed:lampHash32(key)});
                }
                return capLampPointList(out,maxPoints);
            }
            const existing=[];
            for(const [key,e] of lampMotionRuntime.corners){if(key.startsWith(prefix))existing.push([key,e]);}
            const used=new Set();
            // Match each current corner to the nearest existing lamp on the same path.
            // This preserves lamp identity when corner indices are inserted/removed.
            for(const target of targets){
                let best=null,bestCost=Infinity;
                for(const [key,e] of existing){
                    if(used.has(key)||e.pathIndex!==target.pathIndex)continue;
                    let d=Math.abs((Number(e.targetS??e.s)||0)-target.fraction);
                    if(paths[target.pathIndex]?.closed)d=Math.min(d,1-d);
                    if(d<bestCost){bestCost=d;best=[key,e];}
                }
                let key,e;
                const stableKey=`${prefix}${target.pathIndex}:slot:${target.pointIndex}`;
                const stable=lampMotionRuntime.corners.get(stableKey);
                if(stable&&!used.has(stableKey)){key=stableKey;e=stable;used.add(key);}
                else if(best && bestCost<.34){
                    // One-time handoff from an older/runtime key into the deterministic slot.
                    // After this frame nearest-neighbour matching can no longer swap this lamp
                    // merely because a slow frame changed how far the contour moved.
                    const [oldKey,oldEntry]=best;key=stableKey;e=oldEntry;
                    if(oldKey!==stableKey){lampMotionRuntime.corners.delete(oldKey);lampMotionRuntime.corners.set(stableKey,e);}
                    used.add(key);
                }else{
                    // v525: deterministic corner identity.  The old key contained the current
                    // timestamp, so a missed rematch (often coincident with a slow/FPS-pressure
                    // frame) created a completely new lamp and visibly reset its contour position.
                    key=stableKey;e={pathIndex:target.pathIndex,s:target.fraction,targetS:target.fraction,level:0,last:now,lastSeen:now};
                    lampMotionRuntime.corners.set(key,e);used.add(key);
                }
                e.pathIndex=target.pathIndex;
                e.targetS=target.fraction;
                // On a static figure a detected bend is an immediate lamp: no temporal
                // attack/release. During Morphing the bend strength is kept continuous,
                // because the geometry itself is moving and corners can appear/disappear.
                e.target=animate?Math.max(0,Math.min(1,Number(target.strength)||0)):1;
                e.lastSeen=now;
            }
            // Lamps whose corner vanished disappear immediately on a static figure,
            // but fade from their current level while Morphing.
            for(const [key,e] of existing){if(!used.has(key))e.target=0;}
            const out=[];
            for(const [key,e] of lampMotionRuntime.corners){
                if(!key.startsWith(prefix))continue;
                const path=paths[e.pathIndex]; if(!path){e.target=0;continue;}
                const rawDt=Math.max(0,now-(e.last||now)),dt=rawDt>1250?0:rawDt;e.last=now;
                if(animate){
                    const inertiaMs=lampCornerInertiaMs(getLampEvaluationConfig());
                    const targetLevel=Math.max(0,Math.min(1,Number(e.target)||0));
                    e.level=moveLampLevel(e.level,targetLevel,dt,inertiaMs);
                    e.s=advanceLampAttachmentFraction(e.s,e.targetS,path,dt,210);
                    if(Math.abs(e.level-targetLevel)>.002)lampAdaptiveFrame.needsSettle=true;
                }else{
                    e.level=Math.max(0,Math.min(1,Number(e.target)||0));
                    e.s=Number.isFinite(Number(e.targetS))?Number(e.targetS):e.s;
                }
                const p=lampPointAtFraction(path,e.s); if(p&&e.level>.002)out.push({...p,pathIndex:e.pathIndex,lampContourFraction:e.s,lampLevel:e.level,lampId:key,lampSeed:lampHash32(key)});
            }
            return capLampPointList(out,maxPoints);
        }
        function projectLampPointsToCurrentPolygon(points, paths, layer, pathsPreparedRounded=false, forceNearest=false) {
            if(!points?.length || !paths?.length) return points||[];
            const circumferenceMode=forceNearest || getLampEvaluationConfig()?.positionMode==='circumference';
            const attach=circumferenceMode || isLampContourAttachmentEnabled();
            const calm=getLampEvaluationConfig()?.calmMode===true && !circumferenceMode && !runtimeState.morph?.active;
            if(!attach) return points;
            // `paths` is the already prepared attachment rail. With sticking enabled
            // callers pass the sampled FINAL render path, including spline fillets.
            const attachmentPaths=paths;
            const now=lampVisualNow(); cleanupLampRuntime(now);
            const layerKey=String(layer?.id||'layer');
            return points.map((p,index)=>{
                const pi=Number.isInteger(p?.pathIndex)?p.pathIndex:-1;
                const path=(pi>=0&&attachmentPaths[pi])?attachmentPaths[pi]:null;
                // v260: true Linear Topology/Calm sticking is NOT a nearest projection. The
                // lamp owns a fixed render-segment parameter for this phase; evaluate that
                // parameter directly on the CURRENT final rounded/spline rail. Thus it is
                // physically on the line every frame but can never jump branches.
                if(runtimeState.morph?.active && getLampEvaluationConfig()?.morphMotionMode==='linear' && (state.morph.mode==='topology'||state.morph.mode==='calm') && p?.lampFixedSegmentBound===true && path){
                    const q=lampPointAtRenderSegmentParam(path,Number(p?.lampAttachRenderSegmentParam));
                    if(q)return {...p,...q,pathIndex:pi,vertexIndex:p?.vertexIndex};
                    return {...p,pathIndex:pi,vertexIndex:p?.vertexIndex};
                }
                if(!path){
                    // Calm mode never searches another contour: if the corresponding
                    // path is temporarily absent, keep the key anchor itself.
                    if(calm)return {...p,pathIndex:pi,vertexIndex:p?.vertexIndex,lampLevel:p?.lampLevel};
                    const q=nearestPointOnLampPaths(p,attachmentPaths,0,false);
                    return {...p,...q,pathIndex:pi,vertexIndex:p?.vertexIndex};
                }
                const vi=Number.isInteger(p?.vertexIndex)?p.vertexIndex:index;
                const identity=p?.lampId ? String(p.lampId) : `${pi}:${vi}`;
                // Spiral lamps own an ordered contour coordinate.  Re-evaluate that exact
                // coordinate on the current visual rail instead of doing a nearest search,
                // which can jump to an adjacent turn where spiral branches pass closely.
                if(isSpiralLayer(layer)&&Number.isFinite(Number(p?.lampContourFraction))){
                    const q=lampPointAtFraction(path,Number(p.lampContourFraction));
                    if(q)return {...p,...q,pathIndex:pi,vertexIndex:p?.vertexIndex};
                }
                // v258: the frozen global fraction is now only a branch locator.
                // The actual lamp point is the nearest point to the CURRENT construction
                // key inside a small frozen neighbourhood of that branch. This keeps the
                // lamp on the same segment/lobe while making it converge continuously to
                // the exact target key instead of correcting itself on the last frame.
                if(runtimeState.morph?.active && getLampEvaluationConfig()?.morphMotionMode==='linear' && (state.morph.mode==='topology'||state.morph.mode==='calm') && Number.isFinite(Number(p?.lampAttachFraction))){
                    const phase=Math.max(0,Math.min(1,Number(p?.lampAttachProgress ?? runtimeState.morph?.progress)||0));
                    if(phase<=1e-8 && p?.lampAttachSourcePoint)
                        return {...p,x:Number(p.lampAttachSourcePoint.x)||0,y:Number(p.lampAttachSourcePoint.y)||0,pathIndex:pi,vertexIndex:p?.vertexIndex};
                    const bound=nearestLampFractionOnPathSegmentBound(
                        p,path,Number(p.lampAttachFraction),Number(p?.lampAttachSegmentWindow)||.1
                    );
                    if(bound?.point){
                        if(phase>=1-1e-8 && p?.lampAttachTargetPoint)
                            return {...p,x:Number(p.lampAttachTargetPoint.x)||0,y:Number(p.lampAttachTargetPoint.y)||0,pathIndex:pi,vertexIndex:p?.vertexIndex};
                        return {...p,...bound.point,lampAttachFraction:bound.fraction,pathIndex:pi,vertexIndex:p?.vertexIndex};
                    }
                }
                if(calm){
                    const near=nearestLampFractionOnPath(p,path);
                    const key=`${layerKey}:calm:${identity}`;
                    let rt=lampMotionRuntime.calm.get(key);
                    if(!rt){rt={s:near.fraction,lastSeen:now};lampMotionRuntime.calm.set(key,rt);}
                    rt.lastSeen=now;
                    // No nearest-segment chase in Calm mode. The stored path coordinate
                    // is carried by the changing rounded contour itself.
                    const q=lampPointAtFraction(path,rt.s)||near.point;
                    return {...p,...q,pathIndex:pi,vertexIndex:p?.vertexIndex};
                }
                const key=`${layerKey}:snap:${identity}`;
                let rt=lampMotionRuntime.snap.get(key);
                if(!rt){
                    const initial=nearestLampFractionOnPath(p,path);
                    rt={s:initial.fraction,targetS:initial.fraction,last:now,lastSeen:now};
                    lampMotionRuntime.snap.set(key,rt);
                }
                // Keep the projection on the same arc branch whenever possible. This is
                // especially important for spline loops where two branches can occupy the
                // same screen position for a frame during Morphing.
                const near=nearestLampFractionOnPathStable(p,path,Number.isFinite(Number(rt.targetS))?rt.targetS:rt.s);
                const rawDt=Math.max(0,now-(rt.last||now)),dt=rawDt>1250?0:rawDt;rt.last=now;rt.lastSeen=now;rt.targetS=near.fraction;
                if(runtimeState.morph?.active && ['linear','ghost'].includes(getLampEvaluationConfig()?.morphMotionMode)){
                    // Circle Slide has an unambiguous angular branch, so an immediate
                    // projection is stable. Topological morphs can temporarily overlap or
                    // cross contour branches; snapping to the newly nearest branch each frame
                    // swaps physical lamp identities and produces hard flicker. In true Linear
                    // topology mode carry the SAME lamp along the current rendered rail with a
                    // bounded linear arc speed. The rail itself still deforms every frame, so
                    // this is attachment continuity, not a second independent morph.
                    if(getLampEvaluationConfig()?.morphMotionMode==='linear' && (state.morph.mode==='topology'||state.morph.mode==='calm'))
                        rt.s=advanceLampPathFractionLinear(rt.s,rt.targetS,path,dt);
                    else rt.s=rt.targetS;
                }else{
                    rt.s=advanceLampAttachmentFraction(rt.s,rt.targetS,path,dt,190);
                }
                const q=lampPointAtFraction(path,rt.s)||near.point;
                return {...p,...q,pathIndex:pi,vertexIndex:p?.vertexIndex};
            });
        }
        function pathCentralSegmentPoints(path, fraction) {
            const pts=path?.points||[]; if(pts.length<2)return[];
            const table=buildPathLengthTable([{points:pts,closed:Boolean(path.closed)}]);
            if(table.total<=1e-6)return[];
            const f=Math.max(.05,Math.min(1,Number(fraction)||.3));
            const start=(1-f)*.5*table.total,end=(1+f)*.5*table.total,span=Math.max(1e-6,end-start);
            const samples=Math.max(8,Math.min(240,Math.ceil(span/4)));
            const out=[];for(let i=0;i<=samples;i++)out.push(pointAtPathDistance(table,start+span*(i/samples)));
            return out;
        }
        function drawLightningCentralMorph(ctx, layerIndex, layer, t, alpha) {
            if(alpha<=.001)return;
            let paths=(typeof getCurrentMorphCpuPaths==='function'?getCurrentMorphCpuPaths(layerIndex,t,'lightning-central'):buildCurrentMorphPaths(layerIndex,t));
            if(!paths.length){const dd=getCachedLayerDrawData(layer);paths=dd?.paths||[];}
            const roundingFrac=getRoundingStrength(layer.rounding);
            const fraction=Math.max(.05,Math.min(1,(Number(state.morph.lightningSegmentPercent)||30)/100));
            const glow=Math.max(0,Math.min(80,Number(state.morph.lightningGlow)||0));
            const color=runtimeState.morph.lightningCycleColor||'#ffffff';
            ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=color;ctx.fillStyle='transparent';
            const baseWidth=Math.max(.25,Number(ctx.lineWidth)||1.5);
            for(const path of paths){
                let renderPts=path.points||[];
                if(roundingFrac>.001&&renderPts.length>2) renderPts=smoothMorphPath(renderPts,path.closed,roundingFrac,path.cornerFlags||[]);
                const seg=pathCentralSegmentPoints({points:renderPts,closed:path.closed},fraction); if(seg.length<2)continue;
                ctx.beginPath();ctx.moveTo(seg[0].x,seg[0].y);for(let i=1;i<seg.length;i++)ctx.lineTo(seg[i].x,seg[i].y);
                if(glow>0){
                    ctx.save();ctx.globalAlpha=Math.max(0,Math.min(1,alpha*.74));ctx.shadowColor=color;ctx.shadowBlur=glow;ctx.lineWidth=baseWidth+Math.min(baseWidth*2.5,glow*.12);ctx.stroke();ctx.restore();
                }
                ctx.globalAlpha=Math.max(0,Math.min(1,alpha));ctx.shadowColor=color;ctx.shadowBlur=glow*.22;ctx.lineWidth=baseWidth;ctx.stroke();
            }
            ctx.restore();
        }
        function collectArbitraryMorphLampPoints(layerIndex,t,maxPoints=600,preparedPaths=null) {
            const layer=state.layers[layerIndex];
            const currentPaths=preparedPaths || (typeof getCurrentMorphCpuPaths==='function'
                ? getCurrentMorphCpuPaths(layerIndex,t,'arbitrary-lamps')
                : ((state.morph.mode==='circleSlide'||(typeof spiralMorphUsesCircleRebuild==='function'&&spiralMorphUsesCircleRebuild()))
                    ? (isChaosCircleMorphPair(layerIndex) ? buildCurrentChaosCircleMorphPaths(layerIndex,t) : buildCurrentCircleMorphPaths(layerIndex,t))
                    : buildCurrentMorphPaths(layerIndex,t)));
            // The normal path is deliberately contour-local: each lamp keeps its pathIndex
            // and fixed arc fraction while that rail deforms. It can never cross into a
            // neighbouring contour merely because relative path lengths changed.
            if(currentPaths.length)return collectArbitraryContourLampPoints(layer,currentPaths,maxPoints);

            const src=runtimeState.morph.sourceGeometry?.[layerIndex] || [];
            const dst=runtimeState.morph.targetGeometry?.[layerIndex] || [];
            if(!src.length&&!dst.length)return collectArbitraryStaticLampPoints(layer,null,maxPoints);
            const out=[],pathCount=Math.max(src.length,dst.length),layerKey=String(layer?.id||layerIndex);
            for(let pathIndex=0;pathIndex<pathCount&&out.length<maxPoints;pathIndex++){
                const sp=src[pathIndex]||null,dp=dst[pathIndex]||null,ref=sp||dp;if(!ref?.points?.length)continue;
                const count=Math.min(maxPoints-out.length,stableArbitraryLampCountForPath(layer,ref,pathIndex,maxPoints));if(!count)continue;
                const seedKey=`lamp|${layerKey}|path:${pathIndex}`;
                const fractions=stableContourLampFractions(seedKey,count);
                const st=sp?buildSinglePathLengthTable(sp,false):null,dt=dp?buildSinglePathLengthTable(dp,false):null;
                for(let i=0;i<fractions.length;i++){
                    const f=fractions[i];
                    const p=st?.total>0?pointAtPathDistance(st,f*st.total):null;
                    const q=dt?.total>0?pointAtPathDistance(dt,f*dt.total):null;
                    const a=p||q,b=q||p;if(!a||!b)continue;
                    const u=Math.max(0,Math.min(1,Number(t)||0));
                    const sourcePresent=!!p,targetPresent=!!q;
                    const travel=sourcePresent&&targetPresent?u:(targetPresent?u:1-u);
                    out.push({x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u,pathIndex,lampAttachFraction:f,
                        lampSourcePresent:sourcePresent,lampTargetPresent:targetPresent,
                        lampPresence:lampTopologyPresence(sourcePresent,targetPresent,travel),lampTravelProgress:travel,
                        lampId:`arb:${pathIndex}:${i}`,lampSeed:lampHash32(`${seedKey}:${i}`)});
                }
            }
            return out;
        }
        function capLampPointList(points,maxPoints=260){
            if(!Array.isArray(points)||points.length<=maxPoints)return points||[];
            const out=[],step=points.length/maxPoints;
            for(let i=0;i<maxPoints;i++)out.push(points[Math.floor(i*step)]);
            return out;
        }
        // v506: source/target snapshot layers are immutable for one Morph phase.  Lamp
        // anchor paths therefore belong to the phase, not to the display frame.  Reusing
        // them removes another object graph that topology Morph previously rebuilt at 60 Hz.
        const topologyLampAnchorPathsCache=new WeakMap();
        function buildTopologyLampAnchorPaths(layer){
            if(layer&&typeof layer==='object'){
                const hit=topologyLampAnchorPathsCache.get(layer);if(hit)return hit;
            }
            const paths=(buildCircleAnchors(layer)||[]).map((orbit,pathIndex)=>({
                points:(orbit.points||[]).map((p,vertexIndex)=>({x:p.x,y:p.y,pathIndex,vertexIndex})),
                closed:true
            })).filter(p=>p.points.length>1);
            if(layer&&typeof layer==='object')topologyLampAnchorPathsCache.set(layer,paths);
            return paths;
        }
        // v229 — lamp-only endpoint sampling for topology changes. Geometry may
        // legitimately collapse several construction vertices onto one vertex, but lamp
        // populations must not duplicate that collapse: surplus/new lamps get unique
        // virtual endpoints distributed along the same contour. This changes no line
        // geometry and adds no rendered spline points.
        function sampleLampClosedAnchor(points,fraction){
            const pts=Array.isArray(points)?points:[];const n=pts.length;if(!n)return{x:0,y:0};if(n===1)return{x:Number(pts[0]?.x)||0,y:Number(pts[0]?.y)||0};
            let f=Number(fraction)||0;f=((f%1)+1)%1;const pos=f*n,i0=Math.floor(pos)%n,i1=(i0+1)%n,u=pos-Math.floor(pos),a=pts[i0],b=pts[i1];
            return{x:(Number(a?.x)||0)+((Number(b?.x)||0)-(Number(a?.x)||0))*u,y:(Number(a?.y)||0)+((Number(b?.y)||0)-(Number(a?.y)||0))*u};
        }
        function sampleLampClosedAngle(angles,fraction){
            const src=Array.isArray(angles)?angles:[];const n=src.length;if(!n)return 0;if(n===1)return Number(src[0])||0;
            let f=Number(fraction)||0;f=((f%1)+1)%1;const pos=f*n,i0=Math.floor(pos)%n,i1=(i0+1)%n,u=pos-Math.floor(pos),a=Number(src[i0])||0,b=Number(src[i1])||0;
            return a+signedAngleDelta(a,b)*u;
        }
        function buildNonCollapsingLampAnglePlan(srcAngles,dstAngles){
            const sa=Array.isArray(srcAngles)?srcAngles:[],da=Array.isArray(dstAngles)?dstAngles:[],ns=sa.length,nd=da.length,n=Math.max(ns,nd);const from=new Array(n),to=new Array(n);
            for(let i=0;i<n;i++){
                // Existing endpoint vertices stay exact. Only surplus slots use a virtual
                // point on the opposite contour, so no two lamps need to share one endpoint.
                from[i]=i<ns?(Number(sa[i])||0):sampleLampClosedAngle(sa,nd>0?i/nd:i/n);
                to[i]=i<nd?(Number(da[i])||0):sampleLampClosedAngle(da,ns>0?i/ns:i/n);
            }
            return{from,to};
        }

        // v235: Linear lamp motion is no longer a nearest-vertex/nearest-contour solver.
        // Every key lamp owns a fixed topological phase on the very same intermediate
        // path that is used to build the visible line. Source and target vertex phases
        // are unioned, so topology growth/fade has the correct weighted population while
        // coordinates remain 1:1 with the selected geometry morph logic.
        function sampleLampTopologyPath(path,fraction){
            const pts=path?.points||[];const n=pts.length;if(!n)return null;if(n===1)return{x:Number(pts[0].x)||0,y:Number(pts[0].y)||0};
            let f=Number(fraction)||0;
            if(path?.closed){f=((f%1)+1)%1;const pos=f*n,i0=Math.floor(pos)%n,i1=(i0+1)%n,u=pos-Math.floor(pos),a=pts[i0],b=pts[i1];return{x:(Number(a.x)||0)+((Number(b.x)||0)-(Number(a.x)||0))*u,y:(Number(a.y)||0)+((Number(b.y)||0)-(Number(a.y)||0))*u};}
            f=Math.max(0,Math.min(1,f));const pos=f*(n-1),i0=Math.min(n-2,Math.floor(pos)),i1=i0+1,u=pos-i0,a=pts[i0],b=pts[i1];return{x:(Number(a.x)||0)+((Number(b.x)||0)-(Number(a.x)||0))*u,y:(Number(a.y)||0)+((Number(b.y)||0)-(Number(a.y)||0))*u};
        }
        function buildLampTopologyPhaseSlots(sourceCount,targetCount,closed=true){
            const slots=new Map();
            const add=(count,key)=>{count=Math.max(0,Math.round(Number(count)||0));if(!count)return;for(let i=0;i<count;i++){const f=closed?i/count:(count<=1?0:i/(count-1));const q=Math.round(f*1000000);let rec=slots.get(q);if(!rec){rec={fraction:f,sourcePresent:false,targetPresent:false};slots.set(q,rec);}rec[key]=true;}};
            add(sourceCount,'sourcePresent');add(targetCount,'targetPresent');
            return [...slots.values()].sort((a,b)=>a.fraction-b.fraction);
        }

        // v253 — v250's nearest-key visibility is preserved as the "Ghost" mode.
        // Linear is a continuous split/merge model, not a radius trigger:
        //   entering lamp = max(progress toward ITS OWN target key, progress toward parent-radius boundary)
        //   retiring lamp = the exact spatial reverse of that construction.
        // The radius channel is a genuine 0..1 gradient. A huge parent radius therefore
        // cannot prematurely reveal a child; its own target-key progress simply wins instead.
        // Position remains 1:1 with the selected geometry morph; only light contribution changes.
        function buildLampKeyPointSamples(path,count,layerKey='',pathIndex=0){
            count=Math.max(0,Math.round(Number(count)||0));
            if(!path||!count)return[];
            const closed=Boolean(path.closed),out=[];
            for(let i=0;i<count;i++){
                const f=closed?i/count:(count<=1?0:i/(count-1));
                const p=sampleLampTopologyPath(path,f);
                if(p)out.push({
                    x:Number(p.x)||0,
                    y:Number(p.y)||0,
                    keyIndex:i,
                    lampSeed:lampHash32(`${layerKey||'layer'}:key:${pathIndex}:${i}`)
                });
            }
            return out;
        }
        function nearestLampKeyInfo(point,keyPoints){
            if(!point||!Array.isArray(keyPoints)||!keyPoints.length)return null;
            const x=Number(point.x)||0,y=Number(point.y)||0;let best=null,bestD2=Infinity;
            for(const q of keyPoints){
                const dx=x-(Number(q?.x)||0),dy=y-(Number(q?.y)||0),d2=dx*dx+dy*dy;
                if(d2<bestD2){bestD2=d2;best=q;}
            }
            return best ? {point:best,distance:Math.sqrt(bestD2)} : null;
        }
        function nearestLampKeyDistance(point,keyPoints){
            const hit=nearestLampKeyInfo(point,keyPoints);
            return hit?hit.distance:Infinity;
        }
        function lampNominalKeyRadius(keyPoint,cfg=getLampEvaluationConfig()){
            const radiusMult=Math.max(0,Number(cfg?.radiusMultiplier??1)||0);
            const baseR=Math.max(1,(Number(cfg?.radius)||50)*radiusMult);
            const seed=Number.isFinite(Number(keyPoint?.lampSeed))?(Number(keyPoint.lampSeed)>>>0):0;
            const bokeh=lampEffectiveBokeh(cfg||{});
            const sizeRandom=Math.max(.12,1+(lampSeedUnit(seed,3)*2-1)*Math.max(0,Number(bokeh?.sizeVar)||0)*.78);
            const morphSize=Math.max(0,Math.min(1,(Number(cfg?.morphSize)||0)/100));
            const sizeMorph=Math.max(.12,1+lampMorphWave(seed,5)*morphSize);
            return Math.max(1e-6,baseR*sizeRandom*sizeMorph);
        }
        function lampNearestKeyPresence(sourcePresent,targetPresent,currentPoint,sourcePoint,targetPoint,sourceKeys,targetKeys,fallbackProgress=0){
            if(getLampEvaluationConfig()?.morphMotionMode!=='ghost'||!runtimeState.morph?.active)return 1;
            const u=Math.max(0,Math.min(1,Number(fallbackProgress)||0));
            if(sourcePresent&&targetPresent)return 1;
            if(!sourcePresent&&targetPresent){
                const startDist=nearestLampKeyDistance(sourcePoint||currentPoint,targetKeys);
                const nowDist=nearestLampKeyDistance(currentPoint,targetKeys);
                if(!Number.isFinite(startDist)||!Number.isFinite(nowDist))return u;
                if(startDist<=1e-6)return 1;
                return Math.max(0,Math.min(1,1-nowDist/startDist));
            }
            if(sourcePresent&&!targetPresent){
                const endDist=nearestLampKeyDistance(targetPoint||currentPoint,sourceKeys);
                const nowDist=nearestLampKeyDistance(currentPoint,sourceKeys);
                if(!Number.isFinite(endDist)||!Number.isFinite(nowDist))return 1-u;
                if(endDist<=1e-6)return 1-u;
                return Math.max(0,Math.min(1,1-nowDist/endDist));
            }
            return 0;
        }
        function lampLinearGateStore(layerKey){
            const serial=Math.max(0,Number(runtimeState.morph?.lampCycleSerial)||0);
            const key=String(layerKey||'layer');
            let rt=lampMotionRuntime.linearGates.get(key);
            if(!rt||rt.serial!==serial){
                rt={serial,gates:new Map()};
                lampMotionRuntime.linearGates.set(key,rt);
            }
            return rt.gates;
        }
        function lampLinearSplitMergePresence(sourcePresent,targetPresent,currentPoint,sourcePoint,targetPoint,sourceKeys,targetKeys,travelProgress=0,layerKey='layer',gateKey=''){
            if(getLampEvaluationConfig()?.morphMotionMode!=='linear'||!runtimeState.morph?.active)return 1;
            const fallback=Math.max(0,Math.min(1,Number(travelProgress)||0));
            if(sourcePresent&&targetPresent)return 1;
            const gates=lampLinearGateStore(layerKey);
            const kind=!sourcePresent&&targetPresent?'split':sourcePresent&&!targetPresent?'merge':'none';
            const id=`${kind}:${gateKey}`;
            let gate=gates.get(id);
            const px=Number(currentPoint?.x)||0, py=Number(currentPoint?.y)||0;
            const sx=Number(sourcePoint?.x)||0, sy=Number(sourcePoint?.y)||0;
            const tx=Number(targetPoint?.x)||0, ty=Number(targetPoint?.y)||0;
            const clamp01=v=>Math.max(0,Math.min(1,Number(v)||0));

            // SPLIT ---------------------------------------------------------------
            // A child has exactly one OWN target key (targetPoint) and one stable
            // parent key selected at the start of this morph phase.  Two continuous
            // 0..1 ramps run in parallel:
            //   1) ownTargetProgress: 0 at the child's actual start position and 1
            //      when its centre reaches its own target key;
            //   2) parentRadiusProgress: 0 at birth and 1 exactly when the centre
            //      reaches the parent's lamp-radius boundary.
            // Whichever ramp advances faster determines visibility via max().
            if(kind==='split'){
                if(!gate){
                    const parent=nearestLampKeyInfo(sourcePoint||currentPoint,sourceKeys);
                    const parentX=parent?Number(parent.point?.x)||0:NaN;
                    const parentY=parent?Number(parent.point?.y)||0:NaN;
                    const parentRadius=parent?lampNominalKeyRadius(parent.point,getLampEvaluationConfig()):NaN;
                    const startX=Number.isFinite(Number(sourcePoint?.x))?sx:px;
                    const startY=Number.isFinite(Number(sourcePoint?.y))?sy:py;
                    const startParentDist=Number.isFinite(parentX)?Math.hypot(startX-parentX,startY-parentY):NaN;
                    const ownTargetX=Number.isFinite(Number(targetPoint?.x))?tx:px;
                    const ownTargetY=Number.isFinite(Number(targetPoint?.y))?ty:py;
                    const ownStartDist=Math.hypot(ownTargetX-startX,ownTargetY-startY);
                    gate={
                        parentX,parentY,parentRadius,startParentDist,
                        startX,startY,targetX:ownTargetX,targetY:ownTargetY,ownStartDist
                    };
                    gates.set(id,gate);
                }

                // Progress to THIS lamp's target point, measured spatially so easing or
                // topology timing cannot change the brightness law.  The fallback is
                // used only for degenerate zero-length moves.
                const ownRemaining=(Number.isFinite(gate.targetX)&&Number.isFinite(gate.targetY))
                    ? Math.hypot(px-gate.targetX,py-gate.targetY) : NaN;
                const ownProgress=(Number.isFinite(ownRemaining)&&gate.ownStartDist>1e-6)
                    ? clamp01(1-ownRemaining/gate.ownStartDist)
                    : fallback;

                // Radius progress must also start at zero.  In ideal 1->many topology
                // the child is born exactly at the parent centre (startParentDist=0),
                // reducing this to distance/radius.  If a geometry mapping places the
                // first sample slightly away from the key, subtract that offset instead
                // of making the lamp pop partially bright on its first frame.
                let radiusProgress=0;
                if(Number.isFinite(gate.parentX)&&Number.isFinite(gate.parentY)&&Number.isFinite(gate.parentRadius)){
                    const d=Math.hypot(px-gate.parentX,py-gate.parentY);
                    const d0=Math.max(0,Number(gate.startParentDist)||0);
                    const span=gate.parentRadius-d0;
                    if(span>1e-6) radiusProgress=clamp01((d-d0)/span);
                    // If the sampled starting point is already outside the nominal
                    // parent radius, this channel is intentionally disabled; the own
                    // target ramp remains continuous and avoids a one-frame flash.
                }
                const candidate=Math.max(ownProgress,radiusProgress);
                // v253: a lamp that is being born may only become brighter.  Spatial
                // distance along a curved/projected morph can wobble by a few pixels;
                // never allow that numerical/geometric wobble to dim it again.
                gate.presence=Math.max(Number.isFinite(Number(gate.presence))?Number(gate.presence):0,candidate);
                return clamp01(gate.presence);
            }

            // MERGE ---------------------------------------------------------------
            // Exact spatial reverse.  The retiring lamp owns its source point and a
            // stable receiver key.  Visibility is the larger of the two *remaining*
            // fractions.  Outside the receiver radius the radius channel stays at 1;
            // once the centre enters it, that channel fades linearly to zero at the
            // receiver centre.  A huge receiver radius cannot make the lamp disappear
            // prematurely because the own-route remaining fraction stays at 1 initially.
            if(kind==='merge'){
                if(!gate){
                    const receiver=nearestLampKeyInfo(targetPoint||currentPoint,targetKeys);
                    const receiverX=receiver?Number(receiver.point?.x)||0:tx;
                    const receiverY=receiver?Number(receiver.point?.y)||0:ty;
                    const receiverRadius=receiver?lampNominalKeyRadius(receiver.point,getLampEvaluationConfig()):NaN;
                    const startX=Number.isFinite(Number(sourcePoint?.x))?sx:px;
                    const startY=Number.isFinite(Number(sourcePoint?.y))?sy:py;
                    const ownStartDist=Math.hypot(receiverX-startX,receiverY-startY);
                    gate={receiverX,receiverY,receiverRadius,startX,startY,ownStartDist};
                    gates.set(id,gate);
                }
                const d=(Number.isFinite(gate.receiverX)&&Number.isFinite(gate.receiverY))
                    ? Math.hypot(px-gate.receiverX,py-gate.receiverY) : NaN;
                const ownRemaining=(Number.isFinite(d)&&gate.ownStartDist>1e-6)
                    ? clamp01(d/gate.ownStartDist)
                    : clamp01(1-fallback);
                const radiusRemaining=(Number.isFinite(d)&&Number.isFinite(gate.receiverRadius)&&gate.receiverRadius>1e-6)
                    ? clamp01(d/gate.receiverRadius)
                    : ownRemaining;
                const candidate=Math.max(ownRemaining,radiusRemaining);
                // v253: exact reverse of splitting. A retiring lamp may only get
                // dimmer during one morph phase; it must never flash brighter because
                // a curved path briefly increases its distance from the receiver.
                gate.presence=Math.min(Number.isFinite(Number(gate.presence))?Number(gate.presence):1,candidate);
                return clamp01(gate.presence);
            }
            return 0;
        }

        // v256 — true Linear key-lamp population (stable Circle + Topology lineage).  v252 used the UNION of normalized
        // source and target fractions.  3 -> 5 therefore produced 7 temporary slots,
        // and target-only slots were born halfway along source edges.  The real split /
        // merge model has exactly max(Nsrc,Ndst) physical lamps.  A new lamp is born
        // at one concrete source key; a retiring lamp ends at one concrete target key.
        function lampCircularIndexDistance(a,b,n){
            if(!(n>0))return Infinity;
            let d=Math.abs(a-b)%n;return Math.min(d,n-d);
        }
        function buildStableLampKeyLineage(sourcePoints,targetPoints){
            const src=Array.isArray(sourcePoints)?sourcePoints:[],dst=Array.isArray(targetPoints)?targetPoints:[];
            const ns=src.length,nt=dst.length,out=[];
            if(!ns&&!nt)return out;
            if(!ns){for(let j=0;j<nt;j++)out.push({sourceIndex:-1,targetIndex:j,sourcePresent:false,targetPresent:true});return out;}
            if(!nt){for(let i=0;i<ns;i++)out.push({sourceIndex:i,targetIndex:-1,sourcePresent:true,targetPresent:false});return out;}
            const nearestSourceForTarget=(j)=>{
                const phase=j/nt*ns;let best=0,bestD=Infinity;
                for(let i=0;i<ns;i++){let d=Math.abs(phase-i);d=Math.min(d,Math.abs(phase-(i+ns)),Math.abs(phase-(i-ns)));if(d<bestD-1e-9){bestD=d;best=i;}}
                return best;
            };
            const nearestTargetForSource=(i)=>{
                const phase=i/ns*nt;let best=0,bestD=Infinity;
                for(let j=0;j<nt;j++){let d=Math.abs(phase-j);d=Math.min(d,Math.abs(phase-(j+nt)),Math.abs(phase-(j-nt)));if(d<bestD-1e-9){bestD=d;best=j;}}
                return best;
            };
            if(nt>=ns){
                // One target slot is the continuing identity of each source lamp.
                // Remaining target slots are children and share their parent's exact
                // source coordinate on frame zero.
                const survivorForTarget=new Map(),used=new Set();
                for(let i=0;i<ns;i++){
                    const ideal=i/ns*nt;let best=-1,bestD=Infinity;
                    for(let j=0;j<nt;j++){if(used.has(j))continue;let d=Math.abs(ideal-j);d=Math.min(d,Math.abs(ideal-(j+nt)),Math.abs(ideal-(j-nt)));if(d<bestD-1e-9){bestD=d;best=j;}}
                    if(best<0)best=nearestTargetForSource(i);used.add(best);survivorForTarget.set(best,i);
                }
                for(let j=0;j<nt;j++){
                    const survivor=survivorForTarget.has(j);
                    const si=survivor?survivorForTarget.get(j):nearestSourceForTarget(j);
                    out.push({sourceIndex:si,targetIndex:j,sourcePresent:survivor,targetPresent:true});
                }
            }else{
                // One source slot continues into each target lamp. Extra source lamps
                // retire into a concrete receiver instead of creating virtual mid-edge keys.
                const survivorForSource=new Map(),used=new Set();
                for(let j=0;j<nt;j++){
                    const ideal=j/nt*ns;let best=-1,bestD=Infinity;
                    for(let i=0;i<ns;i++){if(used.has(i))continue;let d=Math.abs(ideal-i);d=Math.min(d,Math.abs(ideal-(i+ns)),Math.abs(ideal-(i-ns)));if(d<bestD-1e-9){bestD=d;best=i;}}
                    if(best<0)best=nearestSourceForTarget(j);used.add(best);survivorForSource.set(best,j);
                }
                for(let i=0;i<ns;i++){
                    const survivor=survivorForSource.has(i);
                    const tj=survivor?survivorForSource.get(i):nearestTargetForSource(i);
                    out.push({sourceIndex:i,targetIndex:tj,sourcePresent:true,targetPresent:survivor});
                }
            }
            return out;
        }
        // v256 — Topological Linear lamps use a frozen split/merge lineage for the
        // whole morph phase, just like Circle Slide.  Re-pairing path populations every
        // display frame is mathematically redundant and can change tie-breaking when two
        // topology paths are temporarily equivalent.  That used to replace a physical
        // lamp's parent/receiver while it was already moving, which showed up as hard
        // brightness flicker.  Cache the complete source -> target key plan by cycle serial.
        function getStableTopologyLinearLampPlan(layerIndex,src,dst,base,layerKey){
            const serial=Math.max(0,Number(runtimeState.morph?.lampCycleSerial)||0);
            const cacheKey=String(layerKey||base?.id||layerIndex);
            let cached=lampMotionRuntime.topologyLinearPlans.get(cacheKey);
            if(cached&&cached.serial===serial)return cached;
            const srcPaths=buildTopologyLampAnchorPaths(src),dstPaths=buildTopologyLampAnchorPaths(dst);
            const pairs=(srcPaths.length&&dstPaths.length)?pairMorphPaths(srcPaths,dstPaths):[];
            // v256: freeze not only key lineage but also the exact rendered rail coordinate
            // of every source/target key.  Topological Linear lamps then own one concrete
            // contour branch for the whole phase; they never have to chase a nearest point.
            let sourceRenderedRails=[],targetRenderedRails=[];
            // v261: two coordinate systems exist at the topology endpoint. Static target
            // rails use the target layer's native point order, while the active morph uses
            // pairMorphPaths + referenceOffset and therefore a pair-local cyclic order.
            // A render-segment parameter captured in the static order is NOT portable to
            // the current morph rail; it can land on another key and then teleport when
            // Morphing stops. Build the actual rendered rails at t=0 and t=1 as well and
            // express lamp segment parameters in that exact pair-local coordinate system.
            let sourceMorphEndpointRails=[],targetMorphEndpointRails=[];
            try {
                sourceRenderedRails=buildLampRenderedAttachmentPaths(buildOrbitPolylines(src),src,null)||[];
                targetRenderedRails=buildLampRenderedAttachmentPaths(buildOrbitPolylines(dst),dst,null)||[];

                const sourceMorphEndpointPaths=buildCurrentMorphPathsForLamps(layerIndex,0);
                sourceMorphEndpointRails=buildLampRenderedAttachmentPaths(
                    sourceMorphEndpointPaths, base, getLampMorphRenderInfo(layerIndex,0,base)
                )||[];
                const targetMorphEndpointPaths=buildCurrentMorphPathsForLamps(layerIndex,1);
                targetMorphEndpointRails=buildLampRenderedAttachmentPaths(
                    targetMorphEndpointPaths, base, getLampMorphRenderInfo(layerIndex,1,base)
                )||[];
            } catch (_) {
                sourceRenderedRails=[]; targetRenderedRails=[];
                sourceMorphEndpointRails=[]; targetMorphEndpointRails=[];
            }
            const paths=[];
            const makeKey=(p,pathIndex,keyIndex,side)=>({
                x:Number(p?.x)||0,y:Number(p?.y)||0,keyIndex,
                lampSeed:lampHash32(`${cacheKey}:${side}:${pathIndex}:${keyIndex}`)
            });
            for(let pathIndex=0;pathIndex<pairs.length;pathIndex++){
                const pair=pairs[pathIndex],sp=pair?.src,dp=pair?.dst;
                if(!sp&&!dp)continue;
                // v257: pair order is the order of the CURRENT morph paths, but it is
                // not necessarily the raw source/target orbit index. Equal-count topology
                // pairs may be re-ordered by angular matching, while split/merge pairs can
                // duplicate one side. Keep the real endpoint path indices explicitly so
                // endpoint attachment is sampled from the correct static contour.
                const sourcePathIndex=Math.max(0,srcPaths.indexOf(sp));
                const targetPathIndex=Math.max(0,dstPaths.indexOf(dp));
                const srcPts=sp?.points||[],dstPts=dp?.points||[];
                if(!srcPts.length||!dstPts.length)continue;
                const closed=Boolean(sp?.closed&&dp?.closed);
                const referenceOffset=getMorphReferenceVertexOffset(pair,dstPts.length,closed,dst?.N||src?.N||base?.N);
                const alignedFinal=new Array(dstPts.length);
                for(let j=0;j<dstPts.length;j++){
                    const di=((j+referenceOffset)%dstPts.length+dstPts.length)%dstPts.length;
                    alignedFinal[j]=dstPts[di];
                }
                const lineage=buildStableLampKeyLineage(srcPts,alignedFinal);
                const sourceKeys=srcPts.map((p,i)=>makeKey(p,pathIndex,i,'src'));
                const targetKeys=alignedFinal.map((p,i)=>makeKey(p,pathIndex,i,'dst'));
                const sourceRail=sourceRenderedRails[sourcePathIndex]||sp;
                const targetRail=targetRenderedRails[targetPathIndex]||dp;
                // These are the same pair-indexed rails that projectLampPointsToCurrentPolygon
                // receives at the exact start/end of this topology phase. Their point order
                // already includes referenceOffset, path pairing and the final spline/rounding.
                const sourcePairRail=sourceMorphEndpointRails[pathIndex]||sourceRail;
                const targetPairRail=targetMorphEndpointRails[pathIndex]||targetRail;
                const sourceAttachPoints=new Array(sourceKeys.length);
                const targetAttachPoints=new Array(targetKeys.length);
                const sourceAttachFractions=sourceKeys.map((p,i)=>{
                    const hit=sourceRail?.points?.length>1?nearestLampFractionOnPath(p,sourceRail):null;
                    if(hit?.point) sourceAttachPoints[i]={x:Number(hit.point.x)||0,y:Number(hit.point.y)||0};
                    else sourceAttachPoints[i]={x:Number(p.x)||0,y:Number(p.y)||0};
                    return Number.isFinite(Number(hit?.fraction))?Number(hit.fraction):(closed?i/Math.max(1,sourceKeys.length):(sourceKeys.length<=1?0:i/(sourceKeys.length-1)));
                });
                const targetAttachFractions=targetKeys.map((p,i)=>{
                    const hit=targetRail?.points?.length>1?nearestLampFractionOnPath(p,targetRail):null;
                    if(hit?.point) targetAttachPoints[i]={x:Number(hit.point.x)||0,y:Number(hit.point.y)||0};
                    else targetAttachPoints[i]={x:Number(p.x)||0,y:Number(p.y)||0};
                    return Number.isFinite(Number(hit?.fraction))?Number(hit.fraction):(closed?i/Math.max(1,targetKeys.length):(targetKeys.length<=1?0:i/(targetKeys.length-1)));
                });
                const sourceAttachSegmentRefs=sourceKeys.map(p=>sourceRail?.points?.length>1?nearestLampSegmentRefOnPath(p,sourceRail):null);
                const targetAttachSegmentRefs=targetKeys.map(p=>targetRail?.points?.length>1?nearestLampSegmentRefOnPath(p,targetRail):null);

                // v261: use the exact static attached lamp point as the geometric target,
                // but encode it in the pair-local morph rail. This keeps the visible static
                // endpoint semantics while making q(t=1) point to the correct segment in
                // the active topology path. There is no per-frame nearest search here: both
                // projections happen once when the phase plan is created.
                const sourcePairSegmentRefs=sourceAttachPoints.map((p,i)=>
                    sourcePairRail?.points?.length>1
                        ? nearestLampSegmentRefOnPath(p,sourcePairRail)
                        : sourceAttachSegmentRefs[i]
                );
                const targetPairSegmentRefs=targetAttachPoints.map((p,i)=>
                    targetPairRail?.points?.length>1
                        ? nearestLampSegmentRefOnPath(p,targetPairRail)
                        : targetAttachSegmentRefs[i]
                );
                const sourceAttachRenderParams=sourcePairSegmentRefs.map(ref=>lampRenderSegmentParam(sourcePairRail,ref));
                const targetAttachRenderParams=targetPairSegmentRefs.map(ref=>lampRenderSegmentParam(targetPairRail,ref));
                paths.push({
                    pathIndex,sourcePathIndex,targetPathIndex,pair,sp,dp,srcPts,finalDstPts:dstPts,alignedFinal,lineage,referenceOffset,closed,
                    sourceKeys,targetKeys,sourceAttachFractions,targetAttachFractions,sourceAttachPoints,targetAttachPoints,sourceAttachSegmentRefs,targetAttachSegmentRefs,sourceAttachRenderParams,targetAttachRenderParams,
                    sourcePathPresent:pair.sourcePathPresent!==false,
                    targetPathPresent:pair.targetPathPresent!==false,
                    radialMerge:pair.radialMerge===true,
                    radialSplit:pair.radialSplit===true,
                    sourceReferenceAngle:pathReferenceAngle(sp),
                    targetReferenceAngle:pathReferenceAngle(dp)
                });
            }
            cached={serial,paths};
            lampMotionRuntime.topologyLinearPlans.set(cacheKey,cached);
            return cached;
        }

        function markMappedAnglePopulation(mappedAngles,originalAngles){
            const mapped=Array.isArray(mappedAngles)?mappedAngles:[],orig=Array.isArray(originalAngles)?originalAngles:[];
            const present=new Array(mapped.length).fill(false),keyIndex=new Array(mapped.length).fill(-1),used=new Set();
            for(let k=0;k<orig.length;k++){
                let best=-1,bestD=Infinity;
                for(let i=0;i<mapped.length;i++){if(used.has(i))continue;const d=angularDistance(mapped[i],orig[k]);if(d<bestD-1e-9){bestD=d;best=i;}}
                if(best>=0){used.add(best);present[best]=true;keyIndex[best]=k;}
            }
            for(let i=0;i<mapped.length;i++)if(keyIndex[i]<0){
                let best=0,bestD=Infinity;for(let k=0;k<orig.length;k++){const d=angularDistance(mapped[i],orig[k]);if(d<bestD-1e-9){bestD=d;best=k;}}keyIndex[i]=orig.length?best:-1;
            }
            return{present,keyIndex};
        }
        function collectTrueLinearKeyLampPoints(layerIndex,t,maxPoints=260){
            const base=state.layers[layerIndex];
            const src=runtimeState.morph.renderSourceLayers?.[layerIndex] || { ...base, ...(runtimeState.morph.sourceVisuals?.[layerIndex]||{}) };
            const dst=runtimeState.morph.renderTargetLayers?.[layerIndex] || { ...base, ...(runtimeState.morph.targetVisuals?.[layerIndex]||{}) };
            if(!base||!src||!dst)return[];
            const u=Math.max(0,Math.min(1,Number(t)||0)),layerKey=String(base?.id||layerIndex),out=[];
            const makeKey=(p,pathIndex,keyIndex,side)=>({x:Number(p?.x)||0,y:Number(p?.y)||0,keyIndex,lampSeed:lampHash32(`${layerKey}:${side}:${pathIndex}:${keyIndex}`)});

            // Circle Slide already contains the exact split/merge lineage in pp.from -> pp.delta.
            // Use it directly. Unlike buildNonCollapsingLampAnglePlan, duplicate source
            // angles are intentional here: they are children born at their parent lamp.
            if((state.morph.mode==='circleSlide'||(typeof spiralMorphUsesCircleRebuild==='function'&&spiralMorphUsesCircleRebuild()))){
                const plan=isChaosCircleMorphPair(layerIndex)?getChaosCircleMorphPlan(src,dst,state.morph.slideType||'sector'):getCircleMorphPlan(src,dst,state.morph.slideType||'sector');
                const rs=getEffectiveLayerRadius(src,220),rd=getEffectiveLayerRadius(dst,rs),R=rs+(rd-rs)*u;
                for(let pathIndex=0;pathIndex<(plan?.pathPlans?.length||0);pathIndex++){
                    const pp=plan.pathPlans[pathIndex],from=pp.from||[],delta=pp.delta||[];if(!from.length)continue;
                    const to=from.map((a,i)=>a+(Number(delta[i])||0));
                    const srcAngles=pp.lampSourceAngles||[],dstAngles=pp.lampTargetAngles||[];
                    const srcMap=markMappedAnglePopulation(from,srcAngles),dstMap=markMappedAnglePopulation(to,dstAngles);
                    const sourceKeys=srcAngles.map((a,i)=>makeKey({x:rs*Math.cos(a),y:rs*Math.sin(a)},pathIndex,i,'src'));
                    const targetKeys=dstAngles.map((a,i)=>makeKey({x:rd*Math.cos(a),y:rd*Math.sin(a)},pathIndex,i,'dst'));
                    for(let i=0;i<from.length;i++){
                        const sa=from[i],ta=to[i],aa=sa+signedAngleDelta(sa,ta)*u;
                        const x=R*Math.cos(aa),y=R*Math.sin(aa);
                        const si=Math.max(0,srcMap.keyIndex[i]||0),ti=Math.max(0,dstMap.keyIndex[i]||0);
                        const sp=sourceKeys[si]||makeKey({x:rs*Math.cos(sa),y:rs*Math.sin(sa)},pathIndex,si,'src');
                        const tp=targetKeys[ti]||makeKey({x:rd*Math.cos(ta),y:rd*Math.sin(ta)},pathIndex,ti,'dst');
                        const sourcePresent=pp.sourcePathPresent!==false&&srcMap.present[i]===true;
                        const targetPresent=pp.targetPathPresent!==false&&dstMap.present[i]===true;
                        const travel=u;
                        const presence=lampLinearSplitMergePresence(sourcePresent,targetPresent,{x,y},sp,tp,sourceKeys,targetKeys,travel,layerKey,`circle:${pathIndex}:${i}`);
                        out.push({x,y,pathIndex,vertexIndex:i,lampPresence:presence,lampTravelProgress:travel,lampSourcePresent:sourcePresent,lampTargetPresent:targetPresent,lampId:`linear:key:${pathIndex}:${i}`,lampSeed:lampHash32(`${layerKey}:linear:key:${pathIndex}:${i}`)});
                    }
                }
                return capLampPointList(out,maxPoints);
            }

            // Topological morphing now mirrors Circle Slide's invariant: build one
            // immutable physical-lamp lineage at phase start, then only evaluate that plan.
            // Parent/receiver/key indices cannot be re-selected on intermediate frames.
            const topologyPlan=getStableTopologyLinearLampPlan(layerIndex,src,dst,base,layerKey);
            if(!topologyPlan.paths.length)return[];
            const radial=Boolean(state.morph.options.byVertices || state.morph.options.bySteps || state.morph.monoOrbitTransforms);
            const chaosCalm=state.morph.mode==='calm' && isChaosCircleMorphPair(layerIndex);
            for(const rec of topologyPlan.paths){
                const {pathIndex,dp,srcPts,finalDstPts,alignedFinal,lineage,referenceOffset,closed,sourceKeys,targetKeys,sourceAttachFractions,targetAttachFractions,sourceAttachPoints,targetAttachPoints,sourceAttachSegmentRefs,targetAttachSegmentRefs,sourceAttachRenderParams,targetAttachRenderParams}=rec;
                let morphDstPts=finalDstPts;
                if(rec.radialMerge||rec.radialSplit){
                    const rotated=rotateMorphPath(dp,signedAngleDelta(rec.targetReferenceAngle,rec.sourceReferenceAngle)*(1-u));
                    morphDstPts=rotated?.points||finalDstPts;
                }
                const alignedMorph=new Array(finalDstPts.length);
                for(let j=0;j<finalDstPts.length;j++){
                    const di=((j+referenceOffset)%finalDstPts.length+finalDstPts.length)%finalDstPts.length;
                    alignedMorph[j]=morphDstPts[di%morphDstPts.length];
                }
                const useRadial=closed&&(chaosCalm || (radial&&(rec.radialMerge||rec.radialSplit)));
                for(let i=0;i<lineage.length;i++){
                    const slot=lineage[i],si=Math.max(0,slot.sourceIndex),ti=Math.max(0,slot.targetIndex);
                    const sourcePoint=sourceKeys[si],targetPoint=targetKeys[ti];
                    if(!sourcePoint||!targetPoint)continue;
                    const mt=alignedMorph[ti]||alignedFinal[ti]||targetPoint;
                    let x,y;
                    const fixedSegmentPoint=isLampContourAttachmentEnabled()
                        ? interpolateLampSegmentRefs(sourceAttachSegmentRefs?.[si],targetAttachSegmentRefs?.[ti],u,sourceAttachPoints?.[si]||sourcePoint,targetAttachPoints?.[ti]||targetPoint)
                        : null;
                    // The actual sticking coordinate is evaluated later on the CURRENT
                    // rendered rail. This param is frozen to the same source/target
                    // render segments for the whole phase.
                    const renderSegmentParam=isLampContourAttachmentEnabled()
                        ? interpolateLampRenderSegmentParam(sourceAttachRenderParams?.[si],targetAttachRenderParams?.[ti],u,closed)
                        : NaN;
                    if(fixedSegmentPoint){
                        x=Number(fixedSegmentPoint.x)||0; y=Number(fixedSegmentPoint.y)||0;
                    }else if(useRadial){
                        const sr=Math.hypot(sourcePoint.x,sourcePoint.y),tr=Math.hypot(mt.x,mt.y);
                        const sa=Math.atan2(sourcePoint.y,sourcePoint.x),ta=Math.atan2(mt.y,mt.x);
                        const rr=sr+(tr-sr)*u,aa=interpolateMorphPolarAngle(sa,ta,u);
                        x=rr*Math.cos(aa);y=rr*Math.sin(aa);
                    }else{
                        x=sourcePoint.x+(mt.x-sourcePoint.x)*u;
                        y=sourcePoint.y+(mt.y-sourcePoint.y)*u;
                    }
                    const sourcePresent=rec.sourcePathPresent&&slot.sourcePresent;
                    const targetPresent=rec.targetPathPresent&&slot.targetPresent;
                    const travel=u;
                    // v256 segment binding: source and target rail positions are frozen
                    // with the lineage. Interpolate the UNWRAPPED contour coordinate,
                    // not a nearest point.  Hence u=0 is exactly the source key rail
                    // position and u=1 is exactly the destination key rail position.
                    let sourceAttach=Number(sourceAttachFractions?.[si]);
                    let targetAttach=Number(targetAttachFractions?.[ti]);
                    if(!Number.isFinite(sourceAttach))sourceAttach=closed?si/Math.max(1,sourceKeys.length):(sourceKeys.length<=1?0:si/(sourceKeys.length-1));
                    if(!Number.isFinite(targetAttach))targetAttach=closed?ti/Math.max(1,targetKeys.length):(targetKeys.length<=1?0:ti/(targetKeys.length-1));
                    let attachDelta=targetAttach-sourceAttach;
                    if(closed)attachDelta=((attachDelta+.5)%1+1)%1-.5;
                    let attachFraction=sourceAttach+attachDelta*u;
                    attachFraction=closed?((attachFraction%1)+1)%1:Math.max(0,Math.min(1,attachFraction));
                    const stableGateKey=`topo:${pathIndex}:${slot.sourceIndex}->${slot.targetIndex}:${i}`;
                    const presence=lampLinearSplitMergePresence(sourcePresent,targetPresent,{x,y},sourcePoint,targetPoint,sourceKeys,targetKeys,travel,layerKey,stableGateKey);
                    const exactSourceAttach=sourceAttachPoints?.[si]||sourcePoint;
                    const exactTargetAttach=targetAttachPoints?.[ti]||targetPoint;
                    out.push({
                        x,y,pathIndex,vertexIndex:i,lampPresence:presence,lampTravelProgress:travel,
                        lampSourcePresent:sourcePresent,lampTargetPresent:targetPresent,
                        lampAttachFraction:attachFraction,lampAttachSourceFraction:sourceAttach,lampAttachTargetFraction:targetAttach,
                        lampAttachProgress:u,lampFixedSegmentBound:Boolean(fixedSegmentPoint),
                        lampAttachRenderSegmentParam:renderSegmentParam,
                        // v258 compatibility metadata is retained for old/fallback paths,
                        // but v259 true Linear Topology/Calm positions are already evaluated
                        // from one fixed source/target render-segment pair above.
                        // v258: one key-cell-sized frozen neighbourhood of this branch.
                        // It is wide enough to pass the local spline join, but too narrow
                        // to jump to another key/lobe at a self-intersection.
                        lampAttachSegmentWindow:Math.max(.025,Math.min(.18,.48/Math.max(3,sourceKeys.length,targetKeys.length))),
                        // Exact static endpoint positions on the rendered source/target
                        // spline. These make the topology phase endpoint identical to the
                        // key lamp position after Morphing stops, even when path pairing has
                        // re-ordered target sub-orbits.
                        lampAttachSourcePoint:{x:Number(exactSourceAttach.x)||0,y:Number(exactSourceAttach.y)||0},
                        lampAttachTargetPoint:{x:Number(exactTargetAttach.x)||0,y:Number(exactTargetAttach.y)||0},
                        lampAttachSegmentKey:`${pathIndex}:${slot.sourceIndex}->${slot.targetIndex}`,
                        lampId:`linear:topo:${pathIndex}:${slot.sourceIndex}->${slot.targetIndex}:${i}`,
                        lampSeed:lampHash32(`${layerKey}:linear:topo:${pathIndex}:${slot.sourceIndex}->${slot.targetIndex}:${i}`)
                    });
                }
            }
            return capLampPointList(out,maxPoints);
        }
        function collectLinearGeometryLampPoints(layerIndex,t,maxPoints=260,currentPaths=null){
            const base=state.layers[layerIndex];
            const src=runtimeState.morph.renderSourceLayers?.[layerIndex] || { ...base, ...(runtimeState.morph.sourceVisuals?.[layerIndex]||{}) };
            const dst=runtimeState.morph.renderTargetLayers?.[layerIndex] || { ...base, ...(runtimeState.morph.targetVisuals?.[layerIndex]||{}) };
            const paths=Array.isArray(currentPaths)?currentPaths:[];if(!base||!src||!dst||!paths.length)return[];
            const anchorPairs=pairMorphPaths(buildTopologyLampAnchorPaths(src),buildTopologyLampAnchorPaths(dst));
            const u=Math.max(0,Math.min(1,Number(t)||0)),out=[];
            // Circle Slide paths do not carry _src/_dst; static source/target paths are
            // only a fallback for travel-distance brightness, never for current position.
            let srcVisible=null,dstVisible=null;
            const perEdgePathLayout=anchorPairs.length!==paths.length;
            for(let pathIndex=0;pathIndex<paths.length;pathIndex++){
                const current=paths[pathIndex];if(!current?.points?.length)continue;
                const pair=anchorPairs[pathIndex]||{};
                let sourcePath=null,targetPath=null;
                if(current._src)sourcePath={points:current._src.rawPoints||current._src.points||[],closed:Boolean(current._src.closed)};
                if(current._dst)targetPath={points:current._dst.rawPoints||current._dst.points||[],closed:Boolean(current._dst.closed)};
                if(!sourcePath||!targetPath){
                    if(!srcVisible)srcVisible=buildOrbitPolylines(src);if(!dstVisible)dstVisible=buildOrbitPolylines(dst);
                    sourcePath=sourcePath||srcVisible[pathIndex]||null;targetPath=targetPath||dstVisible[pathIndex]||null;
                }
                // Broken/open profiles are represented as one visible path per polygon edge,
                // while the anchor plan is one orbit. In that layout the line is literally
                // built from each edge's two endpoints, so use those endpoints 1:1.
                const sourceCount=perEdgePathLayout ? (sourcePath?.points?.length?2:0) : (pair?.src?.points?.length||0);
                const targetCount=perEdgePathLayout ? (targetPath?.points?.length?2:0) : (pair?.dst?.points?.length||0);
                const slots=buildLampTopologyPhaseSlots(sourceCount,targetCount,Boolean(current.closed));
                if(!slots.length)continue;
                const layerKey=String(base?.id||layerIndex);
                const sourceKeys=buildLampKeyPointSamples(sourcePath,sourceCount,layerKey,pathIndex);
                const targetKeys=buildLampKeyPointSamples(targetPath,targetCount,layerKey,pathIndex);
                for(let slotIndex=0;slotIndex<slots.length;slotIndex++){
                    const slot=slots[slotIndex],f=slot.fraction;
                    const p=sampleLampTopologyPath(current,f);if(!p)continue;
                    const a=sourcePath?sampleLampTopologyPath(sourcePath,f):null,b=targetPath?sampleLampTopologyPath(targetPath,f):null;
                    const travel=(a&&b)?lampEndpointTravelProgress(a.x,a.y,p.x,p.y,b.x,b.y,u):u;
                    const ghostPresence=lampNearestKeyPresence(slot.sourcePresent,slot.targetPresent,p,a,b,sourceKeys,targetKeys,travel);
                    const linearPresence=lampLinearSplitMergePresence(slot.sourcePresent,slot.targetPresent,p,a,b,sourceKeys,targetKeys,travel,layerKey,`${pathIndex}:${Math.round(f*1000000)}`);
                    const presence=getLampEvaluationConfig()?.morphMotionMode==='ghost'?ghostPresence:linearPresence;
                    const phaseKey=Math.round(f*1000000);
                    out.push({x:p.x,y:p.y,pathIndex,vertexIndex:slotIndex,lampPresence:presence,lampTravelProgress:travel,lampNearestKeyPresence:ghostPresence,lampLinearSplitMergePresence:linearPresence,lampSourcePresent:slot.sourcePresent,lampTargetPresent:slot.targetPresent,lampId:`geom:${pathIndex}:${phaseKey}`,lampSeed:lampHash32(`${base?.id||layerIndex}:geom:${pathIndex}:${phaseKey}`)});
                }
            }
            return capLampPointList(out,maxPoints);
        }

        function collectTopologyVertexLampPoints(layerIndex,t,maxPoints=260){
            const base=state.layers[layerIndex];
            const src=runtimeState.morph.renderSourceLayers?.[layerIndex] || { ...base, ...(runtimeState.morph.sourceVisuals?.[layerIndex]||{}) };
            const dst=runtimeState.morph.renderTargetLayers?.[layerIndex] || { ...base, ...(runtimeState.morph.targetVisuals?.[layerIndex]||{}) };
            if(!src||!dst)return[];
            const srcPaths=buildTopologyLampAnchorPaths(src), dstPaths=buildTopologyLampAnchorPaths(dst);
            if(!srcPaths.length||!dstPaths.length)return[];
            const pairs=pairMorphPaths(srcPaths,dstPaths);
            const u=Math.max(0,Math.min(1,Number(t)||0));
            const radial=Boolean(state.morph.options.byVertices || state.morph.options.bySteps || state.morph.monoOrbitTransforms);
            const chaosCalm=state.morph.mode==='calm' && isChaosCircleMorphPair(layerIndex);
            const out=[];
            for(let pathIndex=0;pathIndex<pairs.length;pathIndex++){
                const pair=pairs[pathIndex],sp=pair.src,dp=pair.dst;if(!sp&&!dp)continue;
                if(sp&&dp){
                    const srcPts=sp.points||[],dstPts=dp.points||[];if(!srcPts.length||!dstPts.length)continue;
                    let morphDst=dp;
                    if(pair.radialMerge||pair.radialSplit){
                        const sa=pathReferenceAngle(sp),da=pathReferenceAngle(dp);
                        morphDst=rotateMorphPath(dp,signedAngleDelta(da,sa)*(1-u));
                    }
                    const dPts=morphDst.points||[];const n=Math.max(srcPts.length,dPts.length);
                    const useRadial=Boolean(sp.closed&&dp.closed)&&(chaosCalm || (radial&&(pair.radialMerge||pair.radialSplit)));
                    const stableLampCalm=getLampEvaluationConfig()?.calmMode===true && !runtimeState.morph?.active;
                    const referenceOffset=stableLampCalm ? 0 : getMorphReferenceVertexOffset(pair,dPts.length,Boolean(sp.closed&&dp.closed),dst?.N || src?.N || base?.N);
                    for(let i=0;i<n;i++){
                        const sourcePathPresent=pair.sourcePathPresent!==false,targetPathPresent=pair.targetPathPresent!==false;
                        const sourcePresent=sourcePathPresent&&i<srcPts.length,targetPresent=targetPathPresent&&i<dPts.length;
                        const di=dPts.length?((i+referenceOffset)%dPts.length+dPts.length)%dPts.length:0;
                        // Real lamps keep exact real vertices. Entering/retiring surplus
                        // lamps use unique virtual endpoints instead of `%`-duplicating one
                        // physical vertex for several lamps.
                        const sourcePoint=sourcePresent?srcPts[i]:sampleLampClosedAnchor(srcPts,dPts.length?di/dPts.length:i/Math.max(1,n));
                        const morphTargetPoint=targetPresent?dPts[di]:sampleLampClosedAnchor(dPts,srcPts.length?i/srcPts.length:i/Math.max(1,n));
                        const finalDstPts=dp.points||dPts;
                        const targetPoint=targetPresent
                            ? (finalDstPts.length?finalDstPts[di%finalDstPts.length]:morphTargetPoint)
                            : sampleLampClosedAnchor(finalDstPts,srcPts.length?i/srcPts.length:i/Math.max(1,n));
                        let x,y;
                        if(useRadial){
                            const sr=Math.hypot(sourcePoint.x,sourcePoint.y),tr=Math.hypot(morphTargetPoint.x,morphTargetPoint.y);
                            const sa=Math.atan2(sourcePoint.y,sourcePoint.x),ta=Math.atan2(morphTargetPoint.y,morphTargetPoint.x);
                            const rr=sr+(tr-sr)*u,aa=interpolateMorphPolarAngle(sa,ta,u);x=rr*Math.cos(aa);y=rr*Math.sin(aa);
                        }else{x=sourcePoint.x+(morphTargetPoint.x-sourcePoint.x)*u;y=sourcePoint.y+(morphTargetPoint.y-sourcePoint.y)*u;}
                        const lampTravelProgress=lampEndpointTravelProgress(sourcePoint?.x,sourcePoint?.y,x,y,targetPoint?.x,targetPoint?.y,u);
                        const lampPresence=lampTopologyPresence(sourcePresent,targetPresent,lampTravelProgress);
                        out.push({x,y,pathIndex,vertexIndex:i,lampPresence,lampTravelProgress,lampSourcePresent:sourcePresent,lampTargetPresent:targetPresent,lampId:`key:${pathIndex}:${i}`,lampSeed:lampHash32(`${base?.id||layerIndex}:key:${pathIndex}:${i}`)});
                    }
                }else{
                    const pts=(sp||dp)?.points||[];
                    const sourcePathPresent=Boolean(sp)&&pair.sourcePathPresent!==false,targetPathPresent=Boolean(dp)&&pair.targetPathPresent!==false;
                    const lampTravelProgress=u;
                    const lampPresence=lampTopologyPresence(sourcePathPresent,targetPathPresent,lampTravelProgress);
                    for(let i=0;i<pts.length;i++)out.push({x:pts[i].x,y:pts[i].y,pathIndex,vertexIndex:i,lampPresence,lampTravelProgress,lampSourcePresent:sourcePathPresent,lampTargetPresent:targetPathPresent,lampId:`key:${pathIndex}:${i}`,lampSeed:lampHash32(`${base?.id||layerIndex}:key:${pathIndex}:${i}`)});
                }
            }
            return capLampPointList(out,maxPoints);
        }
        // v218 — circumference mode uses a true polar anchor. For ordinary
        // topology morphing the old key mode may interpolate a vertex through the
        // interior chord; this mode interpolates radius + angle instead, keeping the
        // reference point on the base circle before it is projected to the contour.
        function collectCircumferenceMorphLampPoints(layerIndex,t,maxPoints=260){
            const base=state.layers[layerIndex];
            const src=runtimeState.morph.renderSourceLayers?.[layerIndex] || { ...base, ...(runtimeState.morph.sourceVisuals?.[layerIndex]||{}) };
            const dst=runtimeState.morph.renderTargetLayers?.[layerIndex] || { ...base, ...(runtimeState.morph.targetVisuals?.[layerIndex]||{}) };
            if(!src||!dst)return[];
            const srcPaths=buildTopologyLampAnchorPaths(src),dstPaths=buildTopologyLampAnchorPaths(dst);
            if(!srcPaths.length||!dstPaths.length)return[];
            const pairs=pairMorphPaths(srcPaths,dstPaths);
            const u=Math.max(0,Math.min(1,Number(t)||0));
            const out=[];
            for(let pathIndex=0;pathIndex<pairs.length;pathIndex++){
                const pair=pairs[pathIndex],sp=pair.src,dp=pair.dst;if(!sp&&!dp)continue;
                if(sp&&dp){
                    const srcPts=sp.points||[],dstPts=dp.points||[];if(!srcPts.length||!dstPts.length)continue;
                    let morphDst=dp;
                    if(pair.radialMerge||pair.radialSplit){
                        const sa=pathReferenceAngle(sp),da=pathReferenceAngle(dp);
                        morphDst=rotateMorphPath(dp,signedAngleDelta(da,sa)*(1-u));
                    }
                    const dPts=morphDst.points||[];if(!dPts.length)continue;
                    const n=Math.max(srcPts.length,dPts.length);
                    const srcPolar=unwrapPolarPath(srcPts),dstPolar=unwrapPolarPath(dPts);
                    const referenceOffset=getMorphReferenceVertexOffset(pair,dPts.length,Boolean(sp.closed&&dp.closed),dst?.N || src?.N || base?.N);
                    for(let i=0;i<n;i++){
                        const si=i%srcPts.length,di=(i+referenceOffset)%dPts.length;
                        const a=srcPolar[si],b=dstPolar[di];
                        const rr=a.radius+(b.radius-a.radius)*u;
                        const aa=interpolateMorphPolarAngle(a.angle,b.angle,u);
                        const x=rr*Math.cos(aa),y=rr*Math.sin(aa);
                        const sourcePoint=srcPts[si];
                        const finalDstPts=dp.points||dPts;
                        const targetPoint=finalDstPts.length?finalDstPts[di%finalDstPts.length]:dPts[di];
                        const lampTravelProgress=lampEndpointTravelProgress(sourcePoint?.x,sourcePoint?.y,x,y,targetPoint?.x,targetPoint?.y,u);
                        const sourcePresent=i<srcPts.length,targetPresent=i<dPts.length;
                        const lampPresence=lampTopologyPresence(sourcePresent,targetPresent,lampTravelProgress);
                        out.push({x,y,pathIndex,vertexIndex:i,lampPresence,lampTravelProgress,lampSourcePresent:sourcePresent,lampTargetPresent:targetPresent,lampId:`circ:${pathIndex}:${i}`,lampSeed:lampHash32(`${base?.id||layerIndex}:circ:${pathIndex}:${i}`)});
                    }
                }else{
                    const pts=(sp||dp)?.points||[];
                    const lampTravelProgress=u;
                    const lampPresence=lampTopologyPresence(Boolean(sp),Boolean(dp),lampTravelProgress);
                    for(let i=0;i<pts.length;i++){
                        const x=Number(pts[i].x)||0,y=Number(pts[i].y)||0,r=Math.hypot(x,y),a=Math.atan2(y,x);
                        out.push({x:r*Math.cos(a),y:r*Math.sin(a),pathIndex,vertexIndex:i,lampPresence,lampTravelProgress,lampSourcePresent:Boolean(sp),lampTargetPresent:Boolean(dp),lampId:`circ:${pathIndex}:${i}`,lampSeed:lampHash32(`${base?.id||layerIndex}:circ:${pathIndex}:${i}`)});
                    }
                }
            }
            return capLampPointList(out,maxPoints);
        }

        function collectChaosCircleVertexLampPoints(layerIndex,t,maxPoints=260){
            const base=state.layers[layerIndex];
            const src=runtimeState.morph.renderSourceLayers?.[layerIndex] || { ...base, ...(runtimeState.morph.sourceVisuals?.[layerIndex]||{}) };
            const dst=runtimeState.morph.renderTargetLayers?.[layerIndex] || { ...base, ...(runtimeState.morph.targetVisuals?.[layerIndex]||{}) };
            if(!src||!dst)return[];
            const plan=getChaosCircleMorphPlan(src,dst,state.morph.slideType||'sector');
            if(!plan?.pathPlans?.length)return[];
            const u=Math.max(0,Math.min(1,Number(t)||0));
            const rs=getEffectiveLayerRadius(src,220),rd=getEffectiveLayerRadius(dst,rs),R=rs+(rd-rs)*u;
            const out=[];
            for(let pathIndex=0;pathIndex<plan.pathPlans.length;pathIndex++){
                const pp=plan.pathPlans[pathIndex];
                const lampPlan=buildNonCollapsingLampAnglePlan(pp.lampSourceAngles||pp.from,pp.lampTargetAngles||(pp.from||[]).map((a,i)=>a+(pp.delta?.[i]||0)));
                for(let i=0;i<lampPlan.from.length;i++){
                    const sourceAngle=lampPlan.from[i],targetAngle=lampPlan.to[i];
                    const angle=sourceAngle+signedAngleDelta(sourceAngle,targetAngle)*u;
                    const x=R*Math.cos(angle),y=R*Math.sin(angle);
                    const sx=rs*Math.cos(sourceAngle),sy=rs*Math.sin(sourceAngle),tx=rd*Math.cos(targetAngle),ty=rd*Math.sin(targetAngle);
                    const sourcePresent=pp.sourcePathPresent!==false && i<Math.max(0,Number(pp.sourceVertexCount)||0);
                    const targetPresent=pp.targetPathPresent!==false && i<Math.max(0,Number(pp.targetVertexCount)||0);
                    const lampTravelProgress=lampEndpointTravelProgress(sx,sy,x,y,tx,ty,u);
                    const lampPresence=lampTopologyPresence(sourcePresent,targetPresent,lampTravelProgress);
                    out.push({x,y,pathIndex,vertexIndex:i,lampPresence,lampTravelProgress,lampSourcePresent:sourcePresent,lampTargetPresent:targetPresent,lampId:`key:${pathIndex}:${i}`,lampSeed:lampHash32(`${base?.id||layerIndex}:chaos-key:${pathIndex}:${i}`)});
                }
            }
            return capLampPointList(out,maxPoints);
        }
        function collectCircleVertexLampPoints(layerIndex,t,maxPoints=260){
            const base=state.layers[layerIndex];
            const src=runtimeState.morph.renderSourceLayers?.[layerIndex] || { ...base, ...(runtimeState.morph.sourceVisuals?.[layerIndex]||{}) };
            const dst=runtimeState.morph.renderTargetLayers?.[layerIndex] || { ...base, ...(runtimeState.morph.targetVisuals?.[layerIndex]||{}) };
            if(!src||!dst)return[];
            // Use the very same angular plan as drawAngularAnchorMorph.
            const plan=getCircleMorphPlan(src,dst,state.morph.slideType||'sector');
            if(!plan?.pathPlans?.length)return[];
            const u=Math.max(0,Math.min(1,Number(t)||0));
            const rs=getEffectiveLayerRadius(src,220),rd=getEffectiveLayerRadius(dst,rs),R=rs+(rd-rs)*u;
            const out=[];
            for(let pathIndex=0;pathIndex<plan.pathPlans.length;pathIndex++){
                const pp=plan.pathPlans[pathIndex];
                const lampPlan=buildNonCollapsingLampAnglePlan(pp.lampSourceAngles||pp.from,pp.lampTargetAngles||(pp.from||[]).map((a,i)=>a+(pp.delta?.[i]||0)));
                for(let i=0;i<lampPlan.from.length;i++){
                    const sourceAngle=lampPlan.from[i],targetAngle=lampPlan.to[i];
                    const angle=sourceAngle+signedAngleDelta(sourceAngle,targetAngle)*u;
                    const x=R*Math.cos(angle),y=R*Math.sin(angle);
                    const sx=rs*Math.cos(sourceAngle),sy=rs*Math.sin(sourceAngle),tx=rd*Math.cos(targetAngle),ty=rd*Math.sin(targetAngle);
                    const sourcePresent=pp.sourcePathPresent!==false && i<Math.max(0,Number(pp.sourceVertexCount)||0);
                    const targetPresent=pp.targetPathPresent!==false && i<Math.max(0,Number(pp.targetVertexCount)||0);
                    const lampTravelProgress=lampEndpointTravelProgress(sx,sy,x,y,tx,ty,u);
                    const lampPresence=lampTopologyPresence(sourcePresent,targetPresent,lampTravelProgress);
                    out.push({x,y,pathIndex,vertexIndex:i,lampPresence,lampTravelProgress,lampSourcePresent:sourcePresent,lampTargetPresent:targetPresent,lampId:`key:${pathIndex}:${i}`,lampSeed:lampHash32(`${base?.id||layerIndex}:key:${pathIndex}:${i}`)});
                }
            }
            return capLampPointList(out,maxPoints);
        }

        // v233: lamp-only approximation of the exact cubic path used by Morphing.
        // This does NOT add visible spline/morph points; it only builds an internal rail
        // for arc-length attachment so lamps follow the same Bézier the user sees.
        function buildLampSplineAttachmentPaths(paths, splineBlend) {
            const source=Array.isArray(paths)?paths:[];
            const b=Math.max(0,Math.min(1,Number(splineBlend)||0));
            const sampleCubic=(p0,p1,p2,p3,u)=>{
                const v=1-u,v2=v*v,u2=u*u;
                return {x:v2*v*p0.x+3*v2*u*p1.x+3*v*u2*p2.x+u2*u*p3.x,
                        y:v2*v*p0.y+3*v2*u*p1.y+3*v*u2*p2.y+u2*u*p3.y};
            };
            return source.map(path=>{
                const pts=(path?.points||[]).filter(p=>p&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y)));
                if(pts.length<3)return path;
                const closed=Boolean(path.closed),n=pts.length,out=[];
                const segCount=closed?n:n-1;
                const lerp=(a,c)=>a+(c-a)*b;
                const subdivisions=6; // attachment rail only; render geometry is unchanged
                if(!closed)out.push({x:pts[0].x,y:pts[0].y});
                else out.push({x:pts[0].x,y:pts[0].y});
                for(let i=0;i<segCount;i++){
                    const p1=pts[i],p2=pts[(i+1)%n];
                    const p0=closed?pts[(i-1+n)%n]:(i>0?pts[i-1]:{x:2*p1.x-p2.x,y:2*p1.y-p2.y});
                    const p3=closed?pts[(i+2)%n]:(i+2<n?pts[i+2]:{x:2*p2.x-p1.x,y:2*p2.y-p1.y});
                    const sc=centripetalSplineBezierControls(p0,p1,p2,p3,0.5);
                    const l1={x:p1.x+(p2.x-p1.x)/3,y:p1.y+(p2.y-p1.y)/3};
                    const l2={x:p1.x+(p2.x-p1.x)*2/3,y:p1.y+(p2.y-p1.y)*2/3};
                    const c1={x:lerp(l1.x,sc.c1.x),y:lerp(l1.y,sc.c1.y)};
                    const c2={x:lerp(l2.x,sc.c2.x),y:lerp(l2.y,sc.c2.y)};
                    for(let k=1;k<=subdivisions;k++){
                        // For a closed rail, omit the final duplicate of the first point.
                        if(closed && i===segCount-1 && k===subdivisions)continue;
                        out.push(sampleCubic(p1,c1,c2,p2,k/subdivisions));
                    }
                }
                return {...path,points:out,cornerFlags:[]};
            });
        }

        function collectMorphLampPoints(layerIndex, t, maxPoints=260, preparedPaths=null, preparedRoundedPaths=null) {
            let mode=getLampEvaluationConfig()?.positionMode||'key';
            if(mode==='circumference')mode='key'; // legacy project migration
            const base=state.layers[layerIndex];
            const circleMode=(state.morph.mode==='circleSlide'||(typeof spiralMorphUsesCircleRebuild==='function'&&spiralMorphUsesCircleRebuild()));
            const trueLinearTopology = getLampEvaluationConfig()?.morphMotionMode==='linear' && (state.morph.mode==='topology'||state.morph.mode==='calm');
            const rawPaths=preparedPaths || (trueLinearTopology
                ? buildCurrentMorphPathsForLamps(layerIndex,t)
                : (typeof getCurrentMorphCpuPaths==='function'
                    ? getCurrentMorphCpuPaths(layerIndex,t,'lamp-paths')
                    : (circleMode ? (isChaosCircleMorphPair(layerIndex)?buildCurrentChaosCircleMorphPaths(layerIndex,t):buildCurrentCircleMorphPaths(layerIndex,t)) : buildCurrentMorphPaths(layerIndex,t))));
            // preparedPaths can belong to the v275+ atomic visual spline branch.  True
            // Linear topology lamps must never inherit that alternate segment topology;
            // force the canonical v269 path even when a visual prepared path was supplied.
            const lampRawPaths = trueLinearTopology ? buildCurrentMorphPathsForLamps(layerIndex,t) : rawPaths;
            const circumferenceMode=false;
            const attach=isLampContourAttachmentEnabled();
            const morphRenderInfo=getLampMorphRenderInfo(layerIndex,t,base);
            const attachmentPaths=attach ? buildLampRenderedAttachmentPaths(lampRawPaths,base,morphRenderInfo) : lampRawPaths;
            // Linear lamps still originate 1:1 from the morph construction geometry, but
            // sticking projects that exact point onto the SAME final rounded spline used
            // by the line renderer in this frame. There is no independent vertex solver.
            if(getLampEvaluationConfig()?.morphMotionMode==='linear' && mode==='key'){
                let exact=collectTrueLinearKeyLampPoints(layerIndex,t,maxPoints);
                if(exact.length){
                    if(attach) exact=projectLampPointsToCurrentPolygon(exact,attachmentPaths,base,true,circumferenceMode);
                    // v254: NEVER coordinate-dedupe true Linear children. Several real
                    // daughter lamps are supposed to occupy the exact parent centre at
                    // birth. Removing them here made identities disappear for a few
                    // frames and reappear once separated, perceived as ghost lamps and
                    // brightness flicker. IDs, not coordinates, define this population.
                    return preserveBlueMorphLampIdentity(layerIndex,capLampPointList(exact,maxPoints));
                }
            }
            if(getLampEvaluationConfig()?.morphMotionMode==='ghost' && mode==='key' && rawPaths?.length){
                let exact=collectLinearGeometryLampPoints(layerIndex,t,maxPoints,rawPaths);
                if(exact.length){
                    if(attach) exact=projectLampPointsToCurrentPolygon(exact,attachmentPaths,base,true,circumferenceMode);
                    return preserveBlueMorphLampIdentity(layerIndex,dedupeLampPoints(exact,maxPoints));
                }
            }
            if(['linear','ghost'].includes(getLampEvaluationConfig()?.morphMotionMode) && mode==='corners' && rawPaths?.length){
                let exactCorners=collectSmoothCornerLampPoints(layerIndex,rawPaths,maxPoints);
                if(exactCorners.length){
                    if(attach) exactCorners=projectLampPointsToCurrentPolygon(exactCorners,attachmentPaths,base,true);
                    return preserveBlueMorphLampIdentity(layerIndex,exactCorners);
                }
            }
            if(mode==='arbitrary') return collectArbitraryMorphLampPoints(layerIndex,t,Math.max(600,maxPoints),attachmentPaths); // v308: IDs/fractions are already contour-stable; no straight-line handoff
            if(mode==='key'){
                const srcSpiral=isSpiralLayer(runtimeState.morph.renderSourceLayers?.[layerIndex] || runtimeState.morph.sourceVisuals?.[layerIndex] || base);
                const dstSpiral=isSpiralLayer(runtimeState.morph.renderTargetLayers?.[layerIndex] || runtimeState.morph.targetVisuals?.[layerIndex] || base);
                if((srcSpiral||dstSpiral) && rawPaths?.length){
                    const all=[];
                    const spiralSeamShared=state.tunnel?.active===true && base?.spiralClosed!==false;
                    for(let pathIndex=0;pathIndex<rawPaths.length;pathIndex++){const path=rawPaths[pathIndex],pts=path?.points||[];if(!pts.length)continue;all.push({...pts[0],pathIndex,vertexIndex:0});const flags=path.cornerFlags||[];for(let i=1;i<pts.length-1;i++)if(flags[i])all.push({...pts[i],pathIndex,vertexIndex:i});if(pts.length>1&&!spiralSeamShared)all.push({...pts[pts.length-1],pathIndex,vertexIndex:pts.length-1});}
                    const points=capLampPointList(dedupeLampPoints(all,Math.max(maxPoints,all.length)),maxPoints);
                    return preserveBlueMorphLampIdentity(layerIndex, attach?projectLampPointsToCurrentPolygon(points,attachmentPaths,base,true,circumferenceMode):points);
                }
                let pts=circleMode
                    ? (isChaosCircleMorphPair(layerIndex) ? collectChaosCircleVertexLampPoints(layerIndex,t,maxPoints) : collectCircleVertexLampPoints(layerIndex,t,maxPoints))
                    : collectTopologyVertexLampPoints(layerIndex,t,maxPoints);
                if(pts.length){
                    if(getLampEvaluationConfig()?.calmMode===true && !attach)return preserveBlueMorphLampIdentity(layerIndex,pts);
                    if(attach) pts=projectLampPointsToCurrentPolygon(pts,attachmentPaths,base,true,circumferenceMode);
                    return preserveBlueMorphLampIdentity(layerIndex,pts);
                }
            }
            if(mode==='corners') {
                const points=collectSmoothCornerLampPoints(layerIndex,rawPaths,maxPoints);
                return preserveBlueMorphLampIdentity(layerIndex, attach?projectLampPointsToCurrentPolygon(points,attachmentPaths,base,true):points);
            }
            return [];
        }
        function lampSeedUnit(seed,salt=0){
            let x=((Number(seed)||0) ^ Math.imul((salt+1),0x9e3779b1))>>>0;
            x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);x^=x>>>16;
            return (x>>>0)/4294967296;
        }
        function lampMorphWave(seed,salt=0){
            if(getLampEvaluationConfig()?.morphEnabled!==true || !runtimeState.morph?.active) return 0;
            const cycleSec=Math.max(.05,getTapMorphIntervalSec(state.morph.intervalSec,'full'));
            const time=lampVisualNow()/1000/cycleSec;
            const phase=lampSeedUnit(seed,salt)*Math.PI*2;
            const phase2=lampSeedUnit(seed,salt+17)*Math.PI*2;
            return Math.max(-1,Math.min(1,Math.sin(time*Math.PI*2+phase)*.68+Math.sin(time*Math.PI*4*.73+phase2)*.32));
        }
        const lampAdaptiveFrame={previousArea:0,currentArea:0,seen:new Set(),activeLayers:0,lastViewportArea:0,needsSettle:false,instantStatic:true};
        const lampAdaptiveSmoothing=new WeakMap();
        function beginLampAdaptiveFrame(){
            lampAdaptiveFrame.currentArea=0;lampAdaptiveFrame.activeLayers=0;lampAdaptiveFrame.seen.clear();lampAdaptiveFrame.needsSettle=false;
            // v502: a genuinely static scene applies adaptive exposure in the very next paint.
            // The configured fade remains meaningful only while some Morph-class animation is active.
            lampAdaptiveFrame.instantStatic=typeof isAnyMorphLikeAnimationActive==='function'?!isAnyMorphLikeAnimationActive():!(runtimeState?.morph?.active===true||runtimeState?.minimalMorph?.active===true||runtimeState?.projectMorph?.active===true);
        }
        function finishLampAdaptiveFrame(){
            const prev=Math.max(0,Number(lampAdaptiveFrame.previousArea)||0);
            const cur=Math.max(0,Number(lampAdaptiveFrame.currentArea)||0);
            lampAdaptiveFrame.previousArea=cur;
            // Static scenes snap to the target factor, so at most one extra paint is needed to
            // publish the completed shared exposure estimate. Morph-class animation may continue
            // scheduling paints while the configured adaptive fade converges.
            const denom=Math.max(1,prev,cur);
            const areaChanged=Math.abs(cur-prev)/denom>.015;
            // Adaptive exposure must never become a second owner of the heavy frame loop.
            // While Morph / linear motion is active, its scheduler already produces every
            // display frame needed for smoothing. Re-invalidating the full canvas here made
            // dense Corridor scenes queue another expensive paint continuously and amplified
            // frame-time jitter. A genuinely static scene still gets the one follow-up paint
            // needed to publish a changed shared exposure estimate.
            if(lampAdaptiveFrame.instantStatic && areaChanged) requestMainCanvasRender();
        }
        function smoothLampAdaptiveFactors(cfg,targetRadiusFactor,targetBrightnessFactor){
            const targetR=Math.max(.001,Math.min(1,Number(targetRadiusFactor)||1));
            const targetB=Math.max(.001,Math.min(1,Number(targetBrightnessFactor)||1));
            const durationSec=lampAdaptiveFrame.instantStatic?0:Math.max(0,Number(cfg?.adaptiveFadeSec??1)||0);
            const now=lampVisualNow();
            if(durationSec<=0){
                lampAdaptiveSmoothing.set(cfg,{radiusFactor:targetR,brightnessFactor:targetB,targetR,targetB,startR:targetR,startB:targetB,startTime:now,durationSec:0,lastDurationSec:0});
                return {radiusFactor:targetR,brightnessFactor:targetB};
            }
            let rt=lampAdaptiveSmoothing.get(cfg);
            if(!rt){
                rt={radiusFactor:1,brightnessFactor:1,targetR:1,targetB:1,startR:1,startB:1,startTime:now,durationSec,lastDurationSec:durationSec};
                lampAdaptiveSmoothing.set(cfg,rt);
            }
            const evaluate=(time)=>{
                const dur=Math.max(.001,Number(rt.durationSec)||durationSec);
                const t=Math.max(0,Math.min(1,(time-(Number(rt.startTime)||time))/(dur*1000)));
                // Smoothstep gives a soft beginning/end while still arriving exactly at t=1.
                const e=t*t*(3-2*t);
                rt.radiusFactor=rt.startR+(rt.targetR-rt.startR)*e;
                rt.brightnessFactor=rt.startB+(rt.targetB-rt.startB)*e;
                return t;
            };
            evaluate(now);
            const targetChanged=Math.abs(targetR-rt.targetR)>.001||Math.abs(targetB-rt.targetB)>.001;
            const durationChanged=Math.abs(durationSec-(Number(rt.durationSec)||durationSec))>.001;
            if(targetChanged||durationChanged){
                // Continue from the current visual state; never jump when target/time changes.
                rt.startR=rt.radiusFactor;rt.startB=rt.brightnessFactor;
                rt.targetR=targetR;rt.targetB=targetB;
                rt.startTime=now;rt.durationSec=durationSec;
            }
            const progress=evaluate(now);
            if(progress<1)lampAdaptiveFrame.needsSettle=true;
            else {rt.radiusFactor=rt.targetR;rt.brightnessFactor=rt.targetB;}
            return {radiusFactor:rt.radiusFactor,brightnessFactor:rt.brightnessFactor};
        }
        function lampAdaptiveExposureFactors(cfg, pointsCount, instanceCount, baseR, baseBrightness, viewZoom=state.zoom){
            if(cfg?.adaptiveBrightness===false){lampAdaptiveSmoothing.delete(cfg);return {radiusFactor:1,brightnessFactor:1};}
            const adaptiveStrength=Math.max(0,Math.min(100,Number(cfg?.adaptiveStrength??100)))/100;
            const adaptiveMultiplier=Math.max(0,Number(cfg?.adaptiveStrengthMultiplier??1));
            const adaptivePower=adaptiveStrength*adaptiveMultiplier;
            const count=Math.max(1,(Number(pointsCount)||1)*(Number(instanceCount)||1));
            const zoom=Math.max(.05,Number(viewZoom)||1);
            const rScreen=Math.max(.5,(Number(baseR)||1)*zoom);
            const viewportArea=Math.max(1,(mainCanvas?.clientWidth||innerWidth||1)*(mainCanvas?.clientHeight||innerHeight||1));
            const targetArea=viewportArea/3;
            const estimatedArea=count*Math.PI*rScreen*rScreen;
            // Config identity is the layer identity for adaptive exposure. Corridor copies
            // of the same layer therefore contribute once, while every adaptive layer is
            // included in the shared exposure budget.
            if(!lampAdaptiveFrame.seen.has(cfg)){
                lampAdaptiveFrame.seen.add(cfg);lampAdaptiveFrame.currentArea+=estimatedArea;lampAdaptiveFrame.activeLayers++;
            }
            const sharedArea=Math.max(estimatedArea,Number(lampAdaptiveFrame.previousArea)||0);
            let targetRadiusFactor=1,targetBrightnessFactor=1;
            const adjustBrightness=cfg?.adaptiveAdjustBrightness===true;
            // v226: brightness-only adaptation gets a low-population headroom. The previous
            // formula began attenuating as soon as N*pi*r^2 exceeded viewport/3, so one or
            // two large lamps could be cut to 50% or 25% even though the scene was sparse.
            // Headroom is strongest at one lamp and decays exponentially; by ~24 effective
            // lamps it is essentially gone, preserving the old protection on dense scenes.
            const lowCountHeadroom=adjustBrightness
                ? 1 + 2.25*Math.exp(-Math.max(0,count-1)/5.5)
                : 1;
            const effectiveTargetArea=targetArea*lowCountHeadroom;
            if(sharedArea>effectiveTargetArea && adaptivePower>0){
                const loadFactor=Math.max(.001,Math.min(1,effectiveTargetArea/sharedArea));
                if(adjustBrightness){
                    // Brightness adaptation is an ALTERNATIVE channel: radius stays untouched.
                    // Adaptive Strength remains the exponent, so 100% x1 still means full
                    // compensation once the low-count headroom has been exceeded.
                    targetRadiusFactor=1;
                    targetBrightnessFactor=Math.max(.001,Math.min(1,Math.pow(loadFactor,adaptivePower)));
                }else{
                    // Radius-only mode deliberately keeps the old threshold/response.
                    const requiredRadiusFactor=Math.sqrt(loadFactor);
                    targetRadiusFactor=Math.max(.001,Math.min(1,Math.pow(requiredRadiusFactor,adaptivePower)));
                    targetBrightnessFactor=1;
                }
            }
            return smoothLampAdaptiveFactors(cfg,targetRadiusFactor,targetBrightnessFactor);
        }
        function lampAdaptiveBrightnessFactor(cfg, pointsCount, instanceCount, baseR, baseBrightness){
            return lampAdaptiveExposureFactors(cfg,pointsCount,instanceCount,baseR,baseBrightness).brightnessFactor;
        }
        function lampEffectiveBokeh(cfg) {
            const scatterBase=Math.max(0,Math.min(100,Number(cfg?.scatter)||0))/100;
            const scatterMult=Math.max(0,Number.isFinite(Number(cfg?.scatterMultiplier))?Number(cfg.scatterMultiplier):1);
            const sizeBase=Math.max(0,Math.min(100,Number(cfg?.sizeVariation)||0))/100;
            const sizeMult=Math.max(0,Number(cfg?.sizeVariationMultiplier??1));
            const brightBase=Math.max(0,Math.min(100,Number(cfg?.brightnessVariation)||0))/100;
            const brightMult=Math.max(0,Number(cfg?.brightnessVariationMultiplier??1));
            return {
                scatter:Math.max(0,scatterBase*scatterMult),
                sizeVar:Math.max(0,Math.min(3,sizeBase*sizeMult)),
                brightVar:Math.max(0,Math.min(3,brightBase*brightMult))
            };
        }
        function drawLampDirect(ctx, px, py, color, radius, softness, type, brightnessPercent){
            const r=Math.max(1,Number(radius)||1);
            const soft=Math.max(0,Math.min(150,Number.isFinite(Number(softness))?Number(softness):75));
            const bright=Math.max(0,Math.min(200,Number.isFinite(Number(brightnessPercent))?Number(brightnessPercent):100));
            const softN=Math.min(100,soft)/100;
            const whiteCoreFade=type==='whiteCore' ? (soft<=100?1:Math.max(0,1-(soft-100)/50)) : 0;
            const overdrive=Math.max(0,Math.min(1,(bright-100)/100));
            const haloFade=1-overdrive;
            const coreHardness=(type==='whiteCore'||type==='softCore')?(1-softN):0;
            const haloVisibility=haloFade*((type==='whiteCore'||type==='softCore')?softN:1);
            const whiteToSoftMix=type==='whiteCore'&&soft>100?Math.max(0,Math.min(1,(soft-100)/50)):0;
            const coreHaloBase=type==='softCore'?1.25:(type==='whiteCore'?(1.45-.20*whiteToSoftMix):1.45);
            const haloScale=coreHaloBase+(type==='star'?.55:softN*2.8)*haloFade;
            const outerR=Math.max(r+2,r*haloScale+3);
            const {r:cr,g:cg,b:cb}=hexToRgbaParts(color);
            const bodyFrac=Math.max(.03,Math.min(.93,r/outerR));
            const plateauFrac=bodyFrac*overdrive;
            const edgeAlpha=.08+.92*overdrive;
            const grad=ctx.createRadialGradient(px,py,0,px,py,outerR);
            const bodyStop=Math.min(.985,bodyFrac),justOutside=Math.min(.997,bodyStop+.012);
            const addSelectedBodyStops=(centerAlpha=1,hardness=0)=>{
                const hard=Math.max(overdrive,Math.max(0,Math.min(1,hardness)));
                const plateau=bodyStop*hard,bodyEdgeAlpha=Math.max(edgeAlpha,hard);
                grad.addColorStop(0,`rgba(${cr},${cg},${cb},${centerAlpha})`);
                if(hard>.001)grad.addColorStop(Math.min(bodyStop-.002,Math.max(.002,plateau)),`rgba(${cr},${cg},${cb},1)`);
                grad.addColorStop(bodyStop,`rgba(${cr},${cg},${cb},${bodyEdgeAlpha})`);
            };
            if(type==='solarDark'){
                const darkCore=Math.max(.06,bodyFrac*(.18+.22*(1-softN)));
                grad.addColorStop(0,`rgba(0,0,0,${.96-softN*.16})`);grad.addColorStop(darkCore,`rgba(0,0,0,${.76-softN*.22})`);
                if(overdrive>.001)grad.addColorStop(Math.min(bodyStop-.006,Math.max(darkCore+.006,plateauFrac)),`rgba(${cr},${cg},${cb},1)`);
                grad.addColorStop(bodyStop,`rgba(${cr},${cg},${cb},${edgeAlpha})`);
            }else if(type==='ring'){
                const inner=bodyFrac*(.35-.12*overdrive),ringStart=Math.max(inner+.01,bodyFrac*(.67-.18*overdrive));
                grad.addColorStop(0,`rgba(${cr},${cg},${cb},${.02+.12*overdrive})`);grad.addColorStop(inner,`rgba(${cr},${cg},${cb},${.08+.25*overdrive})`);
                grad.addColorStop(ringStart,'rgba(255,255,255,1)');grad.addColorStop(bodyStop,`rgba(${cr},${cg},${cb},${edgeAlpha})`);
            }else if(type==='whiteCore'){
                if(soft<=100){
                    const whiteExtent=bodyFrac*(1-.90*softN),whiteHold=Math.max(.004,whiteExtent*(softN<.01?1:.58));
                    grad.addColorStop(0,'rgba(255,255,255,1)');grad.addColorStop(Math.min(bodyStop-.003,whiteHold),'rgba(255,255,255,1)');
                    if(softN<.01){
                        if(overdrive>.001)grad.addColorStop(Math.min(bodyStop-.002,Math.max(.006,plateauFrac)),'rgba(255,255,255,1)');
                        grad.addColorStop(bodyStop,`rgba(255,255,255,${Math.max(edgeAlpha,coreHardness)})`);
                    }else{
                        const wt=Math.min(bodyStop-.004,Math.max(whiteHold+.004,whiteExtent));grad.addColorStop(wt,`rgba(${cr},${cg},${cb},1)`);
                        if(overdrive>.001&&plateauFrac>wt+.004)grad.addColorStop(Math.min(bodyStop-.002,plateauFrac),`rgba(${cr},${cg},${cb},1)`);
                        grad.addColorStop(bodyStop,`rgba(${cr},${cg},${cb},${Math.max(edgeAlpha,coreHardness)})`);
                    }
                }else if(whiteCoreFade<=.001)addSelectedBodyStops(1,0);
                else{
                    const rr=mixLampRgb(cr,255,whiteCoreFade),gg=mixLampRgb(cg,255,whiteCoreFade),bb=mixLampRgb(cb,255,whiteCoreFade);
                    const extent=Math.max(.002,bodyFrac*.10*whiteCoreFade),hold=Math.max(.001,extent*.58);
                    grad.addColorStop(0,`rgba(${rr},${gg},${bb},1)`);grad.addColorStop(Math.min(bodyStop-.006,hold),`rgba(${rr},${gg},${bb},1)`);
                    const wt=Math.min(bodyStop-.004,Math.max(hold+.003,extent));grad.addColorStop(wt,`rgba(${cr},${cg},${cb},1)`);
                    if(overdrive>.001&&plateauFrac>wt+.004)grad.addColorStop(Math.min(bodyStop-.002,plateauFrac),`rgba(${cr},${cg},${cb},1)`);
                    grad.addColorStop(bodyStop,`rgba(${cr},${cg},${cb},${edgeAlpha})`);
                }
            }else addSelectedBodyStops(1,type==='softCore'?coreHardness:0);
            if(overdrive>=.999||((type==='whiteCore'||type==='softCore')&&softN<=.001)){
                grad.addColorStop(justOutside,'rgba(0,0,0,0)');grad.addColorStop(1,'rgba(0,0,0,0)');
            }else{
                const haloA=Math.min(.30,edgeAlpha*.85)*haloVisibility,haloMidA=haloA*.28;
                const haloMid=Math.min(.995,bodyStop+(1-bodyStop)*(.34+.20*softN));
                grad.addColorStop(Math.min(.993,bodyStop+(1-bodyStop)*.10),`rgba(${cr},${cg},${cb},${haloA})`);
                grad.addColorStop(haloMid,`rgba(${cr},${cg},${cb},${haloMidA})`);grad.addColorStop(1,`rgba(${cr},${cg},${cb},0)`);
            }
            ctx.fillStyle=grad;ctx.fillRect(px-outerR-2,py-outerR-2,outerR*2+4,outerR*2+4);
            if(type==='star'){
                // Direct vector rays avoid scaling a bitmap at very large radii.
                const ray=r*(1.85+.25*(1-softN)),diag=ray*.52;
                ctx.save();ctx.globalCompositeOperation='source-over';ctx.strokeStyle='#ffffff';ctx.lineCap='round';
                ctx.lineWidth=Math.max(1.6,r*.20);ctx.beginPath();ctx.moveTo(px-ray,py);ctx.lineTo(px+ray,py);ctx.moveTo(px,py-ray);ctx.lineTo(px,py+ray);ctx.moveTo(px-diag,py-diag);ctx.lineTo(px+diag,py+diag);ctx.moveTo(px+diag,py-diag);ctx.lineTo(px-diag,py+diag);ctx.stroke();
                ctx.lineWidth=Math.max(.65,r*.065);ctx.stroke();ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(px,py,Math.max(1.1,r*.16),0,Math.PI*2);ctx.fill();ctx.restore();
            }
        }

        // v225: HD is true 2x supersampling relative to the CURRENT destination
        // resolution, not merely "minimum DPR 2". Therefore it still has an effect on
        // a DPR-2 display (sample at ~4 px/local-unit, then downsample once). Work is
        // restricted to the visible rectangle of large lamps and processed in reusable
        // tiles, so there is no permanent fullscreen 4x surface.
        const LAMP_HD_SSAA=2;
        const LAMP_HD_MAX_SAMPLE_SCALE=4;
        const LAMP_HD_MAX_TILE_PX=1024;
        const lampHdTileCanvas=document.createElement('canvas');
        lampHdTileCanvas.width=LAMP_HD_MAX_TILE_PX;lampHdTileCanvas.height=LAMP_HD_MAX_TILE_PX;
        const lampHdTileCtx=lampHdTileCanvas.getContext('2d',{alpha:true});
        const lampHdBudget={frameId:-1,pixels:0};
        function lampDirectVisualExtent(radius,softness,type,brightnessPercent){
            const r=Math.max(1,Number(radius)||1);
            const soft=Math.max(0,Math.min(150,Number.isFinite(Number(softness))?Number(softness):75));
            const bright=Math.max(0,Math.min(200,Number.isFinite(Number(brightnessPercent))?Number(brightnessPercent):100));
            const softN=Math.min(100,soft)/100,overdrive=Math.max(0,Math.min(1,(bright-100)/100)),haloFade=1-overdrive;
            const whiteToSoftMix=type==='whiteCore'&&soft>100?Math.max(0,Math.min(1,(soft-100)/50)):0;
            const coreHaloBase=type==='softCore'?1.25:(type==='whiteCore'?(1.45-.20*whiteToSoftMix):1.45);
            const haloScale=coreHaloBase+(type==='star'?.55:softN*2.8)*haloFade;
            let extent=Math.max(r+4,r*haloScale+6);
            if(type==='star')extent=Math.max(extent,r*(2.15+.25*(1-softN))+6);
            return extent;
        }
        function lampHdVisibleLocalBounds(ctx){
            if(typeof ctx.getTransform!=='function')return null;
            const tr=ctx.getTransform(),a=Number(tr.a)||0,b=Number(tr.b)||0,c=Number(tr.c)||0,d=Number(tr.d)||0,e=Number(tr.e)||0,f=Number(tr.f)||0;
            const det=a*d-b*c;if(Math.abs(det)<1e-12)return null;
            const inv=(x,y)=>({x:(d*(x-e)-c*(y-f))/det,y:(-b*(x-e)+a*(y-f))/det});
            const w=Math.max(1,Number(ctx.canvas?.width)||1),h=Math.max(1,Number(ctx.canvas?.height)||1);
            const p0=inv(0,0),p1=inv(w,0),p2=inv(0,h),p3=inv(w,h);
            return {minX:Math.min(p0.x,p1.x,p2.x,p3.x),maxX:Math.max(p0.x,p1.x,p2.x,p3.x),minY:Math.min(p0.y,p1.y,p2.y,p3.y),maxY:Math.max(p0.y,p1.y,p2.y,p3.y),deviceScale:Math.max(Math.hypot(a,b),Math.hypot(c,d))};
        }
        function drawLampHD(ctx,px,py,color,radius,softness,type,brightness){
            if(!lampHdTileCtx||type==='star')return drawLampDirect(ctx,px,py,color,radius,softness,type,brightness);
            const view=lampHdVisibleLocalBounds(ctx);if(!view)return drawLampDirect(ctx,px,py,color,radius,softness,type,brightness);
            // No useful visual win on tiny lamps. Spend HD budget where radial bands/grid
            // artefacts can actually become visible.
            if(Math.max(1,Number(radius)||1)*Math.max(.001,view.deviceScale)<18)return drawLampDirect(ctx,px,py,color,radius,softness,type,brightness);
            const sampleScale=Math.min(LAMP_HD_MAX_SAMPLE_SCALE,Math.max(2,view.deviceScale*LAMP_HD_SSAA));
            if(sampleScale<=view.deviceScale*1.08)return drawLampDirect(ctx,px,py,color,radius,softness,type,brightness);
            const extent=lampDirectVisualExtent(radius,softness,type,brightness);
            const minX=Math.max(px-extent,view.minX),maxX=Math.min(px+extent,view.maxX),minY=Math.max(py-extent,view.minY),maxY=Math.min(py+extent,view.maxY);
            if(!(maxX>minX&&maxY>minY))return;
            const frameId=renderRuntime?.active?(Number(renderRuntime.frameId)||0):Math.floor(lampVisualNow()/16);
            if(lampHdBudget.frameId!==frameId){lampHdBudget.frameId=frameId;lampHdBudget.pixels=0;}
            const cssArea=Math.max(1,(Number(canvasViewport?.w)||1)*(Number(canvasViewport?.h)||1));
            // HD is user-opt-in. Permit one nearly fullscreen large lamp at DPR2->4,
            // while still bounding total work when many lamps overlap.
            const pixelBudget=Math.max(4_000_000,Math.min(32_000_000,Math.round(cssArea*18)));
            const tileLocal=Math.max(96,Math.min(384,Math.floor((LAMP_HD_MAX_TILE_PX-8)/sampleScale)));
            let requiredPixels=0;
            for(let ty=minY;ty<maxY-1e-9;ty+=tileLocal){const th=Math.min(tileLocal,maxY-ty);for(let tx=minX;tx<maxX-1e-9;tx+=tileLocal){const tw=Math.min(tileLocal,maxX-tx);requiredPixels+=Math.ceil(tw*sampleScale+6)*Math.ceil(th*sampleScale+6);}}
            if(lampHdBudget.pixels+requiredPixels>pixelBudget)return drawLampDirect(ctx,px,py,color,radius,softness,type,brightness);
            lampHdBudget.pixels+=requiredPixels;
            const prevSmooth=ctx.imageSmoothingEnabled,prevQuality=('imageSmoothingQuality' in ctx)?ctx.imageSmoothingQuality:null;
            ctx.imageSmoothingEnabled=true;if('imageSmoothingQuality' in ctx)ctx.imageSmoothingQuality='high';
            const padPx=3,padLocal=padPx/sampleScale;
            for(let ty=minY;ty<maxY-1e-9;ty+=tileLocal){
                const th=Math.min(tileLocal,maxY-ty);
                for(let tx=minX;tx<maxX-1e-9;tx+=tileLocal){
                    const tw=Math.min(tileLocal,maxX-tx),rx=tx-padLocal,ry=ty-padLocal,rw=tw+padLocal*2,rh=th+padLocal*2;
                    const pw=Math.min(LAMP_HD_MAX_TILE_PX,Math.ceil(rw*sampleScale)),ph=Math.min(LAMP_HD_MAX_TILE_PX,Math.ceil(rh*sampleScale));
                    lampHdTileCtx.setTransform(1,0,0,1,0,0);lampHdTileCtx.globalAlpha=1;lampHdTileCtx.globalCompositeOperation='source-over';lampHdTileCtx.clearRect(0,0,pw,ph);
                    lampHdTileCtx.setTransform(sampleScale,0,0,sampleScale,-rx*sampleScale,-ry*sampleScale);
                    drawLampDirect(lampHdTileCtx,px,py,color,radius,softness,type,brightness);
                    lampHdTileCtx.setTransform(1,0,0,1,0,0);
                    const sx=padLocal*sampleScale,sy=padLocal*sampleScale,sw=tw*sampleScale,sh=th*sampleScale;
                    ctx.drawImage(lampHdTileCanvas,sx,sy,sw,sh,tx,ty,tw,th);
                }
            }
            ctx.imageSmoothingEnabled=prevSmooth;if(prevQuality!==null)ctx.imageSmoothingQuality=prevQuality;
        }

        // v173: Optional fast lamp renderer. In raster mode a canonical lamp sprite is
        // cached and scaled at draw time. Turning it off restores the original direct
        // radial-gradient renderer at final canvas resolution.
        const lampRasterSpriteCache=new Map();
        const LAMP_RASTER_BASE_RADIUS=24;
        const LAMP_RASTER_CANVAS_SIZE=256;
        // v223: Raster sprites are an acceleration path ONLY while they are being
        // downscaled (or, at most, drawn ~1:1) in physical device pixels.  A fixed
        // CSS-radius threshold is not enough on HiDPI displays: e.g. a 30 px lamp at
        // DPR=2 already magnifies the canonical 24 px-radius bitmap by 2.5x in the
        // backing store and exposes its raster/dither lattice.  Once a source pixel
        // would cover more than ~0.9 device pixels, switch to the exact radial gradient.
        const LAMP_RASTER_MAX_DEVICE_MAGNIFICATION=0.90;
        function lampRasterSpriteKey(color,softness,type,brightness){
            const s=Math.round(Math.max(0,Math.min(150,Number(softness)||0))/5)*5;
            const b=Math.round(Math.max(0,Math.min(200,Number(brightness)||0))/5)*5;
            return `${String(color||'#ffffff').toLowerCase()}|${s}|${type||'whiteCore'}|${b}`;
        }
        function getLampRasterSprite(color,softness,type,brightness){
            const key=lampRasterSpriteKey(color,softness,type,brightness);
            let sprite=lampRasterSpriteCache.get(key);if(sprite)return sprite;
            const canvas=document.createElement('canvas');canvas.width=LAMP_RASTER_CANVAS_SIZE;canvas.height=LAMP_RASTER_CANVAS_SIZE;
            const c=canvas.getContext('2d',{alpha:true});
            if(!c)return null;
            const qSoft=Math.round(Math.max(0,Math.min(150,Number(softness)||0))/5)*5;
            const qBright=Math.round(Math.max(0,Math.min(200,Number(brightness)||0))/5)*5;
            drawLampDirect(c,LAMP_RASTER_CANVAS_SIZE/2,LAMP_RASTER_CANVAS_SIZE/2,color,LAMP_RASTER_BASE_RADIUS,qSoft,type,qBright);
            sprite={canvas,key};lampRasterSpriteCache.set(key,sprite);
            if(lampRasterSpriteCache.size>256){const first=lampRasterSpriteCache.keys().next().value;lampRasterSpriteCache.delete(first);}
            return sprite;
        }
        function drawLampRasterized(ctx,px,py,color,radius,softness,type,brightness){
            const localRadius=Math.max(.001,Number(radius)||1);

            // Measure the REAL local->backing-store scale.  getTransform() already
            // contains DPR, zoom, layer scale and tunnel-copy scale, so do not divide
            // DPR back out here.  What matters for raster quality is how many physical
            // destination pixels one source sprite pixel occupies.
            let deviceScale=1;
            if(typeof ctx.getTransform==='function'){
                const tr=ctx.getTransform();
                const sx=Math.hypot(Number(tr.a)||0,Number(tr.b)||0);
                const sy=Math.hypot(Number(tr.c)||0,Number(tr.d)||0);
                const measured=Math.max(sx,sy);
                if(Number.isFinite(measured)&&measured>0)deviceScale=measured;
            }
            const sourcePixelMagnification=(localRadius/LAMP_RASTER_BASE_RADIUS)*deviceScale;

            // Never upscale the canonical sprite.  This applies even when the user has
            // explicitly enabled “Растр.”: the checkbox may accelerate genuinely small
            // lamps, but it must never trade a large lamp for a visible pixel lattice.
            if(sourcePixelMagnification>LAMP_RASTER_MAX_DEVICE_MAGNIFICATION){
                drawLampDirect(ctx,px,py,color,localRadius,softness,type,brightness);
                return;
            }

            const sprite=getLampRasterSprite(color,softness,type,brightness);if(!sprite)return drawLampDirect(ctx,px,py,color,localRadius,softness,type,brightness);
            const scale=localRadius/LAMP_RASTER_BASE_RADIUS;
            const size=LAMP_RASTER_CANVAS_SIZE*scale;
            const prev=ctx.imageSmoothingEnabled;
            const prevQuality=('imageSmoothingQuality' in ctx)?ctx.imageSmoothingQuality:null;
            ctx.imageSmoothingEnabled=true;
            if('imageSmoothingQuality' in ctx)ctx.imageSmoothingQuality='high';
            ctx.drawImage(sprite.canvas,px-size/2,py-size/2,size,size);
            ctx.imageSmoothingEnabled=prev;
            if(prevQuality!==null)ctx.imageSmoothingQuality=prevQuality;
        }

        function prepareLampDrawStyle(cfg,audioLayerIndex,pointsLength,adaptiveInstanceCount,viewZoom,out=null) {
            const style=out||{};
            const radiusMult=Math.max(0,Number(cfg.radiusMultiplier??1)||0);
            style.baseR=Math.max(1,(Number(cfg.radius)||50)*radiusMult);
            style.baseBrightnessPercent=Math.max(0,Math.min(200,Number.isFinite(Number(cfg.brightness))?Number(cfg.brightness):100));
            const softnessMult=Math.max(0,Number.isFinite(Number(cfg.softnessMultiplier))?Number(cfg.softnessMultiplier):1);
            style.effectiveSoftness=Math.max(0,Math.min(150,audioApplyNumeric('lamps.softness',(Number.isFinite(Number(cfg.softness))?Number(cfg.softness):100)*softnessMult,audioLayerIndex)));
            let bokeh=lampEffectiveBokeh(cfg);
            style.scatter=Math.max(0,audioApplyNumeric('lamps.scatter',bokeh.scatter,audioLayerIndex));
            style.sizeVar=Math.max(0,audioApplyNumeric('lamps.sizeVariation',bokeh.sizeVar,audioLayerIndex));
            style.brightVar=Math.max(0,audioApplyNumeric('lamps.brightnessVariation',bokeh.brightVar,audioLayerIndex));
            style.morphSize=Math.max(0,Math.min(1,(Number(cfg.morphSize)||0)/100));
            style.morphBright=Math.max(0,Math.min(1,(Number(cfg.morphBrightness)||0)/100));
            style.adaptive=lampAdaptiveExposureFactors(cfg,pointsLength,adaptiveInstanceCount,style.baseR,style.baseBrightnessPercent/100,viewZoom);
            style.blendMode=cfg.blendMode||'lighter';
            style.colorMode=cfg.colorMode || (cfg.rainbow?'rainbow':cfg.matchLineColor?'line':'selected');
            style.type=cfg.type||'whiteCore';
            return style;
        }
        
        // v210: all corridor copies of a lamp-set share the same local lamp
        // solution. Seeded scatter, radius, brightness and colour are computed once
        // per frame; only the copy transform / raster threshold varies per instance.
        function prepareLampVisualPlan(points, layer, cfg, style, audioLayerIndex, out=null) {
            const plan=out||{};
            const items=Array.isArray(plan.items)?plan.items:(plan.items=[]);
            let write=0;
            const total=points?.length||0;
            const baseR=style.baseR,baseBrightnessPercent=style.baseBrightnessPercent;
            const scatter=style.scatter,sizeVar=style.sizeVar,brightVar=style.brightVar,morphSize=style.morphSize,morphBright=style.morphBright,adaptive=style.adaptive;
            const layerSeed=lampHash32(String(layer?.id||layer?.name||'layer'));
            // Audio modulation is layer-scoped; getLampAudioMod's point index is not
            // used. Resolve it once instead of allocating the same object per point.
            const audio=getLampAudioMod(0,audioLayerIndex);
            const audioSize=Math.max(0,Number(audio?.size)||0),audioBrightness=Math.max(0,Number(audio?.brightness)||0);
            const mode=style.colorMode;
            for(let i=0;i<total;i++){
                const p=points[i];
                const level=Math.max(0,Math.min(1,p?.lampLevel===undefined?1:Number(p.lampLevel)||0));
                const presence=Math.max(0,Math.min(1,p?.lampPresence===undefined?1:Number(p.lampPresence)||0));
                if(level<=.002||presence<=.002)continue;
                const seed=Number.isFinite(Number(p?.lampSeed))?(Number(p.lampSeed)>>>0):((layerSeed^Math.imul(i+1,2654435761))>>>0);
                const angle=lampSeedUnit(seed,1)*Math.PI*2;
                const dist=scatter*baseR*2.4*Math.sqrt(lampSeedUnit(seed,2));
                const px=p.x+Math.cos(angle)*dist,py=p.y+Math.sin(angle)*dist;
                const sizeRandom=Math.max(.12,1+(lampSeedUnit(seed,3)*2-1)*sizeVar*.78);
                const brightUnit=Number.isFinite(Number(p?.lampBrightnessUnit))?Math.max(0,Math.min(1,Number(p.lampBrightnessUnit))):lampSeedUnit(seed,4);
                const brightRandom=Math.max(.08,1+(brightUnit*2-1)*brightVar*.9);
                const sizeMorph=Math.max(.12,1+lampMorphWave(seed,5)*morphSize);
                const brightMorph=Math.max(.08,1+lampMorphWave(seed,9)*morphBright);
                const rainbowIndex=Number.isFinite(Number(p?.lampStableIndex))?Math.abs(Math.round(Number(p.lampStableIndex))):i;
                const rainbowPhase=Number.isFinite(Number(p?.lampColorPhase))?wrapLampColorPhase(p.lampColorPhase):wrapLampColorPhase(rainbowIndex/Math.max(1,total));
                const color=mode==='rainbow'?rainbowLampColorPhase(rainbowPhase):(mode==='line'?(layer.strokeColor||'#ffffff'):(cfg.color||'#ffe600'));
                const visualRadiusBase=baseR*sizeRandom*sizeMorph*Math.max(.06,Math.sqrt(level));
                const rad=Math.max(0,visualRadiusBase*adaptive.radiusFactor+visualRadiusBase*(audioSize-1));
                const visualBrightnessBase=baseBrightnessPercent*brightRandom*brightMorph*level;
                const effectiveBrightness=Math.max(0,Math.min(200,visualBrightnessBase*adaptive.brightnessFactor+visualBrightnessBase*(audioBrightness-1)));
                let item=items[write];
                if(!item)item=items[write]={px:0,py:0,rad:0,color:'#ffffff',brightness:0,intensityAlpha:0};
                item.px=px;item.py=py;item.rad=rad;item.color=color;item.brightness=effectiveBrightness;item.intensityAlpha=Math.max(0,Math.min(1,effectiveBrightness/100))*presence;
                // v519: bounded GPU Arc lamp plans keep attachment identity alongside the
                // historical visual payload. Ordinary CPU-positioned plans simply ignore it.
                item.pathIndex=Number.isFinite(Number(p?.pathIndex))?Math.max(0,Math.floor(Number(p.pathIndex))):0;
                item.lampAttachFraction=Number.isFinite(Number(p?.lampAttachFraction))?Math.max(0,Math.min(1,Number(p.lampAttachFraction))):0;
                item.lampIdentityIndex=Number.isFinite(Number(p?.lampIdentityIndex))?Math.max(0,Math.floor(Number(p.lampIdentityIndex))):0;
                const gpuBaseX=Number.isFinite(Number(p?.gpuLampBaseX))?Number(p.gpuLampBaseX):(Number(p?.x)||0),gpuBaseY=Number.isFinite(Number(p?.gpuLampBaseY))?Number(p.gpuLampBaseY):(Number(p?.y)||0);
                item.gpuLampOffsetX=px-gpuBaseX;item.gpuLampOffsetY=py-gpuBaseY;
                write++;
            }
            items.length=write;plan.items=items;plan.cfg=cfg;plan.style=style;return plan;
        }

        const lampRasterPolicy=Object.freeze({explicitOnly:true,autoSmallTunnelRaster:false});

        function drawLampVisualPlan(ctx, visualPlan, alpha, drawPlan) {
            const items=visualPlan?.items;if(!items?.length||alpha<=.001)return;
            const cfg=drawPlan?.config||visualPlan?.cfg||getLampEvaluationConfig()||{};
            const style=drawPlan?.preparedStyle||visualPlan?.style||{};
            const tunnelActive=typeof drawPlan?.tunnelActive==='boolean'?drawPlan.tunnelActive:state.tunnel?.active===true;
            let lampCssTransformScale=1;
            if(Number.isFinite(Number(drawPlan?.cssTransformScale))&&Number(drawPlan.cssTransformScale)>0)lampCssTransformScale=Number(drawPlan.cssTransformScale);
            else if(tunnelActive&&cfg.rasterized!==true&&typeof ctx.getTransform==='function'){
                const tr=ctx.getTransform();lampCssTransformScale=Math.hypot(Number(tr.a)||0,Number(tr.b)||0)/Math.max(1,canvasViewport.dpr||1);if(!Number.isFinite(lampCssTransformScale)||lampCssTransformScale<=0)lampCssTransformScale=1;
            }
            const outerStateIsolated=drawPlan?.outerStateIsolated===true;if(!outerStateIsolated)ctx.save();ctx.globalCompositeOperation=style.blendMode||'lighter';
            const softness=style.effectiveSoftness||0,type=style.type||'whiteCore';
            for(let i=0;i<items.length;i++){
                const v=items[i],rad=v.rad;if(rad<=.001)continue;
                ctx.globalAlpha=Math.max(0,Math.min(1,alpha*v.intensityAlpha));
                const autoSmallTunnelRaster=lampRasterPolicy.autoSmallTunnelRaster; // v404: no hidden raster fallback when Raster is OFF.
                if(cfg.hd===true)drawLampHD(ctx,v.px,v.py,v.color,rad,softness,type,v.brightness);
                else if(cfg.rasterized===true||autoSmallTunnelRaster)drawLampRasterized(ctx,v.px,v.py,v.color,rad,softness,type,v.brightness);
                else drawLampDirect(ctx,v.px,v.py,v.color,rad,softness,type,v.brightness);
            }
            if(!outerStateIsolated)ctx.restore();
        }

        function drawLampPoints(ctx, points, layer, alpha=1, adaptiveInstanceCount=1, drawPlan=null) {
            // v202: the renderer passes all per-layer lamp state explicitly. Legacy callers
            // may omit drawPlan and retain the old global fallback outside the render pipeline.
            if (!points?.length || alpha <= .001) return;
            const cfg=drawPlan?.config||getLampEvaluationConfig()||{};
            const audioLayerIndex=Number.isInteger(drawPlan?.audioLayerIndex)?drawPlan.audioLayerIndex:-1;
            const tunnelActive=typeof drawPlan?.tunnelActive==='boolean'?drawPlan.tunnelActive:state.tunnel?.active===true;
            const viewZoom=Number.isFinite(Number(drawPlan?.zoom))?Number(drawPlan.zoom):state.zoom;
            const style=drawPlan?.preparedStyle||prepareLampDrawStyle(cfg,audioLayerIndex,lampAdaptivePointCount(points,cfg),adaptiveInstanceCount,viewZoom);
            const baseR=style.baseR,baseBrightnessPercent=style.baseBrightnessPercent,effectiveSoftness=style.effectiveSoftness;
            const scatter=style.scatter,sizeVar=style.sizeVar,brightVar=style.brightVar,morphSize=style.morphSize,morphBright=style.morphBright,adaptive=style.adaptive;
            const layerSeed=lampHash32(String(layer?.id||layer?.name||'layer'));
            // v180: Direct radial gradients remain the quality path for large/near lamps.
            // In a corridor, however, most lamps are only a few screen pixels wide; at that
            // size rebuilding a CanvasGradient for every lamp/copy is pure CPU cost with no
            // visible benefit. Use the existing 256px cached sprite only below this threshold.
            let lampCssTransformScale=1;
            if(Number.isFinite(Number(drawPlan?.cssTransformScale))&&Number(drawPlan.cssTransformScale)>0){lampCssTransformScale=Number(drawPlan.cssTransformScale);}
            else if(tunnelActive && cfg.rasterized!==true && typeof ctx.getTransform==='function'){
                const tr=ctx.getTransform();lampCssTransformScale=Math.hypot(Number(tr.a)||0,Number(tr.b)||0)/Math.max(1,canvasViewport.dpr||1);if(!Number.isFinite(lampCssTransformScale)||lampCssTransformScale<=0)lampCssTransformScale=1;
            }
            const outerStateIsolated=drawPlan?.outerStateIsolated===true;if(!outerStateIsolated)ctx.save(); ctx.globalCompositeOperation=style.blendMode;
            const total=points.length;
            for(let i=0;i<total;i++){
                const p=points[i], audio=getLampAudioMod(i,audioLayerIndex);
                const level=Math.max(0,Math.min(1,p?.lampLevel===undefined?1:Number(p.lampLevel)||0));
                const presence=Math.max(0,Math.min(1,p?.lampPresence===undefined?1:Number(p.lampPresence)||0));
                if(level<=.002||presence<=.002)continue;
                const seed=Number.isFinite(Number(p?.lampSeed))?(Number(p.lampSeed)>>>0):((layerSeed^Math.imul(i+1,2654435761))>>>0);
                const a=lampSeedUnit(seed,1)*Math.PI*2;
                const dist=scatter*baseR*2.4*Math.sqrt(lampSeedUnit(seed,2));
                const px=p.x+Math.cos(a)*dist, py=p.y+Math.sin(a)*dist;
                const sizeRandom=Math.max(.12,1+(lampSeedUnit(seed,3)*2-1)*sizeVar*.78);
                const brightUnit=Number.isFinite(Number(p?.lampBrightnessUnit))?Math.max(0,Math.min(1,Number(p.lampBrightnessUnit))):lampSeedUnit(seed,4);
                const brightRandom=Math.max(.08,1+(brightUnit*2-1)*brightVar*.9);
                const sizeMorph=Math.max(.12,1+lampMorphWave(seed,5)*morphSize);
                const brightMorph=Math.max(.08,1+lampMorphWave(seed,9)*morphBright);
                const mode=style.colorMode;
                const rainbowIndex=Number.isFinite(Number(p?.lampStableIndex)) ? Math.abs(Math.round(Number(p.lampStableIndex))) : i;
                const rainbowPhase=Number.isFinite(Number(p?.lampColorPhase))?wrapLampColorPhase(p.lampColorPhase):wrapLampColorPhase(rainbowIndex/Math.max(1,total));
                const color=mode==='rainbow' ? rainbowLampColorPhase(rainbowPhase) : (mode==='line' ? (layer.strokeColor||'#ffffff') : (cfg.color||'#ffe600'));
                // Adaptive establishes the base exposure first. Audio modulation is then
                // applied as a delta measured from the unadapted lamp, so Adaptive cannot
                // attenuate the colour-music pulse. Multiplication here would commute and
                // still suppress the pulse, therefore the post-adaptive contribution is additive.
                const visualRadiusBase=baseR*sizeRandom*sizeMorph*Math.max(.06,Math.sqrt(level));
                const adaptedRadius=visualRadiusBase*adaptive.radiusFactor;
                const audioRadiusDelta=visualRadiusBase*(Math.max(0,Number(audio.size)||0)-1);
                const rad=Math.max(0,adaptedRadius+audioRadiusDelta);
                const visualBrightnessBase=baseBrightnessPercent*brightRandom*brightMorph*level;
                const adaptedBrightness=visualBrightnessBase*adaptive.brightnessFactor;
                const audioBrightnessDelta=visualBrightnessBase*(Math.max(0,Number(audio.brightness)||0)-1);
                const effectiveBrightness=Math.max(0,Math.min(200,adaptedBrightness+audioBrightnessDelta));
                // 0–100% is the ordinary intensity ramp. Above 100% opacity is already
                // maximal and the lamp redistributes that maximum toward the edge.
                const intensityAlpha=Math.max(0,Math.min(1,effectiveBrightness/100));
                ctx.globalAlpha=Math.max(0,Math.min(1,alpha*intensityAlpha*presence));
                if(rad>.001){
                    const autoSmallTunnelRaster=lampRasterPolicy.autoSmallTunnelRaster; // v404: raster lamps are explicit opt-in only.
                    if(cfg.hd===true){
                        drawLampHD(ctx,px,py,color,rad,effectiveSoftness,style.type,effectiveBrightness);
                    }else if(cfg.rasterized===true || autoSmallTunnelRaster){
                        // Explicit raster mode handles every lamp. Automatic corridor
                        // acceleration handles only visually small lamps; large foreground
                        // lamps still use the exact direct HiDPI gradient renderer.
                        drawLampRasterized(ctx,px,py,color,rad,effectiveSoftness,style.type,effectiveBrightness);
                    }else{
                        drawLampDirect(ctx,px,py,color,rad,effectiveSoftness,style.type,effectiveBrightness);
                    }
                }
            }
            if(!outerStateIsolated)ctx.restore();
        }

        // Direct final-resolution lamp rendering is the default quality path. Enable “Растр.”
        // only when the user explicitly wants the faster cached-sprite renderer.

        // Graffiti uses one continuous calligraphic carrier for every active
        // variation range. No dry-marker/dashed overlay is involved.
        const graffitiNibPathCache = new WeakMap();
        const graffitiVariableRibbonCache = new WeakMap();
        const graffitiVariableRibbonCacheStats={hits:0,builds:0};
        // v344 — the same calligraphic support-point geometry also feeds a native WebGPU
        // triangle ribbon.  Path2D and GPU therefore share one mathematical contour.
        const graffitiVariableRibbonMeshCache = new WeakMap();
        const graffitiVariableRibbonMeshCacheStats={hits:0,builds:0,vertices:0};

        function graffitiNibStretch(type, nibRatio=3, nibShape='pointed') {
            const ratio=Math.max(.01,Number(nibRatio)||3);
            if(type==='slash'){
                if(nibShape==='round') return Math.max(1,ratio*.72);
                if(nibShape==='blunt') return Math.max(1,ratio*.92);
                if(nibShape==='pinched') return 1;
                return ratio;
            }
            return 1;
        }
        function graffitiNibWidthFactor(type,nibShape='pointed'){
            let factor=type==='square'?1.04:1;
            if(nibShape==='round')factor*=1.06;
            else if(nibShape==='blunt')factor*=.96;
            return factor;
        }
        function graffitiPathSignature(path) {
            const pts=path?.points||[];
            if(!pts.length)return'0';
            // v343 — full rolling geometry hash. The old eight-point signature could collide
            // after local rounding/morph edits and incorrectly reuse a stale Graffiti bitmap.
            // Quantization is sub-pixel (1/64 px) so harmless FP noise does not invalidate it.
            let h1=2166136261>>>0,h2=2246822519>>>0;
            const mix=(v)=>{v=(v|0)>>>0;h1=Math.imul(h1^v,16777619)>>>0;h2=Math.imul(h2^(v+0x9e3779b9),3266489917)>>>0;};
            mix(pts.length);mix(path.closed?1:0);
            for(const p of pts){
                mix(Math.round((Number(p?.x)||0)*64));
                mix(Math.round((Number(p?.y)||0)*64));
                if(Number.isFinite(Number(p?.widthScale)))mix(Math.round(Number(p.widthScale)*4096));
            }
            return `${pts.length}|${path.closed?1:0}|${h1.toString(36)}${h2.toString(36)}`;
        }
        function getGraffitiNibPath(path,type,markerAngle,nibRatio=3,nibShape='pointed'){
            if(typeof Path2D==='undefined'||!path?.points?.length)return null;
            const stretch=graffitiNibStretch(type,nibRatio,nibShape);
            const angleKey=Math.round(markerAngle*180/Math.PI*10)/10;
            const ratioKey=Math.round(Math.max(.01,Number(nibRatio)||3)*100)/100;
            const key=`${type}|${nibShape}|${ratioKey}|${angleKey}|${graffitiPathSignature(path)}`;
            let bucket=graffitiNibPathCache.get(path);
            if(!bucket){bucket=new Map();graffitiNibPathCache.set(path,bucket);}
            if(bucket.has(key))return bucket.get(key);
            const c=Math.cos(markerAngle),q=Math.sin(markerAngle),p2d=new Path2D();
            const toNib=(p)=>({x:(c*(Number(p.x)||0)+q*(Number(p.y)||0))/stretch,y:-q*(Number(p.x)||0)+c*(Number(p.y)||0)});
            const first=toNib(path.points[0]);p2d.moveTo(first.x,first.y);
            for(let i=1;i<path.points.length;i++){const p=toNib(path.points[i]);p2d.lineTo(p.x,p.y);}
            if(path.closed)p2d.closePath();
            if(bucket.size>6)bucket.clear();
            bucket.set(key,p2d);
            return p2d;
        }
        function strokeGraffitiNibPath(ctx,p2d,type,markerAngle,width,alpha,glow,glowIntensity,nibRatio=3,nibShape='pointed'){
            if(!p2d||alpha<=.001)return;
            const stretch=graffitiNibStretch(type,nibRatio,nibShape);
            const c=Math.cos(markerAngle),q=Math.sin(markerAngle);
            const nibWidth=Math.max(.45,width*graffitiNibWidthFactor(type,nibShape));
            ctx.save();
            ctx.transform(c*stretch,q*stretch,-q,c,0,0);
            ctx.setLineDash([]);

            // This option describes the physical nib itself. It is intentionally
            // separate from trajectory-size variation below.
            if(nibShape==='pinched'){
                ctx.lineJoin='round';ctx.lineCap='round';ctx.miterLimit=2.6;
                const ratio=Math.max(.01,Number(nibRatio)||3);
                const span=Math.max(0,nibWidth*(ratio-1));
                const samples=Math.max(9,Math.min(17,Math.ceil(ratio*1.5)+7));
                const paintPinched=(passAlpha,shadow=0)=>{
                    if(passAlpha<=.001)return;
                    for(let lane=0;lane<samples;lane++){
                        const u=samples<=1?0:(lane/(samples-1))*2-1;
                        const widthFactor=.46+.54*Math.pow(Math.abs(u),1.15);
                        ctx.save();
                        ctx.translate(u*span*.5,0);
                        ctx.lineWidth=Math.max(.28,nibWidth*widthFactor);
                        ctx.globalAlpha=Math.max(0,Math.min(1,passAlpha));
                        ctx.shadowColor=ctx.strokeStyle;
                        ctx.shadowBlur=Math.max(0,shadow);
                        ctx.stroke(p2d);
                        ctx.restore();
                    }
                };
                if(glow>0&&glowIntensity>0)paintPinched(alpha*(.22+.24*glowIntensity),Math.max(.5,glow*.55*glowIntensity));
                paintPinched(alpha,0);
            }else{
                if(nibShape==='pointed'){ctx.lineJoin='miter';ctx.miterLimit=2.6;ctx.lineCap='butt';}
                else if(nibShape==='blunt'){ctx.lineJoin='bevel';ctx.lineCap='butt';}
                else {ctx.lineJoin='round';ctx.lineCap='round';}
                if(type==='square'){ctx.lineJoin='bevel';if(nibShape!=='round')ctx.lineCap='square';}
                ctx.lineWidth=nibWidth;
                if(glow>0&&glowIntensity>0){
                    ctx.save();ctx.globalAlpha=Math.max(0,Math.min(1,alpha*(.22+.24*glowIntensity)));
                    ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=Math.max(.5,glow*.55*glowIntensity);ctx.stroke(p2d);ctx.restore();
                }
                ctx.globalAlpha=Math.max(0,Math.min(1,alpha));ctx.shadowBlur=0;ctx.stroke(p2d);
            }
            ctx.restore();
        }

        function graffitiPathProgress(points){
            const n=points?.length||0,out=new Array(n).fill(0);
            if(n<2)return out;
            let total=0;
            for(let i=1;i<n;i++){const a=points[i-1],b=points[i];total+=Math.hypot((b.x||0)-(a.x||0),(b.y||0)-(a.y||0));out[i]=total;}
            if(total<=1e-6)return out;
            for(let i=0;i<n;i++)out[i]/=total;
            return out;
        }
        function graffitiFocusDistance(t,focus){
            const f=Math.max(.001,Math.min(.999,focus));
            return t<=f?(f-t)/f:(t-f)/(1-f);
        }
        function graffitiRotationProgress(t,focus){
            const f=Math.max(.001,Math.min(.999,focus));
            return t<=f?.5*(t/f):.5+.5*((t-f)/(1-f));
        }
        function resolveGraffitiVariationProgress(p,localT,meta){
            let t=Math.max(0,Math.min(1,Number(localT)||0));
            if(meta?.mode==='global'){
                t=(Number(meta.start)||0)+t*(Number(meta.span)||0);
            }else if(meta?.mode==='across'){
                const span=Math.max(1e-6,Number(meta.span)||1);
                t=((Number(p?.x)||0)-(Number(meta.minX)||0))/span;
            }
            return Math.max(0,Math.min(1,t));
        }
        // 7.0.13 Graffiti corner repair (rev2): keep authored size neutral when
        // trajectory-size variation is disabled.  Corners are repaired by filling the
        // missing wedge between the incoming/outgoing fixed-nib supports; we do NOT stretch
        // the ribbon cross-section with a miter multiplier because that looks like an
        // unintended size variation at every turn.
        function graffitiSupportOffset(nx,ny,angle,stretch,halfWidth){
            const nl=Math.hypot(nx,ny);if(nl<1e-9)return{x:0,y:0};nx/=nl;ny/=nl;
            const ca=Math.cos(angle),sa=Math.sin(angle),a=Math.max(0,halfWidth)*Math.max(1e-6,Number(stretch)||1),b=Math.max(0,halfWidth);
            const ux=ca,uy=sa,vx=-sa,vy=ca,dotMajor=nx*ux+ny*uy,dotMinor=nx*vx+ny*vy,support=Math.hypot(a*dotMajor,b*dotMinor);
            if(support<=1e-9)return{x:0,y:0};
            const major=(a*a*dotMajor)/support,minor=(b*b*dotMinor)/support;return{x:ux*major+vx*minor,y:uy*major+vy*minor};
        }
        // v513 — allocation-light Graffiti ribbon preparation.  The old path walked
        // segment lengths twice and allocated progress[] + two {x,y} objects per vertex.
        // Dynamic ultra-polygons made that a visible GC/main-thread hot path before the GPU
        // upload.  Keep the exact tangent/nib/waist math, but carry sides in typed arrays and
        // derive local progress from the same cumulative arc pass.
        function computeGraffitiVariableRibbonSides(path,width,type,baseAngle,nibRatio,nibShape,sizeStrength,sizeFocus,rotationTotal,rotationFocus,progressMeta=null,angleMode='absolute'){
            const pts=path?.points||[],n=pts.length;if(n<2)return null;
            const closed=path?.closed===true,arc=new Float64Array(n),leftX=new Float64Array(n),leftY=new Float64Array(n),rightX=new Float64Array(n),rightY=new Float64Array(n);
            let openTotal=0;for(let ai=1;ai<n;ai++){const ap=pts[ai-1],bp=pts[ai];openTotal+=Math.hypot((bp.x||0)-(ap.x||0),(bp.y||0)-(ap.y||0));arc[ai]=openTotal;}
            let arcTotal=openTotal;if(closed&&n>2){const ap=pts[n-1],bp=pts[0];arcTotal+=Math.hypot((bp.x||0)-(ap.x||0),(bp.y||0)-(ap.y||0));}
            const invProgressTotal=openTotal>1e-6?1/openTotal:0,stretch=graffitiNibStretch(type,nibRatio,nibShape),baseHalf=Math.max(.225,width*graffitiNibWidthFactor(type,nibShape)*.5);
            for(let i=0;i<n;i++){
                // v437 contract retained: normalized incoming/outgoing directions are averaged,
                // so a long neighbour cannot bias the nib angle at corners or on splines.
                const p=pts[i],prev=pts[closed?(i+n-1)%n:Math.max(0,i-1)],next=pts[closed?(i+1)%n:Math.min(n-1,i+1)];
                let ix=(p.x||0)-(prev.x||0),iy=(p.y||0)-(prev.y||0),il=Math.hypot(ix,iy);if(il>1e-6){ix/=il;iy/=il;}else{ix=0;iy=0;}
                let ox=(next.x||0)-(p.x||0),oy=(next.y||0)-(p.y||0),ol=Math.hypot(ox,oy);if(ol>1e-6){ox/=ol;oy/=ol;}else{ox=0;oy=0;}
                let tx=ix+ox,ty=iy+oy,tl=Math.hypot(tx,ty);if(tl<1e-6){if(ol>1e-6){tx=ox;ty=oy;}else if(il>1e-6){tx=ix;ty=iy;}else{tx=1;ty=0;}tl=Math.hypot(tx,ty)||1;}tx/=tl;ty/=tl;
                const nx=-ty,ny=tx,localT=invProgressTotal?arc[i]*invProgressTotal:0,t=resolveGraffitiVariationProgress(p,localT,progressMeta);
                const d=graffitiFocusDistance(t,sizeFocus),sizeFactor=Math.max(0,1-sizeStrength*(1-Math.max(0,Math.min(1,d))));
                const tangentAngle=angleMode==='relative'?Math.atan2(ty,tx):0,angle=tangentAngle+baseAngle+rotationTotal*graffitiRotationProgress(t,rotationFocus),ca=Math.cos(angle),sa=Math.sin(angle),a=baseHalf*stretch*sizeFactor,b=baseHalf*sizeFactor;
                const supportOffset=graffitiSupportOffset(nx,ny,angle,stretch,baseHalf*sizeFactor);let sx=supportOffset.x,sy=supportOffset.y;
                if(nibShape==='pinched'){const period=Math.max(baseHalf*2.5,Math.max(2,Number(nibRatio)||10)*baseHalf*.9),phase=(arc[i]/Math.max(1e-6,period))*Math.PI*2,waist=.24+.76*Math.abs(Math.cos(phase*.5));sx*=waist;sy*=waist;}
                leftX[i]=(p.x||0)+sx;leftY[i]=(p.y||0)+sy;rightX[i]=(p.x||0)-sx;rightY[i]=(p.y||0)-sy;
            }
            return{leftX,leftY,rightX,rightY,n,arcTotal};
        }
        function buildGraffitiVariableRibbon(path,width,type,baseAngle,nibRatio,nibShape,sizeStrength,sizeFocus,rotationTotal,rotationFocus,progressMeta=null,angleMode='absolute'){
            if(typeof Path2D==='undefined')return null;
            const sides=computeGraffitiVariableRibbonSides(path,width,type,baseAngle,nibRatio,nibShape,sizeStrength,sizeFocus,rotationTotal,rotationFocus,progressMeta,angleMode);if(!sides)return null;
            const {leftX,leftY,rightX,rightY,n}=sides,ribbon=new Path2D();
            ribbon.moveTo(leftX[0],leftY[0]);for(let i=1;i<n;i++)ribbon.lineTo(leftX[i],leftY[i]);
            for(let i=n-1;i>=0;i--)ribbon.lineTo(rightX[i],rightY[i]);ribbon.closePath();return ribbon;
        }
        function graffitiVariableRibbonKey(width,type,baseAngle,nibRatio,nibShape,sizeStrength,sizeFocus,rotationTotal,rotationFocus,progressMeta=null,angleMode='absolute'){
            const metaKey=progressMeta?`${progressMeta.mode||''}:${Number(progressMeta.start||0).toFixed(5)}:${Number(progressMeta.span||0).toFixed(5)}:${Number(progressMeta.minX||0).toFixed(3)}`:'-';
            return [Number(width).toFixed(3),type,angleMode==='relative'?'relative':'absolute',Number(baseAngle).toFixed(5),Number(nibRatio).toFixed(3),nibShape,Number(sizeStrength).toFixed(4),Number(sizeFocus).toFixed(4),Number(rotationTotal).toFixed(5),Number(rotationFocus).toFixed(4),metaKey].join('|');
        }
        function getCachedGraffitiVariableRibbon(path,width,type,baseAngle,nibRatio,nibShape,sizeStrength,sizeFocus,rotationTotal,rotationFocus,progressMeta=null,angleMode='absolute'){
            if(!path||typeof path!=='object')return buildGraffitiVariableRibbon(path,width,type,baseAngle,nibRatio,nibShape,sizeStrength,sizeFocus,rotationTotal,rotationFocus,progressMeta,angleMode);
            let bucket=graffitiVariableRibbonCache.get(path);if(!bucket){bucket=new Map();graffitiVariableRibbonCache.set(path,bucket);}
            const key=graffitiVariableRibbonKey(width,type,baseAngle,nibRatio,nibShape,sizeStrength,sizeFocus,rotationTotal,rotationFocus,progressMeta,angleMode);
            if(bucket.has(key)){graffitiVariableRibbonCacheStats.hits++;return bucket.get(key);}
            const ribbon=buildGraffitiVariableRibbon(path,width,type,baseAngle,nibRatio,nibShape,sizeStrength,sizeFocus,rotationTotal,rotationFocus,progressMeta,angleMode);
            if(bucket.size>4)bucket.clear();bucket.set(key,ribbon);graffitiVariableRibbonCacheStats.builds++;return ribbon;
        }
        // 7.0.13 Graffiti plain-nib GPU parity: when trajectory variations are truly off,
        // reproduce the legacy Canvas marker stroke in nib-space instead of averaging world-space
        // corner tangents.  The old averaged support made a straight square side taper from one
        // corner to the next even with Size/Rotation Variation disabled.  Canvas first maps the
        // path into nib space, strokes a constant-width line, then maps it back; this helper does
        // the same with segment quads and miter-limit-aware join fills.
        function buildGraffitiPlainPointedRibbonMesh(path,width,type,baseAngle,nibRatio,nibShape='pointed'){
            if(nibShape!=='pointed')return null;
            const pts=path?.points||[],n=pts.length;if(n<2)return null;
            const closed=path?.closed===true,segCount=closed?n:n-1;if(segCount<1)return null;
            const stretch=Math.max(1e-6,graffitiNibStretch(type,nibRatio,nibShape));
            const half=Math.max(.225,width*graffitiNibWidthFactor(type,nibShape)*.5),ca=Math.cos(baseAngle),sa=Math.sin(baseAngle),miterLimit=2.6;
            const dxNib=new Float64Array(segCount),dyNib=new Float64Array(segCount),offX=new Float64Array(segCount),offY=new Float64Array(segCount);
            const fromNibVec=(x,y)=>({x:ca*stretch*x-sa*y,y:sa*stretch*x+ca*y});
            for(let i=0;i<segCount;i++){
                const a=pts[i],b=pts[(i+1)%n],wx=(Number(b?.x)||0)-(Number(a?.x)||0),wy=(Number(b?.y)||0)-(Number(a?.y)||0);
                let nx=(ca*wx+sa*wy)/stretch,ny=-sa*wx+ca*wy,nl=Math.hypot(nx,ny);if(nl<1e-9){nx=1;ny=0;nl=1;}nx/=nl;ny/=nl;dxNib[i]=nx;dyNib[i]=ny;
                const o=fromNibVec(-ny*half,nx*half);offX[i]=o.x;offY[i]=o.y;
            }
            const joinCount=closed?n:Math.max(0,n-2),F=9,out=new Float32Array((segCount*6+joinCount*12)*F);let k=0;
            const put=(x,y,b0,b1,b2,m0,m1,m2,side)=>{out[k++]=x;out[k++]=y;out[k++]=b0;out[k++]=b1;out[k++]=b2;out[k++]=m0;out[k++]=m1;out[k++]=m2;out[k++]=side;};
            for(let i=0;i<segCount;i++){
                const j=(i+1)%n,p=pts[i],q=pts[j],ox=offX[i],oy=offY[i],startEdge=!closed&&i===0?1:0,endEdge=!closed&&i===segCount-1?1:0;
                const l0x=(Number(p?.x)||0)+ox,l0y=(Number(p?.y)||0)+oy,r0x=(Number(p?.x)||0)-ox,r0y=(Number(p?.y)||0)-oy,l1x=(Number(q?.x)||0)+ox,l1y=(Number(q?.y)||0)+oy,r1x=(Number(q?.x)||0)-ox,r1y=(Number(q?.y)||0)-oy;
                put(l0x,l0y,1,0,0,0,1,startEdge,-1);put(r0x,r0y,0,1,0,0,1,startEdge,1);put(l1x,l1y,0,0,1,0,1,startEdge,-1);
                put(l1x,l1y,1,0,0,1,endEdge,0,-1);put(r0x,r0y,0,1,0,1,endEdge,0,1);put(r1x,r1y,0,0,1,1,endEdge,0,1);
            }
            const first=closed?0:1,last=closed?n:n-1;
            for(let i=first;i<last;i++){
                const prevSeg=(i+segCount-1)%segCount,nextSeg=i%segCount,p=pts[i],px=Number(p?.x)||0,py=Number(p?.y)||0;
                const d0x=dxNib[prevSeg],d0y=dyNib[prevSeg],d1x=dxNib[nextSeg],d1y=dyNib[nextSeg];
                for(const side of [1,-1]){
                    const inX=offX[prevSeg]*side,inY=offY[prevSeg]*side,outX=offX[nextSeg]*side,outY=offY[nextSeg]*side;
                    const n0x=-d0y*side,n0y=d0x*side,n1x=-d1y*side,n1y=d1x*side,mx=n0x+n1x,my=n0y+n1y,ml=Math.hypot(mx,my);
                    let useMiter=false,mwX=0,mwY=0;
                    if(ml>1e-7){const mdx=mx/ml,mdy=my/ml,den=mdx*n1x+mdy*n1y;if(Math.abs(den)>1e-7){const mlen=half/den;if(Math.abs(mlen)/Math.max(1e-9,half)<=miterLimit){const mw=fromNibVec(mdx*mlen,mdy*mlen);mwX=mw.x;mwY=mw.y;useMiter=true;}}}
                    const renderSide=side>0?-1:1;
                    if(useMiter){
                        // Two triangles; only the two exterior in->miter and miter->out edges are AA.
                        put(px,py,1,0,0,1,0,0,0);put(px+inX,py+inY,0,1,0,1,0,0,renderSide);put(px+mwX,py+mwY,0,0,1,1,0,0,renderSide);
                        put(px,py,1,0,0,1,0,0,0);put(px+mwX,py+mwY,0,1,0,1,0,0,renderSide);put(px+outX,py+outY,0,0,1,1,0,0,renderSide);
                    }else{
                        // Canvas miterLimit fallback is bevel.  Segment-specific offsets keep
                        // the side width constant; this triangle closes the corner without taper.
                        put(px,py,1,0,0,1,0,0,0);put(px+inX,py+inY,0,1,0,1,0,0,renderSide);put(px+outX,py+outY,0,0,1,1,0,0,renderSide);
                    }
                }
            }
            return k===out.length?out:out.subarray(0,k);
        }
        function buildGraffitiVariableRibbonMesh(path,width,type,baseAngle,nibRatio,nibShape,sizeStrength,sizeFocus,rotationTotal,rotationFocus,progressMeta=null,angleMode='absolute'){
            // A zero/off variation must be geometrically neutral, not merely numerically zero.
            // For the default pointed absolute nib, use the exact constant-width nib-space stroke.
            if(nibShape==='pointed'&&angleMode!=='relative'&&Math.abs(Number(sizeStrength)||0)<=1e-9&&Math.abs(Number(rotationTotal)||0)<=1e-9){
                const plain=buildGraffitiPlainPointedRibbonMesh(path,width,type,baseAngle,nibRatio,nibShape);if(plain)return plain;
            }
            const sides=computeGraffitiVariableRibbonSides(path,width,type,baseAngle,nibRatio,nibShape,sizeStrength,sizeFocus,rotationTotal,rotationFocus,progressMeta,angleMode);if(!sides)return null;
            const {leftX,leftY,rightX,rightY,n}=sides;if(n<2)return null;
            // Stable-width base ribbon + explicit corner wedge fills.  This preserves a
            // constant authored nib scale when Size Variation is off, while covering the
            // triangular hole that appears at sharp 45° marker turns.
            const pts=path?.points||[],closed=path?.closed===true,segCount=closed?n:n-1,F=9;
            const joinCount=nibShape==='pointed'?(closed?n:Math.max(0,n-2)):0;
            const out=new Float32Array((segCount*6+joinCount*6)*F);let k=0;
            const put=(x,y,b0,b1,b2,m0,m1,m2,side)=>{out[k++]=x;out[k++]=y;out[k++]=b0;out[k++]=b1;out[k++]=b2;out[k++]=m0;out[k++]=m1;out[k++]=m2;out[k++]=side;};
            for(let i=0;i<segCount;i++){
                const j=(i+1)%n,startEdge=!closed&&i===0?1:0,endEdge=!closed&&i===segCount-1?1:0;
                const l0x=leftX[i],l0y=leftY[i],r0x=rightX[i],r0y=rightY[i],l1x=leftX[j],l1y=leftY[j],r1x=rightX[j],r1y=rightY[j];
                put(l0x,l0y,1,0,0,0,1,startEdge,-1);put(r0x,r0y,0,1,0,0,1,startEdge,1);put(l1x,l1y,0,0,1,0,1,startEdge,-1);
                put(l1x,l1y,1,0,0,1,endEdge,0,-1);put(r0x,r0y,0,1,0,1,endEdge,0,1);put(r1x,r1y,0,0,1,1,endEdge,0,1);
            }
            if(joinCount){
                const arc=new Float64Array(n);let total=0;for(let i=1;i<n;i++){const a=pts[i-1],b=pts[i];total+=Math.hypot((b.x||0)-(a.x||0),(b.y||0)-(a.y||0));arc[i]=total;}const inv=total>1e-6?1/total:0;
                const stretch=graffitiNibStretch(type,nibRatio,nibShape),baseHalf=Math.max(.225,width*graffitiNibWidthFactor(type,nibShape)*.5);
                const first=closed?0:1,last=closed?n:n-1;
                for(let i=first;i<last;i++){
                    const p=pts[i],prev=pts[(i+n-1)%n],next=pts[(i+1)%n];let ix=(p.x||0)-(prev.x||0),iy=(p.y||0)-(prev.y||0),il=Math.hypot(ix,iy);let ox=(next.x||0)-(p.x||0),oy=(next.y||0)-(p.y||0),ol=Math.hypot(ox,oy);if(il<1e-6||ol<1e-6)continue;ix/=il;iy/=il;ox/=ol;oy/=ol;
                    let tx=ix+ox,ty=iy+oy,tl=Math.hypot(tx,ty);if(tl<1e-6){tx=ox;ty=oy;tl=1;}tx/=tl;ty/=tl;
                    const localT=inv?arc[i]*inv:0,t=resolveGraffitiVariationProgress(p,localT,progressMeta),d=graffitiFocusDistance(t,sizeFocus),sizeFactor=Math.max(0,1-sizeStrength*(1-Math.max(0,Math.min(1,d))));
                    const rotation=rotationTotal*graffitiRotationProgress(t,rotationFocus),inAngle=(angleMode==='relative'?Math.atan2(iy,ix):0)+baseAngle+rotation,outAngle=(angleMode==='relative'?Math.atan2(oy,ox):0)+baseAngle+rotation;
                    let sIn=graffitiSupportOffset(-iy,ix,inAngle,stretch,baseHalf*sizeFactor),sOut=graffitiSupportOffset(-oy,ox,outAngle,stretch,baseHalf*sizeFactor);
                    if(nibShape==='pinched'){continue;}
                    // Left/negative-side wedge: only the outside support-to-support edge is AA.
                    put(p.x||0,p.y||0,1,0,0,0,0,0,0);put((p.x||0)+sIn.x,(p.y||0)+sIn.y,0,1,0,0,0,0,-1);put((p.x||0)+sOut.x,(p.y||0)+sOut.y,0,0,1,1,0,0,-1);
                    // Right/positive-side wedge.
                    put(p.x||0,p.y||0,1,0,0,0,0,0,0);put((p.x||0)-sOut.x,(p.y||0)-sOut.y,0,1,0,0,0,0,1);put((p.x||0)-sIn.x,(p.y||0)-sIn.y,0,0,1,1,0,0,1);
                }
            }
            return k===out.length?out:out.subarray(0,k);
        }
        function buildGraffitiVariableRibbonBridgeMesh(prevItem,nextItem,width,type,baseAngle,nibRatio,nibShape,sizeStrength,sizeFocus,rotationTotal,rotationFocus,angleMode='absolute'){
            if(nibShape!=='pointed'||prevItem?.chain==null||prevItem.chain!==nextItem?.chain)return null;
            const aa=prevItem?.path?.points||[],bb=nextItem?.path?.points||[];if(aa.length<2||bb.length<2)return null;
            const p=aa[aa.length-1],q=bb[0];if(Math.hypot((p.x||0)-(q.x||0),(p.y||0)-(q.y||0))>.05)return null;
            const pa=aa[aa.length-2],qb=bb[1];let ix=(p.x||0)-(pa.x||0),iy=(p.y||0)-(pa.y||0),il=Math.hypot(ix,iy),ox=(qb.x||0)-(q.x||0),oy=(qb.y||0)-(q.y||0),ol=Math.hypot(ox,oy);if(il<1e-6||ol<1e-6)return null;ix/=il;iy/=il;ox/=ol;oy/=ol;
            const stretch=graffitiNibStretch(type,nibRatio,nibShape),baseHalf=Math.max(.225,width*graffitiNibWidthFactor(type,nibShape)*.5);
            const endpointStyle=(point,localT,meta,tx,ty)=>{const t=resolveGraffitiVariationProgress(point,localT,meta),d=graffitiFocusDistance(t,sizeFocus),sizeFactor=Math.max(0,1-sizeStrength*(1-Math.max(0,Math.min(1,d)))),rotation=rotationTotal*graffitiRotationProgress(t,rotationFocus),angle=(angleMode==='relative'?Math.atan2(ty,tx):0)+baseAngle+rotation;return{angle,half:baseHalf*sizeFactor};};
            const aStyle=endpointStyle(p,1,prevItem.meta,ix,iy),bStyle=endpointStyle(q,0,nextItem.meta,ox,oy),sIn=graffitiSupportOffset(-iy,ix,aStyle.angle,stretch,aStyle.half),sOut=graffitiSupportOffset(-oy,ox,bStyle.angle,stretch,bStyle.half);
            const F=9,out=new Float32Array(6*F);let k=0,px=(Number(p.x)||0),py=(Number(p.y)||0);const put=(x,y,b0,b1,b2,m0,m1,m2,side)=>{out[k++]=x;out[k++]=y;out[k++]=b0;out[k++]=b1;out[k++]=b2;out[k++]=m0;out[k++]=m1;out[k++]=m2;out[k++]=side;};
            put(px,py,1,0,0,0,0,0,0);put(px+sIn.x,py+sIn.y,0,1,0,0,0,0,-1);put(px+sOut.x,py+sOut.y,0,0,1,1,0,0,-1);
            put(px,py,1,0,0,0,0,0,0);put(px-sOut.x,py-sOut.y,0,1,0,0,0,0,1);put(px-sIn.x,py-sIn.y,0,0,1,1,0,0,1);return out;
        }
        function getCachedGraffitiVariableRibbonMesh(path,width,type,baseAngle,nibRatio,nibShape,sizeStrength,sizeFocus,rotationTotal,rotationFocus,progressMeta=null,angleMode='absolute'){
            if(!path||typeof path!=='object')return buildGraffitiVariableRibbonMesh(path,width,type,baseAngle,nibRatio,nibShape,sizeStrength,sizeFocus,rotationTotal,rotationFocus,progressMeta,angleMode);
            let bucket=graffitiVariableRibbonMeshCache.get(path);if(!bucket){bucket=new Map();graffitiVariableRibbonMeshCache.set(path,bucket);}
            const key=graffitiVariableRibbonKey(width,type,baseAngle,nibRatio,nibShape,sizeStrength,sizeFocus,rotationTotal,rotationFocus,progressMeta,angleMode);
            if(bucket.has(key)){graffitiVariableRibbonMeshCacheStats.hits++;return bucket.get(key);}
            const mesh=buildGraffitiVariableRibbonMesh(path,width,type,baseAngle,nibRatio,nibShape,sizeStrength,sizeFocus,rotationTotal,rotationFocus,progressMeta,angleMode);
            if(bucket.size>4)bucket.clear();bucket.set(key,mesh);graffitiVariableRibbonMeshCacheStats.builds++;graffitiVariableRibbonMeshCacheStats.vertices+=mesh?mesh.length/9:0;return mesh;
        }
        function drawGraffitiVariableRibbon(ctx,path,layer,width,alpha,color,glow,glowIntensity,nibRatio,nibShape,markerAngle,progressMeta=null,forceRibbon=false){
            const sizeValue=Math.max(0,Number(layer.graffitiSizeVariation)||0),rawRotMul=Number(layer.graffitiRotationMultiplier),rotMul=Math.max(0,Number.isFinite(rawRotMul)?rawRotMul:1),rotValue=Math.max(0,Number(layer.graffitiRotationVariation)||0);
            const sizeOn=layer.graffitiSizeVariationEnabled===true&&sizeValue>0,rotOn=layer.graffitiRotationVariationEnabled===true&&rotValue*rotMul>0;
            if(!sizeOn&&!rotOn&&!forceRibbon)return false;
            const sizeStrength=sizeOn?Math.max(0,Math.min(1,sizeValue/100)):0;
            const rawSizeFocus=Number(layer.graffitiSizeFocus),sizeFocus=Math.max(0,Math.min(1,(Number.isFinite(rawSizeFocus)?rawSizeFocus:50)/100));
            const rotDeg=rotOn?rotValue*rotMul:0;
            const rawRotFocus=Number(layer.graffitiRotationFocus),rotFocus=Math.max(0,Math.min(1,(Number.isFinite(rawRotFocus)?rawRotFocus:50)/100));
            const angleMode=layer?.graffitiAngleMode==='relative'?'relative':'absolute';
            const ribbon=getCachedGraffitiVariableRibbon(path,width,normalizeLineProfileValue(layer?.lineProfileGraffiti,'slash'),markerAngle,nibRatio,nibShape,sizeStrength,sizeFocus,rotDeg*Math.PI/180,rotFocus,progressMeta,angleMode);
            if(!ribbon)return false;
            ctx.save();ctx.fillStyle=color;
            if(glow>0&&glowIntensity>0){
                ctx.save();ctx.globalAlpha=Math.min(1,alpha*(.22+.24*glowIntensity));ctx.shadowColor=color;
                ctx.shadowBlur=Math.max(.5,glow*.55*glowIntensity);ctx.fill(ribbon);ctx.restore();
            }
            ctx.globalAlpha=Math.min(1,alpha);ctx.shadowBlur=0;ctx.fill(ribbon);ctx.restore();
            return true;
        }
        function sampleGraffitiRange(table,start,length){
            if(!table||!(table.total>0)||!(length>1e-6))return null;
            const count=Math.max(8,Math.min(220,Math.ceil(length/3)));
            const pts=[];
            for(let i=0;i<=count;i++){
                const d=Math.max(0,Math.min(table.total-1e-7,start+length*(i/count)));
                const p=pointAtPathDistance(table,d);
                if(!pts.length||Math.hypot(p.x-pts[pts.length-1].x,p.y-pts[pts.length-1].y)>1e-6)pts.push(p);
            }
            return pts.length>1?{points:pts,closed:false}:null;
        }
        function getGraffitiVariationMode(layer){
            const mode=layer?.graffitiVariationMode;
            return ['perSegment','everyNth','across','perPath','whole'].includes(mode)?mode:'perSegment';
        }
        function buildGraffitiVariationPlan(paths,layer){
            const mode=getGraffitiVariationMode(layer),plan=[];
            if(mode==='perSegment'||mode==='everyNth'){
                const groupN=Math.max(1,Math.min(24,Math.round(Number(layer?.graffitiVariationEveryN)||2)));
                let chain=0;for(const path of paths||[]){
                    const chainId=chain++;const {table,segments}=getSweepSegmentsForPath(path,layer);
                    if(!segments.length)continue;
                    if(mode==='perSegment'){
                        for(const seg of segments){
                            const piece=sampleGraffitiRange(table,seg.start,seg.length);
                            if(piece)plan.push({path:piece,vary:true,meta:null,chain:chainId});
                        }
                    }else{
                        for(let i=0;i<segments.length;i+=groupN){
                            const count=Math.min(groupN,segments.length-i);
                            const start=segments[i].start;
                            const end=segments[i+count-1].start+segments[i+count-1].length;
                            const piece=sampleGraffitiRange(table,start,end-start);
                            // An incomplete tail never receives a partial variation cycle.
                            if(piece)plan.push({path:piece,vary:count===groupN,meta:null,chain:chainId});
                        }
                    }
                }
                return plan;
            }
            if(mode==='across'){
                let minX=Infinity,maxX=-Infinity;
                for(const path of paths||[])for(const p of path?.points||[]){if(Number.isFinite(p?.x)){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);}}
                const span=Math.max(1e-6,maxX-minX);
                for(const path of paths||[]){
                    const table=buildPathLengthTable([path]);if(!(table.total>0))continue;
                    const piece=sampleGraffitiRange(table,0,table.total);
                    if(piece)plan.push({path:piece,vary:true,meta:{mode:'across',minX,span}});
                }
                return plan;
            }
            if(mode==='whole'){
                const infos=[];let total=0;
                for(const path of paths||[]){const table=buildPathLengthTable([path]);if(table.total>0){infos.push({table,start:total});total+=table.total;}}
                if(!(total>0))return plan;
                for(const info of infos){
                    const piece=sampleGraffitiRange(info.table,0,info.table.total);
                    if(piece)plan.push({path:piece,vary:true,meta:{mode:'global',start:info.start/total,span:info.table.total/total}});
                }
                return plan;
            }
            // perPath: one complete variation cycle for each contour.
            for(const path of paths||[]){
                const table=buildPathLengthTable([path]);if(!(table.total>0))continue;
                const piece=sampleGraffitiRange(table,0,table.total);
                if(piece)plan.push({path:piece,vary:true,meta:null});
            }
            return plan;
        }
        function getCachedGraffitiVariationPlan(paths,layer){
            if(!Array.isArray(paths)||!paths.length)return [];
            if(isCurrentFrameDynamicPathList(paths))return buildGraffitiVariationPlan(paths,layer);
            let variants=persistentGraffitiPlanCache.get(paths);
            if(!variants){variants=new Map();persistentGraffitiPlanCache.set(paths,variants);}
            const mode=getGraffitiVariationMode(layer);
            const groupN=Math.max(1,Math.min(24,Math.round(Number(layer?.graffitiVariationEveryN)||2)));
            const N=Math.max(2,Math.round(Number(layer?.N)||2));
            const K=Math.max(1,Math.round(Number(layer?.K)||1));
            const key=`${mode}|${groupN}|${N}|${K}`;
            let plan=variants.get(key);
            if(!plan){plan=buildGraffitiVariationPlan(paths,layer);variants.set(key,plan);}
            return plan;
        }
        function prepareLayerFrameProfileData(frameCtx){
            if(!frameCtx)return null;
            if(frameCtx.profilePreparedReady)return frameCtx.profilePrepared;
            const layer=frameCtx.layer,paths=getLayerFrameAuxiliaryPaths(frameCtx),rounded=getLayerFrameRoundedPaths(frameCtx);
            let data=frameCtx.profileData;
            if(!data)data=frameCtx.profileData={};
            const application=['stroke','graffiti'].includes(layer?.lineProfileApplication)?layer.lineProfileApplication:'stroke';
            const lineType=normalizeLineProfileValue(layer?.lineProfileStroke ?? layer?.lineProfile,'round');
            const graffitiType=normalizeLineProfileValue(layer?.lineProfileGraffiti,'slash');
            const type=application==='graffiti'?graffitiType:lineType;
            data.paths=paths;data.rounded=rounded;data.type=type;data.application=application;data.table=null;data.graffitiPlan=null;data.gpuRibbonEligible=false;
            const profileBaseW=Math.max(.001,(Number(layer?.strokeWidth)||1.5)*getLayerStrokeWidthMultiplier(layer));data.w=(application==='stroke'&&type!=='round')?profileBaseW*4:profileBaseW;data.spacing=0;data.count=0;data.variationOn=false;
            if(application==='graffiti'){
                data.variationOn=(layer?.graffitiSizeVariationEnabled===true&&Math.max(0,Number(layer?.graffitiSizeVariation)||0)>0)||(layer?.graffitiRotationVariationEnabled===true&&Math.max(0,Number(layer?.graffitiRotationVariation)||0)*Math.max(0,Number.isFinite(Number(layer?.graffitiRotationMultiplier))?Number(layer.graffitiRotationMultiplier):1)>0);
                if(data.variationOn)data.graffitiPlan=getCachedGraffitiVariationPlan(rounded,layer);
                else{
                    // v437: the Waist nib changes width *along* the path, so a four-vertex
                    // polygon is not enough to describe it. Densify only this nib; all other
                    // Graffiti stamps keep the cheap original contour plan.
                    const pinched=layer?.graffitiNibShape==='pinched';
                    const plan=data.plainGpuPlan||(data.plainGpuPlan=[]),pool=data.plainGpuPlanPool||(data.plainGpuPlanPool=[]);plan.length=0;
                    for(let i=0;i<rounded.length;i++){
                        let path=rounded[i];
                        if(pinched){const table=buildPathLengthTable([path]);const sampled=table?.total>0?sampleGraffitiRange(table,0,table.total):null;if(sampled){sampled.closed=path?.closed===true;path=sampled;}}
                        let item=pool[i];if(!item)item=pool[i]={path:null,vary:true,meta:null};item.path=path;item.vary=true;item.meta=null;plan.push(item);
                    }
                    data.graffitiPlan=plan;
                }
                data.gpuRibbonEligible=Array.isArray(data.graffitiPlan)&&data.graffitiPlan.length>0;
            }else if(type!=='round'){
                const table=getLayerFramePathTable(frameCtx,true);data.table=table;
                data.spacing=Math.max(2.4,data.w*(type==='slash'?1.85:1.55));
                data.count=table?.total>0?Math.min(1800,Math.floor(table.total/data.spacing)):0;
            }
            frameCtx.profilePrepared=data;frameCtx.profilePreparedReady=true;
            return data;
        }

        function drawGraffitiMarker(ctx,paths,layer,alpha=1,prepared=null,outerStateIsolated=false){
            if(!paths?.length||alpha<=.001)return;
            const rounded=prepared?.rounded||prepareWebVisiblePaths(paths,layer);
            const w=Math.max(.001,(Number(layer.strokeWidth)||1.5)*getLayerStrokeWidthMultiplier(layer));
            const type=['round','slash','square'].includes(layer?.lineProfileGraffiti)?layer.lineProfileGraffiti:'slash';
            const nibShape=['pointed','blunt','pinched','round'].includes(layer?.graffitiNibShape)?layer.graffitiNibShape:'pointed';
            const nibBase=Math.max(1,Math.min(20,Number(layer?.graffitiNibLength)||10));
            const nibMultiplier=Math.max(.01,Number.isFinite(Number(layer?.graffitiNibLengthMultiplier))?Number(layer.graffitiNibLengthMultiplier):1);
            const nibRatio=nibBase*nibMultiplier;
            const rawMarkerAngle=Number(layer?.graffitiAngle);
            const markerAngle=Math.max(-90,Math.min(90,Number.isFinite(rawMarkerAngle)?rawMarkerAngle:45))*Math.PI/180;
            const color=layer.strokeColor||'#ffffff';
            const glow=Math.max(0,(Number(layer.glow)||0)*getLayerGlowMultiplier(layer));
            const glowIntensity=Math.max(0,((Number.isFinite(Number(layer.glowIntensity))?Number(layer.glowIntensity):40)/100)*getLayerGlowIntensityMultiplier(layer));
            const variationOn=prepared?.application==='graffiti' ? prepared.variationOn===true : ((layer.graffitiSizeVariationEnabled===true&&Math.max(0,Number(layer.graffitiSizeVariation)||0)>0)||(layer.graffitiRotationVariationEnabled===true&&Math.max(0,Number(layer.graffitiRotationVariation)||0)*Math.max(0,Number.isFinite(Number(layer.graffitiRotationMultiplier))?Number(layer.graffitiRotationMultiplier):1)>0));
            const angleMode=layer?.graffitiAngleMode==='relative'?'relative':'absolute';
            if(!outerStateIsolated)ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.shadowBlur=0;

            const drawPlain=(path)=>{
                if(angleMode==='relative'&&drawGraffitiVariableRibbon(ctx,path,layer,w,alpha,color,glow,glowIntensity,nibRatio,nibShape,markerAngle,null,true))return;
                const p2d=getGraffitiNibPath(path,type,markerAngle,nibRatio,nibShape);
                if(p2d){strokeGraffitiNibPath(ctx,p2d,type,markerAngle,w,alpha,glow,glowIntensity,nibRatio,nibShape);return;}
                const pts=path?.points||[];if(pts.length<2)return;
                ctx.save();ctx.globalAlpha=Math.max(0,Math.min(1,alpha));ctx.lineWidth=w;
                ctx.lineJoin=nibShape==='pointed'?'miter':nibShape==='blunt'?'bevel':'round';
                ctx.lineCap=nibShape==='blunt'?'butt':'round';ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
                for(let j=1;j<pts.length;j++)ctx.lineTo(pts[j].x,pts[j].y);
                if(path.closed)ctx.closePath();ctx.stroke();ctx.restore();
            };

            if(!variationOn){
                for(const path of rounded)drawPlain(path);
                if(!outerStateIsolated)ctx.restore();return;
            }

            const plan=(prepared?.application==='graffiti'&&prepared.graffitiPlan)?prepared.graffitiPlan:buildGraffitiVariationPlan(rounded,layer);
            if(!plan.length){
                for(const path of rounded)drawPlain(path);
                if(!outerStateIsolated)ctx.restore();return;
            }
            for(const item of plan){
                if(item.vary){
                    if(!drawGraffitiVariableRibbon(ctx,item.path,layer,w,alpha,color,glow,glowIntensity,nibRatio,nibShape,markerAngle,item.meta))drawPlain(item.path);
                }else{
                    drawPlain(item.path);
                }
            }
            if(!outerStateIsolated)ctx.restore();
        }
        // v136: isolated Graffiti Worker module.
        // v340: raster Graffiti is the default fast path; exact vector Graffiti remains the fallback.
        const GraffitiWorker = (() => {
        // v135: Graffiti OffscreenCanvas/Worker pipeline.
        // The worker receives the already-rounded contour, so v92 morph rounding remains
        // authoritative on the main thread. It rasterizes the expensive calligraphic nib
        // off-thread and returns an ImageBitmap; the main renderer only composites it.
        // Variable-profile Graffiti deliberately stays on the synchronous vector path for
        // now because its per-range taper/rotation semantics must remain bit-for-bit stable.
        const graffitiOffscreenRuntime={
            worker:null,disabled:false,seq:0,jobs:new Map(),records:new WeakMap(),activeRecords:new Set(),
            stats:{submitted:0,completed:0,used:0,fallback:0,droppedBusy:0,errors:0,lastLatencyMs:0,clears:0}
        };
        const GRAFFITI_WORKER_SOURCE=String.raw`
self.onmessage=function(ev){
    const d=ev.data||{};
    if(d.type!=='render')return;
    const started=performance.now();
    try{
        const coords=new Float32Array(d.coordsBuffer);
        const counts=d.counts||[],closed=d.closed||[],s=d.style||{};
        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,total=0;
        for(let pi=0;pi<counts.length;pi++){
            const count=counts[pi]|0;
            for(let j=0;j<count;j++){
                const x=coords[(total+j)*2],y=coords[(total+j)*2+1];
                if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
            }
            total+=count;
        }
        if(!Number.isFinite(minX)||total<2){
            self.postMessage({type:'result',id:d.id,key:d.key,styleKey:d.styleKey,frameId:d.frameId,empty:true,coordsBuffer:d.coordsBuffer,latencyMs:performance.now()-started},[d.coordsBuffer]);
            return;
        }
        const width=Math.max(.45,Number(s.width)||1.5),ratio=Math.max(.01,Number(s.nibRatio)||3),glow=Math.max(0,Number(s.glow)||0);
        const shape=s.nibShape||'pointed',type=s.profileType||'slash';
        let stretch=1;
        if(type==='slash'){
            if(shape==='round')stretch=Math.max(1,ratio*.72);
            else if(shape==='blunt')stretch=Math.max(1,ratio*.92);
            else if(shape==='pinched')stretch=1;
            else stretch=ratio;
        }
        let widthFactor=type==='square'?1.04:1;
        if(shape==='round')widthFactor*=1.06;else if(shape==='blunt')widthFactor*=.96;
        const nibWidth=Math.max(.45,width*widthFactor);
        const pinchedSpan=shape==='pinched'?Math.max(0,nibWidth*(ratio-1)):0;
        const pad=Math.ceil(Math.max(8,nibWidth*stretch*1.35+pinchedSpan*.65+glow*1.35+6));
        minX=Math.floor(minX-pad);minY=Math.floor(minY-pad);maxX=Math.ceil(maxX+pad);maxY=Math.ceil(maxY+pad);
        const logicalW=Math.max(2,maxX-minX),logicalH=Math.max(2,maxY-minY);
        let rs=Math.max(1,Math.min(3.25,Number(d.rasterScale)||1));
        const maxPixels=8400000;
        if(logicalW*logicalH*rs*rs>maxPixels)rs=Math.max(1,Math.sqrt(maxPixels/(logicalW*logicalH)));
        const pixelW=Math.max(2,Math.ceil(logicalW*rs)),pixelH=Math.max(2,Math.ceil(logicalH*rs));
        if(pixelW>8192||pixelH>8192){
            self.postMessage({type:'result',id:d.id,key:d.key,styleKey:d.styleKey,frameId:d.frameId,tooLarge:true,coordsBuffer:d.coordsBuffer,latencyMs:performance.now()-started},[d.coordsBuffer]);
            return;
        }
        const canvas=new OffscreenCanvas(pixelW,pixelH);
        const ctx=canvas.getContext('2d',{alpha:true,desynchronized:true});
        if(!ctx)throw new Error('OffscreenCanvas 2D unavailable');
        ctx.scale(rs,rs);ctx.translate(-minX,-minY);
        ctx.strokeStyle=s.color||'#ffffff';ctx.fillStyle=s.color||'#ffffff';ctx.shadowBlur=0;ctx.setLineDash([]);
        const ang=Number(s.markerAngle)||0,c=Math.cos(ang),q=Math.sin(ang),glowIntensity=Math.max(0,Math.min(2,Number(s.glowIntensity)||0));
        let cursor=0;
        for(let pi=0;pi<counts.length;pi++){
            const count=counts[pi]|0;if(count<2){cursor+=Math.max(0,count);continue;}
            ctx.save();ctx.transform(c*stretch,q*stretch,-q,c,0,0);ctx.beginPath();
            for(let j=0;j<count;j++){
                const x=coords[(cursor+j)*2],y=coords[(cursor+j)*2+1];
                const nx=(c*x+q*y)/stretch,ny=-q*x+c*y;
                if(j===0)ctx.moveTo(nx,ny);else ctx.lineTo(nx,ny);
            }
            if(closed[pi])ctx.closePath();
            if(shape==='pinched'){
                ctx.lineJoin='round';ctx.lineCap='round';ctx.miterLimit=2.6;
                const samples=Math.max(9,Math.min(17,Math.ceil(ratio*1.5)+7));
                const paint=function(passAlpha,shadow){
                    if(passAlpha<=.001)return;
                    for(let lane=0;lane<samples;lane++){
                        const u=samples<=1?0:(lane/(samples-1))*2-1;
                        const wf=.46+.54*Math.pow(Math.abs(u),1.15);
                        ctx.save();ctx.translate(u*pinchedSpan*.5,0);ctx.lineWidth=Math.max(.28,nibWidth*wf);
                        ctx.globalAlpha=Math.max(0,Math.min(1,passAlpha));ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=Math.max(0,shadow);ctx.stroke();ctx.restore();
                    }
                };
                if(glow>0&&glowIntensity>0)paint(.22+.24*glowIntensity,Math.max(.5,glow*.55*glowIntensity));
                paint(1,0);
            }else{
                if(shape==='pointed'){ctx.lineJoin='miter';ctx.miterLimit=2.6;ctx.lineCap='butt';}
                else if(shape==='blunt'){ctx.lineJoin='bevel';ctx.lineCap='butt';}
                else{ctx.lineJoin='round';ctx.lineCap='round';}
                if(type==='square'){ctx.lineJoin='bevel';if(shape!=='round')ctx.lineCap='square';}
                ctx.lineWidth=nibWidth;
                if(glow>0&&glowIntensity>0){ctx.save();ctx.globalAlpha=Math.max(0,Math.min(1,.22+.24*glowIntensity));ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=Math.max(.5,glow*.55*glowIntensity);ctx.stroke();ctx.restore();}
                ctx.globalAlpha=1;ctx.shadowBlur=0;ctx.stroke();
            }
            ctx.restore();cursor+=count;
        }
        const bitmap=canvas.transferToImageBitmap();
        self.postMessage({type:'result',id:d.id,key:d.key,styleKey:d.styleKey,frameId:d.frameId,bitmap:bitmap,x:minX,y:minY,w:logicalW,h:logicalH,coordsBuffer:d.coordsBuffer,latencyMs:performance.now()-started},[bitmap,d.coordsBuffer]);
    }catch(err){
        try{self.postMessage({type:'error',id:d.id,message:String(err&&err.message||err),coordsBuffer:d.coordsBuffer},d.coordsBuffer?[d.coordsBuffer]:[]);}catch(_e){}
    }
};`;
        function ensureGraffitiOffscreenWorker(){
            if(/OPR\//.test(navigator.userAgent||'')){graffitiOffscreenRuntime.disabled=true;return null;}
            if(graffitiOffscreenRuntime.disabled)return null;
            if(graffitiOffscreenRuntime.worker)return graffitiOffscreenRuntime.worker;
            if(typeof Worker==='undefined'||typeof Blob==='undefined'||typeof URL==='undefined'||typeof OffscreenCanvas==='undefined'){
                graffitiOffscreenRuntime.disabled=true;return null;
            }
            try{
                const url=URL.createObjectURL(new Blob([GRAFFITI_WORKER_SOURCE],{type:'application/javascript'}));
                const worker=new Worker(url);URL.revokeObjectURL(url);
                worker.onmessage=(ev)=>{
                    const d=ev.data||{},rec=graffitiOffscreenRuntime.jobs.get(d.id);
                    if(!rec)return;
                    graffitiOffscreenRuntime.jobs.delete(d.id);rec.busy=false;
                    if(d.coordsBuffer instanceof ArrayBuffer)rec.returnedBuffer=d.coordsBuffer;
                    if(d.type==='error'){graffitiOffscreenRuntime.stats.errors++;rec.error=true;requestMainCanvasRender();return;}
                    if(state.graffitiRasterized!==true){
                        if(d.bitmap&&typeof d.bitmap.close==='function')try{d.bitmap.close();}catch(_e){}
                        rec.error=false;rec.tooLarge=false;return;
                    }
                    if(rec.previousBitmap&&typeof rec.previousBitmap.close==='function')try{rec.previousBitmap.close();}catch(_e){}
                    rec.previousBitmap=rec.bitmap||null;
                    if(rec.gpuTexture){try{rec.gpuTexture.destroy?.();}catch(_e){}rec.gpuTexture=null;rec.gpuBitmap=null;rec.gpuGeneration=0;}
                    rec.bitmap=d.bitmap||null;rec.bitmapKey=d.key||'';rec.bitmapStyleKey=d.styleKey||'';rec.resultFrameId=Number(d.frameId)||0;rec.resultAt=performance.now();
                    rec.x=Number(d.x)||0;rec.y=Number(d.y)||0;rec.w=Number(d.w)||0;rec.h=Number(d.h)||0;
                    rec.tooLarge=d.tooLarge===true;rec.error=false;
                    graffitiOffscreenRuntime.stats.completed++;graffitiOffscreenRuntime.stats.lastLatencyMs=Number(d.latencyMs)||0;
                    // Continuous animations already own the next paint. Avoid injecting
                    // an extra worker-completion paint into the same Morph/Tunnel frame.
                    // Static scenes still need one invalidation to display the bitmap.
                    const sched=animationScheduler.stats();if(!(sched?.activeTasks>0))requestMainCanvasRender();
                };
                worker.onerror=()=>{graffitiOffscreenRuntime.stats.errors++;graffitiOffscreenRuntime.disabled=true;try{worker.terminate();}catch(_e){}graffitiOffscreenRuntime.worker=null;};
                graffitiOffscreenRuntime.worker=worker;return worker;
            }catch(_e){graffitiOffscreenRuntime.disabled=true;graffitiOffscreenRuntime.stats.errors++;return null;}
        }
        function getGraffitiOffscreenRecord(layer,variant='base'){
            let map=graffitiOffscreenRuntime.records.get(layer);
            if(!map){map=new Map();graffitiOffscreenRuntime.records.set(layer,map);}
            let rec=map.get(variant);
            if(!rec){rec={bitmap:null,previousBitmap:null,bitmapKey:'',bitmapStyleKey:'',wantedKey:'',busy:false,resultFrameId:-1,resultAt:0,returnedBuffer:null,x:0,y:0,w:0,h:0,tooLarge:false,error:false,gpuTexture:null,gpuBitmap:null,gpuGeneration:0};map.set(variant,rec);graffitiOffscreenRuntime.activeRecords.add(rec);}
            return rec;
        }
        function setGraffitiRasterEnabled(enabled){
            if(enabled===true)return true;
            const rt=graffitiOffscreenRuntime;
            if(rt.worker){try{rt.worker.terminate();}catch(_e){}rt.worker=null;}
            rt.jobs.clear();
            for(const rec of rt.activeRecords){
                if(rec.bitmap&&typeof rec.bitmap.close==='function')try{rec.bitmap.close();}catch(_e){}
                if(rec.previousBitmap&&typeof rec.previousBitmap.close==='function')try{rec.previousBitmap.close();}catch(_e){}
                if(rec.gpuTexture){try{rec.gpuTexture.destroy?.();}catch(_e){}}
                rec.bitmap=null;rec.previousBitmap=null;rec.gpuTexture=null;rec.gpuBitmap=null;rec.gpuGeneration=0;rec.bitmapKey='';rec.bitmapStyleKey='';rec.wantedKey='';rec.busy=false;rec.returnedBuffer=null;rec.tooLarge=false;rec.error=false;rec.resultFrameId=-1;rec.resultAt=0;
            }
            rt.stats.clears++;
            return false;
        }
        function graffitiRasterStyle(layer,override=null){
            const o=override||{};
            const type=['round','slash','square'].includes(layer?.lineProfileGraffiti)?layer.lineProfileGraffiti:'slash';
            const nibShape=['pointed','blunt','pinched','round'].includes(layer?.graffitiNibShape)?layer.graffitiNibShape:'pointed';
            const nibBase=Math.max(1,Math.min(20,Number(layer?.graffitiNibLength)||10));
            const nibMultiplier=Math.max(.01,Number.isFinite(Number(layer?.graffitiNibLengthMultiplier))?Number(layer.graffitiNibLengthMultiplier):1);
            const rawAngle=Number(layer?.graffitiAngle);
            return {profileType:type,nibShape,nibRatio:nibBase*nibMultiplier,markerAngle:Math.max(-90,Math.min(90,Number.isFinite(rawAngle)?rawAngle:45))*Math.PI/180,width:Math.max(.001,Number(o.width??((Number(layer?.strokeWidth)||1.5)*getLayerStrokeWidthMultiplier(layer)))||1.5),color:String(o.color??layer?.strokeColor??'#ffffff'),glow:Math.max(0,Number(o.glow??((Number(layer?.glow)||0)*getLayerGlowMultiplier(layer)))||0),glowIntensity:Math.max(0,(Number.isFinite(Number(o.glowIntensity))?Number(o.glowIntensity):((Number.isFinite(Number(layer?.glowIntensity))?Number(layer.glowIntensity):40)/100)*getLayerGlowIntensityMultiplier(layer)))};
        }
        function graffitiRasterStyleKey(style){
            return [style.profileType,style.nibShape,style.nibRatio.toFixed(3),style.markerAngle.toFixed(5),style.width.toFixed(3),style.color,style.glow.toFixed(2),style.glowIntensity.toFixed(3)].join('|');
        }
        function graffitiRasterGeometryKey(paths,dynamic){
            if(dynamic)return 'frame:'+frameGeometryRuntime.frameId;
            let key='static:'+paths.length;
            for(const path of paths)key+=';'+graffitiPathSignature(path);
            return key;
        }
        function serializeGraffitiWorkerPaths(paths,rec){
            let total=0;const counts=[],closed=[];
            for(const path of paths||[]){const n=path?.points?.length||0;if(n<2)continue;counts.push(n);closed.push(path.closed===true?1:0);total+=n;}
            if(total<2)return null;
            const bytes=total*2*4;let buffer=rec.returnedBuffer;
            if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<bytes)buffer=new ArrayBuffer(Math.max(bytes,Math.ceil(bytes/4096)*4096));
            rec.returnedBuffer=null;const coords=new Float32Array(buffer,0,total*2);let k=0;
            for(const path of paths||[]){const pts=path?.points||[];if(pts.length<2)continue;for(const p of pts){coords[k++]=Number(p?.x)||0;coords[k++]=Number(p?.y)||0;}}
            return {buffer,counts,closed};
        }
        function prepareGraffitiOffscreenRaster(frameCtx,profilePrepared,visibleInstances,dpr,variant='base',override=null){
            const layer=frameCtx?.layer;
            if(!layer||profilePrepared?.application!=='graffiti'||profilePrepared?.variationOn===true)return null;
            const worker=ensureGraffitiOffscreenWorker();if(!worker)return null;
            const paths=profilePrepared.rounded||[];if(!paths.length)return null;
            const rec=getGraffitiOffscreenRecord(layer,variant),style=graffitiRasterStyle(layer,override),styleKey=graffitiRasterStyleKey(style);
            const dynamic=Boolean(runtimeState.morph?.active||runtimeState.minimalMorph?.active),geometryKey=graffitiRasterGeometryKey(paths,dynamic);
            rec.wantedKey=geometryKey;
            if(!rec.busy&&(rec.bitmapKey!==geometryKey||rec.bitmapStyleKey!==styleKey)){
                const packed=serializeGraffitiWorkerPaths(paths,rec);
                if(packed){
                    const id=++graffitiOffscreenRuntime.seq;rec.busy=true;rec.error=false;
                    const qualityScale=Math.max(1,Math.min(3.25,(Number(dpr)||1)*Math.max(.5,Number(state.zoom)||1)*Math.max(.5,Number(frameCtx.combinedScale)||1)*Math.max(1,Math.min(2.4,Number(visibleInstances?.maxScale)||1))));
                    graffitiOffscreenRuntime.jobs.set(id,rec);graffitiOffscreenRuntime.stats.submitted++;
                    try{worker.postMessage({type:'render',id,key:geometryKey,styleKey,frameId:frameGeometryRuntime.frameId,coordsBuffer:packed.buffer,counts:packed.counts,closed:packed.closed,style,rasterScale:qualityScale},[packed.buffer]);}
                    catch(_e){rec.busy=false;graffitiOffscreenRuntime.jobs.delete(id);rec.returnedBuffer=packed.buffer;graffitiOffscreenRuntime.stats.errors++;return null;}
                }
            }else if(rec.busy&&rec.bitmapKey!==geometryKey){graffitiOffscreenRuntime.stats.droppedBusy++;}
            if(!rec.bitmap||rec.tooLarge||rec.error)return null;
            if(!dynamic&&rec.bitmapStyleKey!==styleKey)return null;
            // Dynamic Morph may use the most recently completed bitmap (including its
            // matching style from that geometry frame), but never allow
            // more than three renderer frames of lag. If the worker cannot keep up, fall
            // back to the exact synchronous vector renderer instead of showing stale geometry.
            if(dynamic&&performance.now()-(Number(rec.resultAt)||0)>120)return null;
            if(!dynamic&&rec.bitmapKey!==geometryKey)return null;
            return rec;
        }
        function drawPreparedGraffitiOffscreenRaster(ctx,raster,alpha){
            if(!raster?.bitmap||alpha<=.001||!(raster.w>0&&raster.h>0))return false;
            ctx.save();ctx.globalAlpha=Math.max(0,Math.min(1,alpha));ctx.shadowBlur=0;ctx.drawImage(raster.bitmap,raster.x,raster.y,raster.w,raster.h);ctx.restore();
            graffitiOffscreenRuntime.stats.used++;return true;
        }

        return { prepareRaster:prepareGraffitiOffscreenRaster, drawRaster:drawPreparedGraffitiOffscreenRaster, setEnabled:setGraffitiRasterEnabled, stats:graffitiOffscreenRuntime.stats };
        })();
        window.__spiroGraffitiWorkerStats=GraffitiWorker.stats;
        window.__spiroGraffitiRibbonCacheStats=()=>({...graffitiVariableRibbonCacheStats,mesh:{...graffitiVariableRibbonMeshCacheStats}});

        function drawLineProfileMarkers(ctx, paths, layer, alpha=1, prepared=null, outerStateIsolated=false) {
            const application=prepared?.application||(['stroke','graffiti'].includes(layer?.lineProfileApplication)?layer.lineProfileApplication:'stroke');
            const type=prepared?.type||(application==='graffiti'?normalizeLineProfileValue(layer?.lineProfileGraffiti,'slash'):normalizeLineProfileValue(layer?.lineProfileStroke ?? layer?.lineProfile,'round'));
            if(application==='graffiti') { drawGraffitiMarker(ctx,paths,layer,alpha,prepared,outerStateIsolated); return; }
            if(type==='round'||alpha<=.001)return;
            const rounded=prepared?.rounded||prepareWebVisiblePaths(paths,layer);
            const table=prepared?.table||buildPathLengthTable(rounded); if(table.total<=0)return;
            const w=prepared?.w||Math.max(.5,Number(layer.strokeWidth)||1.5);
            const spacing=prepared?.spacing||Math.max(2.4,w*(type==='slash'?1.85:1.55));
            const count=Number.isFinite(prepared?.count)?prepared.count:Math.min(1800,Math.floor(table.total/spacing)); if(count<1)return;
            if(!outerStateIsolated)ctx.save();ctx.globalAlpha*=alpha;ctx.strokeStyle=layer.strokeColor||'#fff';ctx.fillStyle=layer.strokeColor||'#fff';ctx.shadowBlur=0;
            for(let i=0;i<count;i++){
                const d=(i+.5)/count*table.total;
                const p=pointAtPathDistance(table,d);
                // Profile orientation stays fixed instead of following the
                // local line tangent. Only its position travels along the path.
                ctx.save();ctx.translate(p.x,p.y);
                if(type==='slash'){
                    ctx.rotate(Math.PI/4);ctx.lineWidth=Math.max(.65,w*(application==='stroke'?.78:.62));ctx.lineCap='round';const half=application==='stroke'?Math.max(w*1.25,spacing*.58):w*1.2;ctx.beginPath();ctx.moveTo(-half,0);ctx.lineTo(half,0);ctx.stroke();
                }else if(type==='square'){
                    const size=Math.max(1.4,Math.max(w*1.35,spacing*.78));ctx.rotate(Math.PI/4);ctx.fillRect(-size/2,-size/2,size,size);
                }else if(type==='circle'){
                    const r=Math.max(.9,w*.72);ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fill();
                }else if(type==='cross'){
                    const size=Math.max(1.4,Math.max(w*1.35,spacing*.78)),bar=Math.max(.7,size*.24);ctx.rotate(Math.PI/4);ctx.fillRect(-size/2,-bar/2,size,bar);ctx.fillRect(-bar/2,-size/2,bar,size);
                }
                ctx.restore();
            }
            if(!outerStateIsolated)ctx.restore();
        }
        function buildWrappedSweepPieces(table,rangeStart,rangeLength,startWithin,length,samples,targetPieces=null,scratch=null){
            const result=targetPieces || [];
            if(!table||rangeLength<=0||length<=0)return result;
            const safeLength=Math.min(length,rangeLength);
            let start=((startWithin%rangeLength)+rangeLength)%rangeLength;
            const end=start+safeLength;
            const addPiece=(a,b)=>{
                if(b-a<=1e-6)return;
                const count=Math.max(2,Math.round(samples*((b-a)/safeLength)));
                const pts=scratch?acquireEffectPiece(scratch):[];
                for(let i=0;i<=count;i++){
                    const d=rangeStart+a+(b-a)*(i/count);
                    if(scratch) effectPointAt(pts,i,table,d); else pts.push(pointAtPathDistance(table,d));
                }
                pts.length=count+1;
                if(pts.length>1)result.push(pts);
            };
            if(end<=rangeLength){addPiece(start,end);}
            else{addPiece(start,rangeLength);addPiece(0,end-rangeLength);}
            return result;
        }
        function getSweepSegmentsForPath(path,layer){
            const table=buildPathLengthTable([path]);
            const segments=sweepSegmentScratch.segments;segments.length=0;
            if(table.total<=0)return {table,segments};
            const N=Math.max(2,Math.round(Number(layer?.N)||2));
            const K=Math.max(1,Math.round(Number(layer?.K)||1));
            const orbitCount=Math.max(1,gcd(N,K));
            const segmentCount=Math.max(1,Math.round(N/orbitCount));
            const len=table.total/segmentCount;
            while(sweepSegmentScratch.pool.length<segmentCount)sweepSegmentScratch.pool.push({start:0,length:0,index:0});
            for(let i=0;i<segmentCount;i++){const seg=sweepSegmentScratch.pool[i];seg.start=i*len;seg.length=len;seg.index=i;segments.push(seg);}
            return {table,segments};
        }
        function getSweepTargetVelocity(cfg=currentSweepConfig()){
            const mult=Math.max(.015625,Math.min(64,Number(cfg.speedMultiplier)||1));
            const bpm=Math.max(0,Number(state.tapTempo?.bpm)||0);
            const synced=cfg.syncMusic!==false&&bpm>0;
            const base=synced ? bpm/60 : Math.max(.02,Math.min(2,Number(cfg.speed)||.25));
            return base*mult*(cfg.direction==='backward'?-1:1);
        }
        // v60: unified robust glint/lightning geometry. Both effects use the same
        // current path source; only the active-range selector differs.
        function sweepStableUnit(seed){
            let x=(Math.imul((seed|0)^0x9e3779b9,1664525)+1013904223)>>>0;
            x^=x>>>16;x=Math.imul(x,2246822507)>>>0;x^=x>>>13;return (x>>>0)/4294967296;
        }
        function sampleSweepRange(table,start,length,maxSamples=90,scratch=null){
            if(!table||!(table.total>0)||!(length>1e-6))return scratch?null:[];
            const a=Math.max(0,Math.min(table.total,start)),b=Math.max(a,Math.min(table.total,start+length));
            if(b-a<=1e-6)return scratch?null:[];
            const n=Math.max(3,Math.min(maxSamples,Math.ceil((b-a)/3)));
            const pts=scratch?acquireEffectPiece(scratch):[];
            for(let i=0;i<=n;i++){
                const d=a+(b-a)*(i/n);
                if(scratch) effectPointAt(pts,i,table,d); else pts.push(pointAtPathDistance(table,d));
            }
            pts.length=n+1;
            return pts;
        }
        function normalizeGlintPrecisionValue(value) { return value==='chaotic'?'chaotic':(value==='spectral'?'spectral':'high'); }
        function effectiveGlintType(cfg){return normalizeSweepFlashMode(cfg?.flashMode)==='spectral'?'spectral':normalizeGlintPrecisionValue(cfg?.flashType??cfg?.glintPrecision);}
        function isHighPrecisionGlint(cfg) { return effectiveGlintType(cfg)==='high'; }

        // v307: high-precision glint follows the same visible rail as the line renderer.
        // Smooth splines / rounding are replayed through the same drawing functions into a
        // dense point sampler.  The legacy glint remains untouched as "chaotic".
        // v424: high-precision Glint no longer tessellates every cubic into 36 points
        // and every quadratic into 28 points. Curves are flattened adaptively by geometric
        // error: a straight/near-straight Bezier emits one segment, while curvature alone
        // decides where more points are needed. This keeps the visible rail accurate without
        // making long/simple splines expensive during Morphing.
        const dynamicHighPrecisionGlintSamplerCache=new WeakMap();
        function createSweepHighPrecisionSampler(tolerance=.22,maxDepth=8) {
            let tol=Math.max(.04,Math.min(.7,Number(tolerance)||.22));
            let depthCap=Math.max(4,Math.min(11,Math.round(Number(maxDepth)||8)));
            const points=[],pointPool=[];
            let pointCursor=0,currentX=0,currentY=0,hasCurrent=false,startX=0,startY=0,hasStart=false;
            const push=(x,y)=>{
                const nx=Number(x)||0,ny=Number(y)||0,last=points[points.length-1];
                if(!last||Math.hypot(nx-last.x,ny-last.y)>1e-8){
                    let p=pointPool[pointCursor];if(!p)p=pointPool[pointCursor]={x:0,y:0};pointCursor++;p.x=nx;p.y=ny;points.push(p);
                }
                currentX=nx;currentY=ny;hasCurrent=true;
            };
            const chordDistance=(px,py,ax,ay,bx,by)=>{
                const dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy;
                if(l2<=1e-16)return Math.hypot(px-ax,py-ay);
                const u=((px-ax)*dx+(py-ay)*dy)/l2;
                return Math.hypot(px-(ax+dx*u),py-(ay+dy*u));
            };
            // Scalar subdivision deliberately avoids allocating midpoint/control-point objects
            // inside the recursive hot path. Output points themselves come from a tiny pool.
            const flattenQuadratic=(x0,y0,x1,y1,x2,y2,depth)=>{
                if(depth>=depthCap||chordDistance(x1,y1,x0,y0,x2,y2)<=tol){push(x2,y2);return;}
                const ax=(x0+x1)*.5,ay=(y0+y1)*.5,bx=(x1+x2)*.5,by=(y1+y2)*.5,mx=(ax+bx)*.5,my=(ay+by)*.5;
                flattenQuadratic(x0,y0,ax,ay,mx,my,depth+1);flattenQuadratic(mx,my,bx,by,x2,y2,depth+1);
            };
            const flattenCubic=(x0,y0,x1,y1,x2,y2,x3,y3,depth)=>{
                const flat=Math.max(chordDistance(x1,y1,x0,y0,x3,y3),chordDistance(x2,y2,x0,y0,x3,y3));
                if(depth>=depthCap||flat<=tol){push(x3,y3);return;}
                const ax=(x0+x1)*.5,ay=(y0+y1)*.5,bx=(x1+x2)*.5,by=(y1+y2)*.5,cx=(x2+x3)*.5,cy=(y2+y3)*.5;
                const dx=(ax+bx)*.5,dy=(ay+by)*.5,ex=(bx+cx)*.5,ey=(by+cy)*.5,mx=(dx+ex)*.5,my=(dy+ey)*.5;
                flattenCubic(x0,y0,ax,ay,dx,dy,mx,my,depth+1);flattenCubic(mx,my,ex,ey,cx,cy,x3,y3,depth+1);
            };
            const api={
                points,
                setQuality(tolerance=.22,maxDepth=8){tol=Math.max(.04,Math.min(.7,Number(tolerance)||.22));depthCap=Math.max(4,Math.min(11,Math.round(Number(maxDepth)||8)));return api;},
                reset(){points.length=0;pointCursor=0;hasCurrent=false;hasStart=false;currentX=currentY=startX=startY=0;return api;},
                moveTo(x,y){hasCurrent=false;push(x,y);startX=currentX;startY=currentY;hasStart=true;},
                lineTo(x,y){push(x,y);},
                bezierCurveTo(c1x,c1y,c2x,c2y,x,y){
                    const x3=Number(x)||0,y3=Number(y)||0;if(!hasCurrent){push(x3,y3);return;}
                    flattenCubic(currentX,currentY,Number(c1x)||0,Number(c1y)||0,Number(c2x)||0,Number(c2y)||0,x3,y3,0);
                },
                quadraticCurveTo(cx,cy,x,y){
                    const x2=Number(x)||0,y2=Number(y)||0;if(!hasCurrent){push(x2,y2);return;}
                    flattenQuadratic(currentX,currentY,Number(cx)||0,Number(cy)||0,x2,y2,0);
                },
                closePath(){if(hasCurrent&&hasStart&&Math.hypot(currentX-startX,currentY-startY)>1e-8)push(startX,startY);}
            };
            return api;
        }
        function highPrecisionGlintTolerance(layer){
            // v425: precision is controlled in approximate screen space, not by an arbitrary
            // local-space 0.16 unit everywhere. Zoomed-out scenes can safely use fewer spline
            // segments; deep zoom automatically tightens the error bound.
            const z=Math.max(.2,Math.min(5,Number(state?.zoom)||1)),ls=Math.max(.15,Math.min(8,Math.abs(Number(layer?.scale)||1))),screenScale=z*ls;
            if(screenScale>=4)return .07;if(screenScale>=2)return .11;if(screenScale>=1)return .19;if(screenScale>=.5)return .30;return .48;
        }
        function acquireHighPrecisionGlintSampler(path,dynamicSource,tolerance=.22){
            if(dynamicSource&&path&&typeof path==='object'){
                let sampler=dynamicHighPrecisionGlintSamplerCache.get(path);
                if(!sampler){sampler=createSweepHighPrecisionSampler(tolerance,8);dynamicHighPrecisionGlintSamplerCache.set(path,sampler);}
                return sampler.setQuality(tolerance,8).reset();
            }
            return createSweepHighPrecisionSampler(tolerance,8);
        }
        function buildHighPrecisionGlintPaths(frameCtx) {
            const source=getLayerFrameAuxiliaryPaths(frameCtx),layer=frameCtx?.layer;
            if(!Array.isArray(source)||!source.length||!layer)return source||[];
            const round=getRoundingStrength(layer.rounding),glintTolerance=highPrecisionGlintTolerance(layer);
            const dynamicSource=isCurrentFrameDynamicPathList(source)||Boolean(runtimeState.morph?.active&&state.morph?.mode!=='light');
            // v424 zero-work fast paths: if the visible carrier is already the exact sampled
            // rail, or a non-Morph/no-rounding layer is genuinely linear, do not create a
            // second high-precision representation at all.
            if(source.every(path=>path?._stableRoundedSplineRail===true||path?._greenRenderedRail===true))return source;
            if(!dynamicSource&&round<=.001&&source.every(path=>!useSmoothSplinePath(layer,round,path)))return source;
            const staticCacheable=!dynamicSource&&!isSpiralLayer(layer);
            const staticKey=staticCacheable?`${normalizeSplineRenderMode(layer?.splineRenderMode)}|${layer?.profileMode||'segments'}|r:${round.toFixed(5)}|tol:${glintTolerance.toFixed(2)}|fourier:${state.fourierMode?1:0}:${Math.round((Number(state.fourierStrength)||0)*100)/100}`:'';
            if(staticCacheable){const variants=persistentHighPrecisionGlintCache.get(source),hit=variants?.get(staticKey);if(hit)return hit;}
            // Spiral uses the exact sampled center rail consumed by its variable-width
            // renderer, including authored-corner rounding and Fourier deformation.
            if(isSpiralLayer(layer)){
                const out=source.map(path=>{
                    let pts=path?.points||[];
                    if(round>.001&&Array.isArray(path?.cornerFlags)&&path.cornerFlags.some(Boolean))pts=smoothMorphPath(pts,false,round,path.cornerFlags);
                    if(state.fourierMode&&pts?._fourierPrepared!==true)pts=buildFourierWavePoints(pts,false,`sweep-spiral:${round.toFixed(4)}`);
                    return {...path,points:pts,cornerFlags:[]};
                });
                if(isCurrentFrameDynamicPathList(source))out._frameGeometryId=frameGeometryRuntime.frameId;
                return out;
            }
            let morphInfo=null;
            if(runtimeState.morph?.active&&state.morph?.mode!=='light'){
                const t=Number.isFinite(Number(runtimeState.morph.geometryT))?Number(runtimeState.morph.geometryT):Number(runtimeState.morph.progress)||0;
                morphInfo=getLampMorphRenderInfo(frameCtx.layerIndex,t,layer);
            }
            const out=source.map(path=>{
                const pts=path?.points||[];if(pts.length<2)return path;
                const sampler=acquireHighPrecisionGlintSampler(path,dynamicSource,glintTolerance);
                if(morphInfo){
                    drawMorphPathQuality(sampler,pts,Boolean(path.closed),morphInfo.roundingFrac,morphInfo.profileMode,morphInfo.splineBlend,morphInfo.continuousProfileBlend,morphInfo.splineRenderMode,path.cornerFlags||[],path.bridgeRoundFlags||[]);
                }else if(useSmoothSplinePath(layer,round,path)){
                    splinePathForDraw(sampler,pts,Boolean(path.closed),round,path.cornerFlags||[],path.bridgeRoundFlags||[]);
                }else{
                    roundPolylineForDraw(sampler,pts,Boolean(path.closed),round,path.cornerFlags||[]);
                }
                return {...path,points:sampler.points.length>1?sampler.points:pts,cornerFlags:[]};
            });
            if(isCurrentFrameDynamicPathList(source))out._frameGeometryId=frameGeometryRuntime.frameId;
            if(staticCacheable){let variants=persistentHighPrecisionGlintCache.get(source);if(!variants){variants=new Map();persistentHighPrecisionGlintCache.set(source,variants);}variants.set(staticKey,out);}
            return out;
        }
        function normalizeLightningBehaviorValue(value,fallback='inside') {
            if(value==='inside'||value==='outside'||value==='symmetric')return value;
            if(value==='strict')return 'inside';
            if(value==='chaotic')return 'symmetric';
            return fallback;
        }
        function normalizeLightningPrecisionValue(value) { return value==='simple'?'simple':'exact'; }
        function isExactLightning(cfg) { return normalizeLightningPrecisionValue(cfg?.lightningPrecision)==='exact'; }
        function isHighPrecisionLightning(cfg) { return normalizeLightningPrecisionValue(cfg?.lightningPrecision)==='exact'; }

        // v423 — Exact Lightning keeps the SAME vector commands as the visible line.
        // The old v419-v422 implementation converted every cubic/quadratic into a very dense
        // 128/96-step polyline and then sampled that rail again (up to 1600 points).  Exact now
        // records L/Q/C commands, builds a cheap adaptive arc-length index, trims only the active
        // interval with De Casteljau, and sends an adaptive polyline ONLY to the line-capsule GPU
        // backend. Canvas fallback strokes the real quadratic/cubic Path2D without tessellation.
        function exactLightningPoint(x,y){return{x:Number(x)||0,y:Number(y)||0};}
        function exactLightningLerp(a,b,t){return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};}
        function exactLightningDistanceToChord(p,a,b){
            const dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;
            if(l2<=1e-16)return Math.hypot(p.x-a.x,p.y-a.y);
            const u=((p.x-a.x)*dx+(p.y-a.y)*dy)/l2,qx=a.x+dx*u,qy=a.y+dy*u;
            return Math.hypot(p.x-qx,p.y-qy);
        }
        function exactLightningSplitQuadratic(seg,t=.5){
            const a=exactLightningLerp(seg.p0,seg.p1,t),b=exactLightningLerp(seg.p1,seg.p2,t),m=exactLightningLerp(a,b,t);
            return[{type:'Q',p0:seg.p0,p1:a,p2:m,breakBefore:seg.breakBefore===true},{type:'Q',p0:m,p1:b,p2:seg.p2,breakBefore:false}];
        }
        function exactLightningSplitCubic(seg,t=.5){
            const a=exactLightningLerp(seg.p0,seg.p1,t),b=exactLightningLerp(seg.p1,seg.p2,t),c=exactLightningLerp(seg.p2,seg.p3,t),d=exactLightningLerp(a,b,t),e=exactLightningLerp(b,c,t),m=exactLightningLerp(d,e,t);
            return[{type:'C',p0:seg.p0,p1:a,p2:d,p3:m,breakBefore:seg.breakBefore===true},{type:'C',p0:m,p1:e,p2:c,p3:seg.p3,breakBefore:false}];
        }
        function exactLightningSliceSegment(seg,t0,t1){
            let a=Math.max(0,Math.min(1,Number(t0)||0)),b=Math.max(a,Math.min(1,Number(t1)||0));
            if(a<=1e-10&&b>=1-1e-10)return{...seg};
            if(seg.type==='L')return{type:'L',p0:exactLightningLerp(seg.p0,seg.p1,a),p1:exactLightningLerp(seg.p0,seg.p1,b),breakBefore:seg.breakBefore===true};
            let left=seg;
            if(b<1-1e-10)left=(seg.type==='C'?exactLightningSplitCubic(seg,b):exactLightningSplitQuadratic(seg,b))[0];
            if(a>1e-10){const local=b>1e-10?a/b:0;left=(left.type==='C'?exactLightningSplitCubic(left,local):exactLightningSplitQuadratic(left,local))[1];}
            left.breakBefore=seg.breakBefore===true;return left;
        }
        function exactLightningSegmentEnd(seg){return seg.type==='C'?seg.p3:(seg.type==='Q'?seg.p2:seg.p1);}
        function exactLightningSegmentFlatness(seg){
            const e=exactLightningSegmentEnd(seg);
            if(seg.type==='C')return Math.max(exactLightningDistanceToChord(seg.p1,seg.p0,e),exactLightningDistanceToChord(seg.p2,seg.p0,e));
            if(seg.type==='Q')return exactLightningDistanceToChord(seg.p1,seg.p0,e);
            return 0;
        }
        function exactLightningFlattenSegment(seg,tolerance=.16,maxDepth=10){
            const out=[{t:0,p:seg.p0,d:0}];
            const rec=(part,t0,t1,depth)=>{
                if(part.type==='L'||depth>=maxDepth||exactLightningSegmentFlatness(part)<=tolerance){out.push({t:t1,p:exactLightningSegmentEnd(part),d:0});return;}
                const halves=part.type==='C'?exactLightningSplitCubic(part,.5):exactLightningSplitQuadratic(part,.5),tm=(t0+t1)*.5;
                rec(halves[0],t0,tm,depth+1);rec(halves[1],tm,t1,depth+1);
            };
            rec(seg,0,1,0);let total=0;
            for(let i=1;i<out.length;i++){total+=Math.hypot(out[i].p.x-out[i-1].p.x,out[i].p.y-out[i-1].p.y);out[i].d=total;}
            return{samples:out,length:total};
        }
        // v424: arc length is scalar math, not a pre-tessellated point rail. Five-point
        // Gauss-Legendre integration gives a stable length for Q/C segments without allocating
        // samples along the complete spline. Only the actually visible cut is flattened later.
        // v526: 10-point Gauss-Legendre substantially reduces arc-length drift on
        // tight cubic splines. Exact Lightning trims by physical distance; the older
        // 5-point rule could visibly lead/lag the base spline on high-curvature segments.
        const EXACT_LIGHTNING_GAUSS_X=[-.973906528517172,-.865063366688985,-.679409568299024,-.433395394129247,-.148874338981631,.148874338981631,.433395394129247,.679409568299024,.865063366688985,.973906528517172];
        const EXACT_LIGHTNING_GAUSS_W=[.066671344308688,.149451349150581,.219086362515982,.269266719309996,.295524224714753,.295524224714753,.269266719309996,.219086362515982,.149451349150581,.066671344308688];
        function exactLightningDerivativeAt(seg,t){
            const q=Math.max(0,Math.min(1,Number(t)||0)),u=1-q;
            if(seg.type==='L')return{x:seg.p1.x-seg.p0.x,y:seg.p1.y-seg.p0.y};
            if(seg.type==='Q')return{x:2*(u*(seg.p1.x-seg.p0.x)+q*(seg.p2.x-seg.p1.x)),y:2*(u*(seg.p1.y-seg.p0.y)+q*(seg.p2.y-seg.p1.y))};
            return{x:3*(u*u*(seg.p1.x-seg.p0.x)+2*u*q*(seg.p2.x-seg.p1.x)+q*q*(seg.p3.x-seg.p2.x)),y:3*(u*u*(seg.p1.y-seg.p0.y)+2*u*q*(seg.p2.y-seg.p1.y)+q*q*(seg.p3.y-seg.p2.y))};
        }
        function exactLightningSegmentArcLength(seg,tMax=1){
            const t=Math.max(0,Math.min(1,Number(tMax)||0));if(t<=1e-12)return 0;
            if(seg.type==='L')return Math.hypot(seg.p1.x-seg.p0.x,seg.p1.y-seg.p0.y)*t;
            const half=t*.5,center=half;let sum=0;
            for(let i=0;i<EXACT_LIGHTNING_GAUSS_X.length;i++){const q=center+half*EXACT_LIGHTNING_GAUSS_X[i],d=exactLightningDerivativeAt(seg,q);sum+=EXACT_LIGHTNING_GAUSS_W[i]*Math.hypot(d.x,d.y);}
            return half*sum;
        }
        function exactLightningParamAtDistance(seg,d){
            const total=Math.max(0,Number(seg._length)||0),target=Math.max(0,Math.min(total,Number(d)||0));
            if(target<=1e-10||total<=1e-12)return 0;if(target>=total-1e-10)return 1;
            if(seg.type==='L')return target/total;
            let lo=0,hi=1,t=Math.max(0,Math.min(1,target/total));
            for(let i=0;i<9;i++){
                const got=exactLightningSegmentArcLength(seg,t),err=got-target;
                if(Math.abs(err)<=Math.max(1e-6,total*2e-6))break;
                if(err<0)lo=t;else hi=t;
                const dv=exactLightningDerivativeAt(seg,t),speed=Math.hypot(dv.x,dv.y),newton=speed>1e-8?t-err/speed:NaN;
                t=Number.isFinite(newton)&&newton>lo+1e-6&&newton<hi-1e-6?newton:(lo+hi)*.5;
            }
            return Math.max(0,Math.min(1,t));
        }
        function exactLightningBuildRail(segments,buildPreview=false,target=null){
            // v425: dynamic Morph reuses the rail object as well as its segment/point pools.
            // Only coordinates and scalar arc lengths change; no per-frame rail/fullPieces shell allocation.
            const rail=target||{segments,total:0,fullPieces:[],segmentCount:0};rail.segments=segments;rail.total=0;rail.segmentCount=0;
            const fullPieces=Array.isArray(rail.fullPieces)?rail.fullPieces:(rail.fullPieces=[]);fullPieces.length=0;
            let piece=null,last=null;
            for(const seg of segments){
                seg._samples=null;seg._length=exactLightningSegmentArcLength(seg,1);seg._start=rail.total;rail.total+=seg._length;rail.segmentCount++;
                if(buildPreview){
                    if(seg.breakBefore===true||!piece){piece=[];fullPieces.push(piece);last=null;}
                    const flat=exactLightningFlattenSegment(seg,.12,10).samples;
                    for(let i=0;i<flat.length;i++){const p=flat[i].p;if(!last||Math.hypot(p.x-last.x,p.y-last.y)>1e-9){piece.push(p);last=p;}}
                }
            }
            return rail;
        }
        const dynamicExactLightningRecorderCache=new WeakMap();
        function createExactLightningSplineRecorder(){
            const segments=[],segmentPool=[],pointPool=[],rail={segments,total:0,fullPieces:[],segmentCount:0};let segmentCursor=0,pointCursor=0,current=null,subpathStart=null,nextBreak=true;
            const point=(x,y)=>{let p=pointPool[pointCursor];if(!p)p=pointPool[pointCursor]={x:0,y:0};pointCursor++;p.x=Number(x)||0;p.y=Number(y)||0;return p;};
            const start=(x,y)=>{current=point(x,y);subpathStart=current;nextBreak=true;};
            const add=(type,p0,p1,p2=null,p3=null)=>{let seg=segmentPool[segmentCursor];if(!seg)seg=segmentPool[segmentCursor]={type:'L',p0:null,p1:null,p2:null,p3:null,breakBefore:false};segmentCursor++;seg.type=type;seg.p0=p0;seg.p1=p1;seg.p2=p2;seg.p3=p3;seg.breakBefore=nextBreak;seg._samples=null;seg._length=0;seg._start=0;nextBreak=false;segments.push(seg);current=exactLightningSegmentEnd(seg);};
            const api={
                segments,rail,
                reset(){segments.length=0;segmentCursor=0;pointCursor=0;current=null;subpathStart=null;nextBreak=true;rail.total=0;rail.segmentCount=0;rail.fullPieces.length=0;return api;},
                moveTo(x,y){start(x,y);},
                lineTo(x,y){const p=point(x,y);if(!current){current=p;subpathStart=p;nextBreak=true;return;}add('L',current,p);},
                quadraticCurveTo(cx,cy,x,y){const p=point(x,y);if(!current){current=p;subpathStart=p;nextBreak=true;return;}add('Q',current,point(cx,cy),p);},
                bezierCurveTo(c1x,c1y,c2x,c2y,x,y){const p=point(x,y);if(!current){current=p;subpathStart=p;nextBreak=true;return;}add('C',current,point(c1x,c1y),point(c2x,c2y),p);},
                closePath(){if(current&&subpathStart&&Math.hypot(current.x-subpathStart.x,current.y-subpathStart.y)>1e-9)add('L',current,subpathStart);current=subpathStart;nextBreak=true;},
                finish(buildPreview=false){return exactLightningBuildRail(segments,buildPreview===true,rail);}
            };
            return api;
        }
        function acquireDynamicExactLightningRecorder(owner){
            if(!owner||typeof owner!=='object')return createExactLightningSplineRecorder();
            let rec=dynamicExactLightningRecorderCache.get(owner);if(!rec){rec=createExactLightningSplineRecorder();dynamicExactLightningRecorderCache.set(owner,rec);}return rec.reset();
        }
        function exactLightningAppendSegment(path,seg,move){
            if(move)path.moveTo(seg.p0.x,seg.p0.y);
            if(seg.type==='C')path.bezierCurveTo(seg.p1.x,seg.p1.y,seg.p2.x,seg.p2.y,seg.p3.x,seg.p3.y);
            else if(seg.type==='Q')path.quadraticCurveTo(seg.p1.x,seg.p1.y,seg.p2.x,seg.p2.y);
            else path.lineTo(seg.p1.x,seg.p1.y);
        }
        function exactLightningSegmentIndexAtDistance(rail,distance){
            const segs=rail?.segments||[];if(!segs.length)return -1;
            const d=Math.max(0,Math.min(Math.max(0,Number(rail.total)||0)-1e-12,Number(distance)||0));let lo=0,hi=segs.length-1;
            while(lo<hi){const mid=(lo+hi)>>1,s=segs[mid];if(s._start+s._length<=d)lo=mid+1;else hi=mid;}return lo;
        }
        function exactLightningAppendRange(rail,start,length,path,pieces){
            if(!rail||!(rail.total>0)||!(length>1e-8))return false;
            const a=Math.max(0,Math.min(rail.total,Number(start)||0)),b=Math.max(a,Math.min(rail.total,a+(Number(length)||0)));if(b<=a+1e-8)return false;
            // v425: the moving flash normally touches only a small part of the rail. Binary-search
            // the first/last spline command instead of scanning every command for every pre-glow frame.
            const first=exactLightningSegmentIndexAtDistance(rail,a),last=exactLightningSegmentIndexAtDistance(rail,Math.max(a,b-1e-10));if(first<0||last<first)return false;
            let currentPiece=null,lastPoint=null,wrote=false;
            for(let si=first;si<=last;si++){
                const seg=rail.segments[si],sa=seg._start,sb=sa+seg._length,oa=Math.max(a,sa),ob=Math.min(b,sb);if(ob<=oa+1e-10)continue;
                const t0=oa<=sa+1e-10?0:exactLightningParamAtDistance(seg,oa-sa),t1=ob>=sb-1e-10?1:exactLightningParamAtDistance(seg,ob-sa),cut=(t0<=1e-10&&t1>=1-1e-10)?seg:exactLightningSliceSegment(seg,t0,t1);
                const discontinuity=seg.breakBefore===true||!currentPiece||!lastPoint||Math.hypot(cut.p0.x-lastPoint.x,cut.p0.y-lastPoint.y)>1e-7;
                if(discontinuity){currentPiece=[];pieces.push(currentPiece);lastPoint=null;}
                exactLightningAppendSegment(path,cut,discontinuity||!wrote);
                const flat=exactLightningFlattenSegment(cut,.12,10).samples;
                for(let i=0;i<flat.length;i++){const p=flat[i].p;if(!lastPoint||Math.hypot(p.x-lastPoint.x,p.y-lastPoint.y)>1e-9){currentPiece.push(p);lastPoint=p;}}
                wrote=true;
            }
            return wrote;
        }
        function exactLightningSelection(paths,layer,cfg,layerIndex=-1){
            const rails=(paths||[]).map((path,index)=>({rail:path?._exactLightningRail,path,index})).filter(x=>x.rail?.total>0);if(!rails.length)return null;
            const mode=['perSegment','everyNth','across','perPath','whole'].includes(cfg.lightningMode)?cfg.lightningMode:'perPath';
            // X-band clipping is inherently a geometric intersection operation. Keep the
            // adaptive rail fallback there; every arc-length mode below trims the actual spline.
            if(mode==='across')return null;
            const frac=Math.max(.01,Math.min(1,audioApplyNumeric('lightning.segment',Number(cfg.lightningSegmentPercent)||100,layerIndex)/100));
            const random=cfg.lightningRandomPosition===true,cycle=Math.max(0,Math.round(Number(cfg.lightningCycleCount)||0)),ranges=[];
            const add=(rail,start,length)=>{const len=Math.max(0,Math.min(rail.total-start,length));if(len>1e-8)ranges.push({rail,start,length:len});};
            if(mode==='perSegment'||mode==='everyNth'){
                const N=Math.max(2,Math.round(Number(layer?.N)||2)),K=Math.max(1,Math.round(Number(layer?.K)||1)),segmentCount=Math.max(1,Math.round(N/Math.max(1,gcd(N,K)))),nth=Math.max(2,Math.min(24,Math.round(Number(cfg.lightningEveryN)||2)));let global=0;
                for(const item of rails){const segLen=item.rail.total/segmentCount;for(let i=0;i<segmentCount;i++){const use=mode==='perSegment'||global%nth===0,salt=global++;if(!use)continue;const len=segLen*frac,room=Math.max(0,segLen-len),off=random?sweepStableUnit(cycle*4099+salt*131+17)*room:0;add(item.rail,i*segLen+off,len);}}
            }else if(mode==='perPath'){
                for(const item of rails){const len=item.rail.total*frac,room=Math.max(0,item.rail.total-len),off=random?sweepStableUnit(cycle*4099+item.index*271+31)*room:0;add(item.rail,off,len);}
            }else{
                let total=0;const infos=[];for(const item of rails){infos.push({rail:item.rail,start:total,index:item.index});total+=item.rail.total;}if(total>0){const len=total*frac,room=Math.max(0,total-len),off=random?sweepStableUnit(cycle*4099+73)*room:0,end=off+len;for(const info of infos){const a=Math.max(off,info.start),b=Math.min(end,info.start+info.rail.total);if(b>a)add(info.rail,a-info.start,b-a);}}
            }
            const strikePath=new Path2D(),pieces=[];for(const r of ranges)exactLightningAppendRange(r.rail,r.start,r.length,strikePath,pieces);
            return{ranges,pieces,strikePath};
        }
        function buildExactLightningPrecharge(prepared,t,cfg,layerIndex=-1){
            if(!prepared?.exactRanges?.length)return null;
            const flash=getLightningFlashLengthPercent(cfg,layerIndex)/100;
            // 100% is a true zero-work fast path: same spline, same GPU adaptive pieces.
            if(flash>=.999999)return{path:prepared.strikePath,pieces:prepared.pieces,reused:true};
            const travel=lightningSmooth01(t),path=new Path2D(),pieces=[];
            for(const r of prepared.exactRanges){const len=r.length*flash,start=r.start+(r.length-len)*travel;exactLightningAppendRange(r.rail,start,len,path,pieces);}
            return{path,pieces,reused:false};
        }

        function buildExactLightningPaths(frameCtx) {
            const source=getLayerFrameAuxiliaryPaths(frameCtx),layer=frameCtx?.layer,cfg=frameCtx?.layerSweep||getLayerSweepConfig(layer);
            if(!Array.isArray(source)||!source.length||!layer)return source||[];
            const frameId=Number(frameCtx?.frameId)||Number(frameCtx?.frame?.id)||Number(frameGeometryRuntime?.frameId)||0;
            // v425: some fallback/probe paths can request Exact geometry more than once in a
            // display frame. Reuse the prepared rail verbatim instead of replaying spline math.
            if(frameCtx&&frameCtx._exactLightningPathsFrameId===frameId&&frameCtx._exactLightningPathsSource===source&&frameCtx._exactLightningPaths)return frameCtx._exactLightningPaths;
            const round=getRoundingStrength(layer.rounding),behavior=normalizeLightningBehaviorValue(cfg?.lightningBehavior,'symmetric'),needsPreview=cfg?.lightningMode==='across'||behavior!=='symmetric';
            const dynamicSource=isCurrentFrameDynamicPathList(source)||Boolean(runtimeState.morph?.active&&state.morph?.mode!=='light')||frameCtx?.minimalFadeEnabled===true||frameCtx?.greenMorphEnabled===true;
            const staticCacheable=!dynamicSource&&!isSpiralLayer(layer);
            const staticKey=staticCacheable?`exactSplineV425|preview:${needsPreview?1:0}|${normalizeSplineRenderMode(layer?.splineRenderMode)}|${layer?.profileMode||'segments'}|r:${round.toFixed(5)}|fourier:${state.fourierMode?1:0}:${Math.round((Number(state.fourierStrength)||0)*100)/100}`:'';
            if(staticCacheable){const variants=persistentExactLightningCache.get(source),hit=variants?.get(staticKey);if(hit){if(frameCtx){frameCtx._exactLightningPathsFrameId=frameId;frameCtx._exactLightningPathsSource=source;frameCtx._exactLightningPaths=hit;}return hit;}}
            // Static Smooth Spiral now HAS a retained cubic source. Reuse those exact controls
            // for Lightning/Glint instead of treating the visible curve as a straight sampled rail.
            // Dynamic special Spiral Morph is handled by the shared GPU Bézier resource; this
            // branch is also safe for static fallback because getAuxiliaryLayerPaths marks the rail.
            if(isSpiralLayer(layer)){
                const hasExactCubics=source.some(path=>Array.isArray(path?._bezierSegments)&&path._bezierSegments.length);
                if(hasExactCubics){
                    const out=source.map(path=>{
                        const cubics=path?._bezierSegments||[];if(!cubics.length)return path;
                        const recorder=createExactLightningSplineRecorder(),q0=cubics[0];recorder.moveTo(q0.p0.x,q0.p0.y);
                        for(const q of cubics)recorder.bezierCurveTo(q.c1.x,q.c1.y,q.c2.x,q.c2.y,q.p3.x,q.p3.y);
                        const rail=recorder.finish(needsPreview),preview=needsPreview&&rail.fullPieces.length===1&&rail.fullPieces[0].length>1?rail.fullPieces[0]:(path.points||[]);
                        return{...path,points:preview,cornerFlags:[],_exactLightningRail:rail};
                    });
                    if(isCurrentFrameDynamicPathList(source))out._frameGeometryId=frameGeometryRuntime.frameId;
                    out._lightningRenderedRail=true;out._exactLightningSplineRail=true;
                    if(frameCtx){frameCtx._exactLightningPathsFrameId=frameId;frameCtx._exactLightningPathsSource=source;frameCtx._exactLightningPaths=out;}return out;
                }
                // Fourier / dynamic compatibility Spiral keeps the proven compatibility rail.
                // The normal phase-circle path never reaches this when the GPU Bézier resource is ready.
                const out=source.map(path=>{
                    let pts=path?.points||[];
                    if(round>.001&&Array.isArray(path?.cornerFlags)&&path.cornerFlags.some(Boolean))pts=smoothMorphPath(pts,false,round,path.cornerFlags);
                    if(state.fourierMode&&pts?._fourierPrepared!==true)pts=buildFourierWavePoints(pts,false,`lightning-exact-spiral:${round.toFixed(4)}`);
                    return{...path,points:pts,cornerFlags:[]};
                });
                if(isCurrentFrameDynamicPathList(source))out._frameGeometryId=frameGeometryRuntime.frameId;
                out._lightningRenderedRail=true;if(frameCtx){frameCtx._exactLightningPathsFrameId=frameId;frameCtx._exactLightningPathsSource=source;frameCtx._exactLightningPaths=out;}return out;
            }
            let morphInfo=null;
            if(runtimeState.morph?.active&&state.morph?.mode!=='light'){
                const mt=Number.isFinite(Number(runtimeState.morph.geometryT))?Number(runtimeState.morph.geometryT):Number(runtimeState.morph.progress)||0;
                morphInfo=getLampMorphRenderInfo(frameCtx.layerIndex,mt,layer);
            }
            const out=source.map(path=>{
                const pts=path?.points||[];if(pts.length<2)return path;
                const recorder=dynamicSource?acquireDynamicExactLightningRecorder(path):createExactLightningSplineRecorder();
                // v425: stable smooth+rounded Morph rails are ALREADY the exact visible line
                // (the base renderer intentionally lineTo()s these sampled rails). Replaying
                // drawMorphPathQuality/splinePathForDraw here both wastes CPU and can double-spline.
                if(path?._greenRenderedRail===true||source?._greenRenderedRail===true||path?._stableRoundedSplineRail===true){
                    // Green project Morph already supplies the sampled rail that the base line
                    // actually renders. Re-splining it here bends Exact Lightning away from
                    // that visible curve (spline-of-spline error), so traverse it verbatim.
                    recorder.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++)recorder.lineTo(pts[i].x,pts[i].y);if(path.closed)recorder.closePath();
                }else if(morphInfo){
                    drawMorphPathQuality(recorder,pts,Boolean(path.closed),morphInfo.roundingFrac,morphInfo.profileMode,morphInfo.splineBlend,morphInfo.continuousProfileBlend,morphInfo.splineRenderMode,path.cornerFlags||[],path.bridgeRoundFlags||[]);
                }else if(useSmoothSplinePath(layer,round,path)){
                    splinePathForDraw(recorder,pts,Boolean(path.closed),round,path.cornerFlags||[],path.bridgeRoundFlags||[]);
                }else{
                    roundPolylineForDraw(recorder,pts,Boolean(path.closed),round,path.cornerFlags||[]);
                }
                const rail=recorder.finish(needsPreview),preview=needsPreview&&rail.fullPieces.length===1&&rail.fullPieces[0].length>1?rail.fullPieces[0]:pts;
                return {...path,points:preview,cornerFlags:[],_exactLightningRail:rail};
            });
            if(isCurrentFrameDynamicPathList(source))out._frameGeometryId=frameGeometryRuntime.frameId;
            out._lightningRenderedRail=true;out._exactLightningSplineRail=true;
            if(staticCacheable){let variants=persistentExactLightningCache.get(source);if(!variants){variants=new Map();persistentExactLightningCache.set(source,variants);}variants.set(staticKey,out);}
            if(frameCtx){frameCtx._exactLightningPathsFrameId=frameId;frameCtx._exactLightningPathsSource=source;frameCtx._exactLightningPaths=out;}
            return out;
        }
        function glintSegmentToCubic(seg,forceBreak=false){
            if(!seg)return null;const p0=seg.p0;if(!p0)return null;
            if(seg.type==='C')return{p0,c1:seg.p1,c2:seg.p2,p3:seg.p3,breakBefore:forceBreak||seg.breakBefore===true};
            if(seg.type==='Q'){
                const p3=seg.p2,c1={x:p0.x+(seg.p1.x-p0.x)*2/3,y:p0.y+(seg.p1.y-p0.y)*2/3},c2={x:p3.x+(seg.p1.x-p3.x)*2/3,y:p3.y+(seg.p1.y-p3.y)*2/3};
                return{p0,c1,c2,p3,breakBefore:forceBreak||seg.breakBefore===true};
            }
            const p3=seg.p1,dx=p3.x-p0.x,dy=p3.y-p0.y;return{p0,c1:{x:p0.x+dx/3,y:p0.y+dy/3},c2:{x:p0.x+dx*2/3,y:p0.y+dy*2/3},p3,breakBefore:forceBreak||seg.breakBefore===true};
        }
        function appendExactRailRangeCubics(rail,start,length,out){
            if(!rail||!(rail.total>0)||!(length>1e-8))return false;const a=Math.max(0,Math.min(rail.total,Number(start)||0)),b=Math.max(a,Math.min(rail.total,a+(Number(length)||0)));if(b<=a+1e-8)return false;
            const first=exactLightningSegmentIndexAtDistance(rail,a),last=exactLightningSegmentIndexAtDistance(rail,Math.max(a,b-1e-10));if(first<0||last<first)return false;let wrote=false;
            for(let si=first;si<=last;si++){const seg=rail.segments[si],sa=seg._start,sb=sa+seg._length,oa=Math.max(a,sa),ob=Math.min(b,sb);if(ob<=oa+1e-10)continue;const t0=oa<=sa+1e-10?0:exactLightningParamAtDistance(seg,oa-sa),t1=ob>=sb-1e-10?1:exactLightningParamAtDistance(seg,ob-sa),cut=(t0<=1e-10&&t1>=1-1e-10)?seg:exactLightningSliceSegment(seg,t0,t1),c=glintSegmentToCubic(cut,!wrote||seg.breakBefore===true);if(c){out.push(c);wrote=true;}}
            return wrote;
        }
        function appendWrappedExactRailCubics(rail,start,length,out){
            if(!rail?.total||!(length>0))return;const total=rail.total;let a=Number(start)||0,remain=Math.min(Math.max(0,Number(length)||0),total);while(a<0)a+=total;while(a>=total)a-=total;while(remain>1e-8){const take=Math.min(remain,total-a);appendExactRailRangeCubics(rail,a,take,out);remain-=take;a=0;}
        }
        function buildBezierGlintPrepared(frameCtx,exactPaths,cfg,phase,now,layerIndex=-1){
            const type=effectiveGlintType(cfg),spectral=type==='spectral',cubics=[];let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,allExact=true;
            const rails=[];for(const path of exactPaths||[]){for(const p of path?.points||[]){const x=Number(p?.x),y=Number(p?.y);if(Number.isFinite(x)&&Number.isFinite(y)){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}}const rail=path?._exactLightningRail;if(rail?.total>0)rails.push({rail,path});else if((path?.points?.length||0)>1){allExact=false;if(spectral){const pts=path.points,n=path.closed?pts.length:pts.length-1;for(let i=0;i<n;i++){const a=pts[i],b=pts[(i+1)%pts.length],seg={type:'L',p0:a,p1:b,breakBefore:i===0};const c=glintSegmentToCubic(seg,i===0);if(c)cubics.push(c);}}}}
            if(!spectral&&!allExact)return null;
            if(!Number.isFinite(minX)){minX=minY=-1;maxX=maxY=1;}
            if(spectral){for(const item of rails){let first=true;for(const seg of item.rail.segments||[]){const c=glintSegmentToCubic(seg,first||seg.breakBefore===true);if(c){cubics.push(c);first=false;}}}}
            else{
                const mode=['perSegment','everyNth','across','perPath','whole'].includes(cfg?.mode)?cfg.mode:'whole';if(mode==='across')return null;
                const lenFrac=Math.max(.01,Math.min(1,audioApplyNumeric('sweep.length',Number(cfg?.lengthPercent)||18,layerIndex)/100));
                if(mode==='perSegment'||mode==='everyNth'){
                    const nth=Math.max(2,Math.min(24,Math.round(Number(cfg?.everyN)||2))),localPhase=1-Math.abs(2*phase-1);let global=0;
                    for(const item of rails){for(const seg of item.rail.segments||[]){const use=mode==='perSegment'||global%nth===0;global++;if(!use||!(seg._length>0))continue;const len=Math.max(1e-6,seg._length*lenFrac),center=localPhase*seg._length,a=Math.max(0,center-len*.5),b=Math.min(seg._length,center+len*.5);if(b<=a+1e-8)continue;const t0=exactLightningParamAtDistance(seg,a),t1=exactLightningParamAtDistance(seg,b),cut=exactLightningSliceSegment(seg,t0,t1),c=glintSegmentToCubic(cut,true);if(c)cubics.push(c);}}
                }else if(mode==='perPath'){
                    for(const item of rails){const total=item.rail.total,len=Math.min(total,Math.max(2,total*lenFrac)),start=phase*total-len*.5;appendWrappedExactRailCubics(item.rail,start,len,cubics);}
                }else{
                    let total=0;const ranges=[];for(const item of rails){ranges.push({rail:item.rail,start:total,length:item.rail.total});total+=item.rail.total;}if(total>0){const len=Math.min(total,Math.max(2,total*lenFrac)),startAt=phase*total-len*.5;for(let wrap=-1;wrap<=1;wrap++){const a=startAt+wrap*total,b=a+len;for(const r of ranges){const ia=Math.max(a,r.start),ib=Math.min(b,r.start+r.length);if(ib>ia)appendExactRailRangeCubics(r.rail,ia-r.start,ib-ia,cubics);}}}
                }
            }
            if(!cubics.length)return null;const data=new Float32Array(cubics.length*8),cubicBreaks=new Uint8Array(cubics.length);let o=0,ci=0;const path2d=typeof Path2D!=='undefined'?new Path2D():null;let prev=null;
            for(const c of cubics){cubicBreaks[ci++]=c.breakBefore===true?1:0;data[o++]=c.p0.x;data[o++]=c.p0.y;data[o++]=c.c1.x;data[o++]=c.c1.y;data[o++]=c.c2.x;data[o++]=c.c2.y;data[o++]=c.p3.x;data[o++]=c.p3.y;if(path2d){if(c.breakBefore||!prev||Math.hypot(c.p0.x-prev.x,c.p0.y-prev.y)>1e-7)path2d.moveTo(c.p0.x,c.p0.y);path2d.bezierCurveTo(c.c1.x,c.c1.y,c.c2.x,c.c2.y,c.p3.x,c.p3.y);}prev=c.p3;}
            const spectralAudioPrefix=cfg?._lightningSpectralAudio===true?'lightning':'sweep',sectorDeg=Math.max(1,Math.min(360,audioApplyNumeric(`${spectralAudioPrefix}.spectralSector`,Number.isFinite(Number(cfg?.spectralSectorDegrees))?Number(cfg.spectralSectorDegrees):45,layerIndex))),speedDeg=Math.max(-720,Math.min(720,audioApplyNumeric(`${spectralAudioPrefix}.spectralSpeed`,Number.isFinite(Number(cfg?.spectralAngularSpeed))?Number(cfg.spectralAngularSpeed):90,layerIndex)));
            const cx=(minX+maxX)*.5,cy=(minY+maxY)*.5,progress=Math.max(0,Math.min(1,Number(phase)||0)),baseDir=cfg?.direction==='backward'?-1:1,speedDir=speedDeg<0?-1:1,direction=baseDir*speedDir,first=cubics[0]?.p0,startAngle=first?Math.atan2(first.y-cy,first.x-cx):0;
            // Spectral is tied to the effect cycle rather than wall-clock degrees/second.  One
            // cycle performs one lap, and the sector never wraps over the seam into geometry
            // that was already visited earlier in that same lap.
            return{bezierGlint:true,glintType:type,spectral,spectralCycleLocked:spectral===true,spectralProgress:progress,spectralDirection:direction,spectralStartAngle:startAngle,cubicData:data,cubicBreaks,cubicCount:cubics.length,path2d,centerX:cx,centerY:cy,sectorSpanAngle:sectorDeg*Math.PI/180,sectorDegrees:sectorDeg,angularSpeed:speedDeg,maskRadius:Math.max(10000,Math.hypot(maxX-minX,maxY-minY)*8+1000)};
        }

        function getLightningFlashLengthPercent(cfg,layerIndex=-1){
            const sharedBefore=Number(cfg?.lengthPercent),legacyBefore=Number(cfg?.lightningFlashLengthPercent),baseBefore=Number.isFinite(sharedBefore)?sharedBefore:(Number.isFinite(legacyBefore)?legacyBefore:18);
            migrateSharedSweepGlintConfig(cfg);
            const shared=Number(cfg?.lengthPercent),base=Number.isFinite(sharedBefore)?shared:(Number.isFinite(legacyBefore)?legacyBefore:(Number.isFinite(shared)?shared:baseBefore));
            return Math.max(1,Math.min(100,audioApplyNumeric('lightning.flashLength',base,layerIndex)));
        }
        function lightningSmooth01(value){
            const t=Math.max(0,Math.min(1,Number(value)||0));
            return t*t*t*(t*(t*6-15)+10);
        }
        function sliceLightningPieceWindow(piece,startFrac,endFrac){
            const n=piece?.length||0;if(n<2)return null;
            const last=n-1,a=Math.max(0,Math.min(1,Number(startFrac)||0))*last,b=Math.max(0,Math.min(1,Number(endFrac)||0))*last;
            if(!(b>a+1e-7))return null;
            const at=(pos)=>{const i=Math.max(0,Math.min(last-1,Math.floor(pos))),u=Math.max(0,Math.min(1,pos-i)),p=piece[i],q=piece[Math.min(last,i+1)],px=Number(p?.x)||0,py=Number(p?.y)||0;return{x:px+((Number(q?.x)||0)-px)*u,y:py+((Number(q?.y)||0)-py)*u};};
            const out=[at(a)],from=Math.max(1,Math.ceil(a+1e-7)),to=Math.min(last-1,Math.floor(b-1e-7));
            for(let i=from;i<=to;i++)out.push(piece[i]);
            out.push(at(b));
            return out;
        }
        function buildLightningPrechargePieces(pieces,t,cfg,layerIndex=-1){
            const frac=getLightningFlashLengthPercent(cfg,layerIndex)/100,travel=lightningSmooth01(t),start=frac>=.999999?0:(1-frac)*travel,end=Math.min(1,start+frac),out=[];
            for(const piece of pieces||[]){const cut=sliceLightningPieceWindow(piece,start,end);if(cut?.length>1)out.push(cut);}
            return out;
        }
        function lightningSamplingProfile(cfg,maxSamples=90){
            const precision=normalizeLightningPrecisionValue(cfg?.lightningPrecision);
            // v423: Exact no longer earns quality by brute-force density. Its normal path is
            // command-preserving spline trim + adaptive GPU flattening. These limits are only
            // a fallback (notably X-band/across mode and native sampled spirals).
            if(precision==='exact')return{precision,step:1.05,cap:Math.max(448,maxSamples*5),adaptiveSpline:true};
            return{precision,step:1.35,cap:Math.max(384,maxSamples*6)};
        }
        function sampleLightningRange(table,start,length,maxSamples=90,scratch=null,cfg=null){
            if(!table||!(table.total>0)||!(length>1e-6))return scratch?null:[];
            const a=Math.max(0,Math.min(table.total,start)),b=Math.max(a,Math.min(table.total,start+length));
            if(b-a<=1e-6)return scratch?null:[];
            const sampling=lightningSamplingProfile(cfg,maxSamples);
            const n=Math.max(3,Math.min(sampling.cap,Math.ceil((b-a)/sampling.step)));
            const pts=scratch?acquireEffectPiece(scratch):[];
            for(let i=0;i<=n;i++){
                const d=a+(b-a)*(i/n);
                if(scratch) effectPointAt(pts,i,table,d); else pts.push(pointAtPathDistance(table,d));
            }
            pts.length=n+1;
            return pts;
        }
        function getLightningModePieces(paths,layer,scratch=null,cfg=currentSweepConfig(layer),layerIndex=-1){
            const mode=['perSegment','everyNth','across','perPath','whole'].includes(cfg.lightningMode)?cfg.lightningMode:'perSegment';
            const frac=Math.max(.01,Math.min(1,(audioApplyNumeric('lightning.segment',Number(cfg.lightningSegmentPercent)||100,layerIndex))/100));
            const random=cfg.lightningRandomPosition===true, cycle=Math.max(0,Math.round(Number(cfg.lightningCycleCount)||0));
            const pieces=scratch?resetEffectPieceScratch(scratch).pieces:[];
            if(mode==='across'){
                let minX=Infinity,maxX=-Infinity;
                for(const pth of paths||[])for(const p of pth?.points||[]){if(Number.isFinite(p.x)){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);}}
                if(!(maxX>minX))return pieces;
                const span=maxX-minX,band=Math.max(1,span*frac),half=band*.5;
                const cx=random ? minX+half+sweepStableUnit(cycle+917)*(Math.max(0,span-band)) : (minX+maxX)*.5;
                for(const pth of paths||[]){
                    const pts=pth?.points||[];if(pts.length<2)continue;const count=pth.closed?pts.length:pts.length-1;
                    for(let i=0;i<count;i++){
                        const a=pts[i],b=pts[(i+1)%pts.length],len=Math.hypot(b.x-a.x,b.y-a.y);if(len<1e-6)continue;
                        const sampling=lightningSamplingProfile(cfg,64),n=Math.max(2,Math.min(sampling.cap,Math.ceil(len/sampling.step)));let run=null,write=0;
                        const flush=()=>{if(run&&write>1){run.length=write;pieces.push(run);}run=null;write=0;};
                        for(let j=0;j<=n;j++){
                            const u=j/n,x=a.x+(b.x-a.x)*u,y=a.y+(b.y-a.y)*u;
                            if(Math.abs(x-cx)<=half){
                                if(!run)run=scratch?acquireEffectPiece(scratch):[];
                                if(scratch)effectXYAt(run,write++,x,y);else{run.push({x,y});write=run.length;}
                            }else flush();
                        }
                        flush();
                    }
                }
                return pieces;
            }
            if(mode==='perSegment'||mode==='everyNth'){
                const nth=Math.max(2,Math.min(24,Math.round(Number(cfg.lightningEveryN)||2)));let global=0;
                for(let pi=0;pi<(paths||[]).length;pi++){
                    const {table,segments}=getSweepSegmentsForPath(paths[pi],layer);
                    for(const seg of segments){const use=mode==='perSegment'||(global%nth===0);const salt=global++;if(!use)continue;const len=Math.max(.5,seg.length*frac),room=Math.max(0,seg.length-len),off=random?sweepStableUnit(cycle*4099+salt*131+17)*room:0;const pts=sampleLightningRange(table,seg.start+off,len,64,scratch,cfg);if(pts?.length>1)pieces.push(pts);}
                }
                return pieces;
            }
            if(mode==='perPath'){
                for(let pi=0;pi<(paths||[]).length;pi++){const table=buildPathLengthTable([paths[pi]]);if(!(table.total>0))continue;const len=table.total*frac,room=Math.max(0,table.total-len),off=random?sweepStableUnit(cycle*4099+pi*271+31)*room:0;const pts=sampleLightningRange(table,off,len,96,scratch,cfg);if(pts?.length>1)pieces.push(pts);}return pieces;
            }
            // whole figure: distribute a single active perimeter range over paths without
            // ever drawing an artificial bridge through empty space.
            const infos=scratch?scratch.infos:[];let total=0;
            for(let pi=0;pi<(paths||[]).length;pi++){const table=buildPathLengthTable([paths[pi]]);if(table.total>0){if(scratch)acquireEffectInfo(scratch,table,total,pi);else infos.push({table,start:total,pi});total+=table.total;}}
            if(!(total>0))return pieces;const len=total*frac,room=Math.max(0,total-len),off=random?sweepStableUnit(cycle*4099+73)*room:0,end=off+len;
            for(const info of infos){const a=Math.max(off,info.start),b=Math.min(end,info.start+info.table.total);if(b>a){const pts=sampleLightningRange(info.table,a-info.start,b-a,112,scratch,cfg);if(pts?.length>1)pieces.push(pts);}}
            return pieces;
        }
        function effectSourceColor(color,brightness=1){
            const rgb=GPUColorCache.rgb(color||'#ffffff'),b=Math.max(0,Number(brightness)||0);let r=rgb[0],g=rgb[1],bl=rgb[2];
            if(b<=1){r*=b;g*=b;bl*=b;}else{const t=Math.min(1,b-1);r=r+(1-r)*t;g=g+(1-g)*t;bl=bl+(1-bl)*t;}
            return `rgb(${Math.round(Math.max(0,Math.min(1,r))*255)},${Math.round(Math.max(0,Math.min(1,g))*255)},${Math.round(Math.max(0,Math.min(1,bl))*255)})`;
        }
        function getGlintVisualSettings(cfg=currentSweepConfig(),layerIndex=-1){
            migrateSharedSweepGlintConfig(cfg);
            const glowBase=Math.max(0,audioApplyNumeric('sweep.glow',Number.isFinite(Number(cfg.glow))?Number(cfg.glow):18,layerIndex));
            const glowMultiplier=Math.max(0,Number.isFinite(Number(cfg.glowMultiplier))?Number(cfg.glowMultiplier):1);
            const intensityBase=Math.max(0,Math.min(400,audioApplyNumeric('sweep.glowIntensity',Number.isFinite(Number(cfg.glowIntensity))?Number(cfg.glowIntensity):100,layerIndex)));
            const intensityMultiplier=Math.max(0,Number.isFinite(Number(cfg.glowIntensityMultiplier))?Number(cfg.glowIntensityMultiplier):1);
            // Brightness is deliberately a GLOW-only control.  Core alpha is authored only by
            // opacity and core thickness only by widthPercent; neither is secretly overdriven.
            const brightness=Math.max(0,Math.min(8,audioApplyNumeric('sweep.brightness',Number.isFinite(Number(cfg.brightness))?Number(cfg.brightness):100,layerIndex)/100));
            const opacity=Math.max(0,Math.min(100,audioApplyNumeric('sweep.opacity',Number.isFinite(Number(cfg.opacity))?Number(cfg.opacity):100,layerIndex)))/100;
            const softnessBase=Math.max(0,Math.min(150,audioApplyNumeric('sweep.softness',Number.isFinite(Number(cfg.softness))?Number(cfg.softness):100,layerIndex)));
            const softnessMultiplier=Math.max(0,Number.isFinite(Number(cfg.softnessMultiplier))?Number(cfg.softnessMultiplier):1);
            const softness=Math.max(0,Math.min(1.5,(softnessBase*softnessMultiplier)/100));
            return {glowSize:Math.max(0,glowBase*glowMultiplier),strength:Math.max(0,(intensityBase/100)*intensityMultiplier),brightness,softness,opacity};
        }
        function lightningUsesGlintVisual(cfg){return cfg?.lightningUseGlintMultiplier!==false;}
        function getLightningVisualSettings(cfg=currentSweepConfig(),layerIndex=-1){
            migrateSharedSweepGlintConfig(cfg);
            if(lightningUsesGlintVisual(cfg)){
                const base=getGlintVisualSettings(cfg,layerIndex),mult=Math.max(0,Number.isFinite(Number(cfg.lightningGlintMultiplier))?Number(cfg.lightningGlintMultiplier):2);
                return{glowSize:base.glowSize*mult,strength:base.strength*mult,brightness:base.brightness*mult,softness:base.softness,linked:true,multiplier:mult};
            }
            const glowBase=Math.max(0,audioApplyNumeric('lightning.glow',Number.isFinite(Number(cfg.lightningGlow))?Number(cfg.lightningGlow):16,layerIndex));
            const glowMult=Math.max(0,Number.isFinite(Number(cfg.lightningGlowMultiplier))?Number(cfg.lightningGlowMultiplier):1);
            const intensityBase=Math.max(0,audioApplyNumeric('lightning.intensity',Number.isFinite(Number(cfg.lightningGlowIntensity))?Number(cfg.lightningGlowIntensity):100,layerIndex)/100);
            const intensityMult=Math.max(0,Number.isFinite(Number(cfg.lightningGlowIntensityMultiplier))?Number(cfg.lightningGlowIntensityMultiplier):1);
            const brightness=Math.max(0,Math.min(8,audioApplyNumeric('lightning.brightness',Number.isFinite(Number(cfg.lightningBrightness))?Number(cfg.lightningBrightness):100,layerIndex)/100));
            const softnessBase=Math.max(0,Math.min(150,audioApplyNumeric('lightning.softness',Number.isFinite(Number(cfg.lightningSoftness))?Number(cfg.lightningSoftness):100,layerIndex)));
            const softnessMult=Math.max(0,Number.isFinite(Number(cfg.lightningSoftnessMultiplier))?Number(cfg.lightningSoftnessMultiplier):1);
            return{glowSize:glowBase*glowMult,strength:Math.min(32,intensityBase*intensityMult),brightness,softness:Math.max(0,Math.min(1.5,(softnessBase*softnessMult)/100)),linked:false,multiplier:1};
        }
        function getLightningPreflashSettings(cfg=currentSweepConfig(),layerIndex=-1){
            migrateSharedSweepGlintConfig(cfg);const visual=getGlintVisualSettings(cfg,layerIndex);
            const widthRaw=audioApplyNumeric('sweep.width',Number.isFinite(Number(cfg.widthPercent))?Number(cfg.widthPercent):75,layerIndex),widthPercent=Number.isFinite(widthRaw)?Math.max(0,Math.min(200,widthRaw)):75;
            return{...visual,widthPercent,color:cfg.color||'#ffffff'};
        }
        function strokeCurrentGlintPath(ctx,cfg,alpha,preparedVisual=null,preparedPath=null){
            const vis=preparedVisual||getGlintVisualSettings(cfg),baseWidth=Math.max(.15,Number(ctx.lineWidth)||.15),a=Math.max(0,Number(alpha)||0),coreA=a*Math.max(0,Math.min(1,Number.isFinite(Number(vis.opacity))?Number(vis.opacity):1));
            // The glow owns brightness/intensity/size/softness. Core owns only opacity and
            // thickness, so changing glow controls can never secretly fatten or bleach it.
            if(vis.glowSize>.001&&vis.strength>.001&&vis.brightness>.001){
                ctx.globalCompositeOperation=sweepBlendCanvasOperation(sweepGlowBlendMode(cfg));
                ctx.shadowColor=cfg.color||'#ffffff';ctx.shadowBlur=vis.glowSize;ctx.lineWidth=baseWidth;
                const softGain=.55+.45*Math.max(0,Math.min(1.5,vis.softness)),totalEnergy=Math.max(0,a*.55*vis.strength*vis.brightness*softGain),passes=totalEnergy>1.8?3:(totalEnergy>.9?2:1),perPass=Math.max(0,Math.min(1,totalEnergy/passes));
                for(let i=0;i<passes;i++){ctx.globalAlpha=perPass;if(preparedPath)ctx.stroke(preparedPath);else ctx.stroke();}
            }
            ctx.shadowBlur=0;ctx.lineWidth=baseWidth;ctx.globalCompositeOperation=sweepBlendCanvasOperation(sweepCoreBlendMode(cfg));
            ctx.strokeStyle=cfg.color||'#ffffff';ctx.globalAlpha=Math.max(0,Math.min(1,coreA));
            if(preparedPath)ctx.stroke(preparedPath);else ctx.stroke();
        }
        function drawBezierGlintPrepared(ctx,prepared,cfg,lineWidth,visual,alpha){
            if(!prepared?.path2d)return false;const vis=visual||getGlintVisualSettings(cfg),a=Math.max(0,Number(alpha)||0);if(a<=.0001)return true;
            ctx.save();try{
                if(prepared.spectral===true){
                    const r=Math.max(1,Number(prepared.maskRadius)||10000),cx=Number(prepared.centerX)||0,cy=Number(prepared.centerY)||0,start=Number(prepared.spectralStartAngle)||0,progress=Math.max(0,Math.min(1,Number(prepared.spectralProgress)||0)),span=Math.max(.0001,Math.min(Math.PI*2,Number(prepared.sectorSpanAngle)||Math.PI/4)),dir=Number(prepared.spectralDirection)<0?-1:1,head=progress*Math.PI*2,tail=Math.max(0,head-span);
                    if(head<=1e-7){ctx.beginPath();ctx.rect(0,0,0,0);ctx.clip();}
                    else{const a0=start+dir*tail,a1=start+dir*head;ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,a0,a1,dir<0);ctx.closePath();ctx.clip();}
                }
                ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=cfg?.color||'#ffffff';ctx.lineWidth=Math.max(.8,Number(lineWidth)||1);ctx.shadowBlur=0;
                strokeCurrentGlintPath(ctx,cfg,a,vis,prepared.path2d);return true;
            }finally{ctx.restore();}
        }

        function getSweepMotionPhase(now=performance.now(),cfg=currentSweepConfig()){
            if(!Number.isFinite(cfg.phase))cfg.phase=0;if(!Number.isFinite(cfg.cycleCount))cfg.cycleCount=0;
            const target=getSweepTargetVelocity(cfg);if(!(cfg.lastUpdate>0)){cfg.lastUpdate=now;cfg.currentVelocity=target;return((cfg.phase%1)+1)%1;}
            const dt=Math.max(0,(now-cfg.lastUpdate)/1000);cfg.lastUpdate=now;
            // v527: do not clamp a normal slow frame to 80 ms. Clamping made sweep/glint
            // advance less physical time exactly when FPS dipped, so the effect visibly
            // changed speed as the renderer recovered.  The velocity follower is a first-order
            // system, so integrate it analytically over the complete frame interval.  Only a
            // multi-second background-tab gap is treated as a re-anchor to avoid a giant jump.
            let v0=Number.isFinite(cfg.currentVelocity)?cfg.currentVelocity:target;if(dt>2){cfg.currentVelocity=target;return((cfg.phase%1)+1)%1;}
            const tau=.32,e=Math.exp(-dt/tau),v1=target+(v0-target)*e,advance=target*dt+(v0-target)*tau*(1-e);cfg.currentVelocity=v1;
            const raw=cfg.phase+advance;if(advance>=0&&raw>=1)cfg.cycleCount+=Math.floor(raw);else if(advance<0&&raw<0)cfg.cycleCount+=Math.ceil(-raw);cfg.phase=((raw%1)+1)%1;return cfg.phase;
        }
        function getLightningRateFactor(cfg=currentSweepConfig(),layerIndex=-1){
            const rawPct=audioApplyNumeric('lightning.rate',Number.isFinite(Number(cfg.lightningRatePercent))?Number(cfg.lightningRatePercent):100,layerIndex);
            const pct=Math.max(0,Math.min(100,Number.isFinite(Number(rawPct))?Number(rawPct):100));
            const rawMult=Number(cfg.lightningRateMultiplier);
            const mult=Number.isFinite(rawMult)?Math.max(0,rawMult):1;
            // v162: 100% × 1 intentionally runs at one quarter of the former standard lightning strike rate.
            return (pct/100)*mult*0.25;
        }
        // v421: Lightning frequency can run from one project-wide synchronized clock.
        // With synchronization OFF every persistent layer keeps the independent v419 clock.
        // The synchronized clock snapshots the active Lightning speed basis, but deliberately
        // ignores per-layer audio routes so one layer cannot drift away from the shared strike.
        const lightningClockRuntimeByLayer=new Map();
        const lightningSharedClockRuntime={phase:0,lastUpdate:0,cycleCount:0,rateConfig:null};
        function lightningRateSyncEnabled(){return state.lightningRateSync!==false;}
        function normalizeLightningRatePercent(value){const v=Number(value);return Number.isFinite(v)?Math.max(0,Math.min(100,v)):100;}
        function normalizeLightningRateMultiplier(value){const v=Number(value);return Number.isFinite(v)?Math.max(0,v):8;}
        function captureLightningSyncRateConfig(cfg=currentSweepConfig()){
            const source=cfg&&typeof cfg==='object'?cfg:state.sweep;
            const snap={
                speed:Math.max(.02,Math.min(2,Number(source?.speed)||.25)),
                speedMultiplier:Math.max(.015625,Math.min(64,Number(source?.speedMultiplier)||1)),
                syncMusic:source?.syncMusic!==false,
                direction:source?.direction==='backward'?'backward':'forward',
                lightningRatePercent:normalizeLightningRatePercent(source?.lightningRatePercent),
                lightningRateMultiplier:normalizeLightningRateMultiplier(source?.lightningRateMultiplier)
            };
            lightningSharedClockRuntime.rateConfig=snap;
            return snap;
        }
        function syncLightningRateValuesFrom(cfg=currentSweepConfig()){
            const pct=normalizeLightningRatePercent(cfg?.lightningRatePercent),mult=normalizeLightningRateMultiplier(cfg?.lightningRateMultiplier);
            if(state.sweep&&typeof state.sweep==='object'){state.sweep.lightningRatePercent=pct;state.sweep.lightningRateMultiplier=mult;}
            for(const layer of state.layers||[]){const c=getLayerSweepConfig(layer);c.lightningRatePercent=pct;c.lightningRateMultiplier=mult;}
            const snap=captureLightningSyncRateConfig(cfg);snap.lightningRatePercent=pct;snap.lightningRateMultiplier=mult;
            return snap;
        }
        function getLightningCycleRateHz(cfg=currentSweepConfig(),layerIndex=-1){
            const baseHz=Math.abs(getSweepTargetVelocity(cfg));
            return Math.max(0,baseHz*getLightningRateFactor(cfg,layerIndex));
        }
        function getSynchronizedLightningCycleRateHz(fallbackCfg=currentSweepConfig()){
            const cfg=lightningSharedClockRuntime.rateConfig||captureLightningSyncRateConfig(fallbackCfg);
            return getLightningCycleRateHz(cfg,-1);
        }
        function resetLightningSharedClock(phase=0,cycleCount=0){
            lightningSharedClockRuntime.phase=((Number(phase)||0)%1+1)%1;
            lightningSharedClockRuntime.lastUpdate=0;
            lightningSharedClockRuntime.cycleCount=Math.max(0,Math.round(Number(cycleCount)||0));
        }
        function resetLightningClock(layerIndex=-1,cfg=null,phase=0){
            const key=Number.isInteger(layerIndex)&&layerIndex>=0?layerIndex:(cfg&&typeof cfg==='object'?cfg:'default');
            const p=((Number(phase)||0)%1+1)%1;
            lightningClockRuntimeByLayer.set(key,{phase:p,lastUpdate:0,cycleCount:0});
            if(cfg&&typeof cfg==='object'){cfg.lightningPhase=p;cfg.lightningLastUpdate=0;cfg.lightningCycleCount=0;}
        }
        function setLightningRateSynchronization(enabled,cfg=currentSweepConfig(),layerIndex=-1){
            const next=enabled===true,prev=lightningRateSyncEnabled();
            if(next===prev){
                state.lightningRateSync=next;
                if(next)syncLightningRateValuesFrom(cfg);
                return next;
            }
            if(next){
                const key=Number.isInteger(layerIndex)&&layerIndex>=0?layerIndex:(cfg&&typeof cfg==='object'?cfg:'default');
                const rt=lightningClockRuntimeByLayer.get(key);
                const phase=rt?rt.phase:((Number(cfg?.lightningPhase)||0)%1+1)%1;
                const cycles=rt?rt.cycleCount:Math.max(0,Math.round(Number(cfg?.lightningCycleCount)||0));
                state.lightningRateSync=true;
                syncLightningRateValuesFrom(cfg);
                resetLightningSharedClock(phase,cycles);
            }else{
                const phase=lightningSharedClockRuntime.phase,cycles=lightningSharedClockRuntime.cycleCount;
                state.lightningRateSync=false;
                lightningClockRuntimeByLayer.clear();
                for(let i=0;i<(state.layers||[]).length;i++){
                    const c=getLayerSweepConfig(state.layers[i]);
                    lightningClockRuntimeByLayer.set(i,{phase,lastUpdate:0,cycleCount:cycles});
                    c.lightningPhase=phase;c.lightningLastUpdate=0;c.lightningCycleCount=cycles;
                }
            }
            return next;
        }
        function resetLightningRateRuntimeForProject(syncSource=null){
            lightningClockRuntimeByLayer.clear();
            lightningSharedClockRuntime.rateConfig=null;
            const source=syncSource&&typeof syncSource==='object'?syncSource:(state.sweep||createDefaultSweepConfig());
            const phase=((Number(source?.lightningPhase)||0)%1+1)%1,cycles=Math.max(0,Math.round(Number(source?.lightningCycleCount)||0));
            resetLightningSharedClock(phase,cycles);
            if(lightningRateSyncEnabled())syncLightningRateValuesFrom(source);else captureLightningSyncRateConfig(source);
        }
        function advanceLightningClock(rt,now,rateHz){
            if(!(rateHz>1e-7)){rt.phase=0;rt.lastUpdate=now;return rt.phase;}
            if(!(rt.lastUpdate>0)){rt.lastUpdate=now;return rt.phase;}
            const dt=Math.max(0,(now-rt.lastUpdate)/1000);rt.lastUpdate=now;
            // v527: lightning cadence is wall-clock based, not frame-count based. A 120 ms
            // clamp made a single expensive spiral frame permanently delay the strike clock.
            // Preserve every ordinary dropped-frame millisecond; only ignore a true background
            // pause (>2 s), where jumping across many random strikes would look worse.
            if(dt>2)return rt.phase;
            const raw=rt.phase+rateHz*dt,wraps=Math.floor(raw);
            if(wraps>0)rt.cycleCount+=wraps;
            rt.phase=raw-wraps;
            return rt.phase;
        }
        function getLightningMotionPhase(now=performance.now(),cfg=currentSweepConfig(),layerIndex=-1){
            if(lightningRateSyncEnabled()){
                const rt=lightningSharedClockRuntime,phase=advanceLightningClock(rt,now,getSynchronizedLightningCycleRateHz(cfg));
                if(cfg){cfg.lightningPhase=phase;cfg.lightningLastUpdate=now;cfg.lightningCycleCount=rt.cycleCount;}
                return phase;
            }
            const key=Number.isInteger(layerIndex)&&layerIndex>=0?layerIndex:(cfg&&typeof cfg==='object'?cfg:'default');
            let rt=lightningClockRuntimeByLayer.get(key);
            if(!rt){rt={phase:((Number(cfg?.lightningPhase)||0)%1+1)%1,lastUpdate:0,cycleCount:Math.max(0,Math.round(Number(cfg?.lightningCycleCount)||0))};lightningClockRuntimeByLayer.set(key,rt);}
            const phase=advanceLightningClock(rt,now,getLightningCycleRateHz(cfg,layerIndex));
            if(cfg){cfg.lightningPhase=phase;cfg.lightningLastUpdate=now;cfg.lightningCycleCount=rt.cycleCount;}
            return phase;
        }
        function lightningPiecesPath(pieces){
            const path=new Path2D();
            for(const pts of pieces||[]){if(!pts||pts.length<2)continue;path.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++)path.lineTo(pts[i].x,pts[i].y);}
            return path;
        }
        function drawLightningUniformPath(ctx,path,color,width,alpha,glow=0,composite='source-over'){
            if(!path||alpha<=.001||width<=0)return;
            ctx.save();ctx.globalCompositeOperation=composite;ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=Math.max(.15,width);ctx.strokeStyle=color||'#ffffff';
            // v84: lightning never uses Canvas2D shadowBlur. A 100+ px shadowBlur is
            // disproportionately expensive because the browser performs a large pixel
            // convolution for every stroke and every corridor copy. `glow` is retained
            // in the signature for compatibility, but the soft halo is produced by
            // cheap nested vector strokes in drawLightningHaloPath().
            ctx.shadowBlur=0;ctx.globalAlpha=Math.max(0,Math.min(1,alpha));ctx.stroke(path);ctx.restore();
        }
        // v175: UI exposes the inverse as “Растровая молния” for compatibility with
        // existing projects: raster checkbox ON <=> lightningSmoothLighting === false.
        // The OFF state is the high-quality, denser vector-halo path.
        function drawLightningHaloPath(ctx,path,color,coreWidth,alpha,glowRadius,smoothLighting=false,softness=1,composite='lighter'){
            if(!path||alpha<=.001||coreWidth<=0)return;
            const r=Math.max(0,Number(glowRadius)||0);
            if(r<=.1)return;
            // Legacy mode intentionally keeps the original four discrete vector bands.
            // Smooth mode still remains 100% vector: it simply uses more, thinner
            // concentric strokes with a continuous falloff. No bitmap and no shadowBlur.
            const visualR=lightningVisualGlowRadius(r),softN=Math.max(0,Math.min(1.5,Number(softness)||0));
            ctx.save();ctx.globalCompositeOperation=composite;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=color||'#ffffff';ctx.shadowBlur=0;
            if(smoothLighting===true){
                // v424: keep the smooth radial law but spend bands only when they are
                // visible. Small/dim halos need far fewer vector strokes; large bright halos
                // retain up to 16. Weight is energy-compensated against the old 20-band stack.
                const count=visualR>90&&alpha>.45?10:(visualR>48&&alpha>.28?9:(visualR>22?8:6)),energyScale=20/count;
                for(let i=0;i<count;i++){
                    const u=i/(count-1); // outer -> inner
                    const radiusFrac=1-(.88*u),softShape=.35+.65*Math.max(0,Math.min(1,softN));
                    const weight=(.004+.032*Math.pow(u,1.35+1.2*(1-softShape)))*energyScale*(.55+.45*softShape);
                    ctx.lineWidth=Math.max(.15,coreWidth+2*visualR*radiusFrac);
                    ctx.globalAlpha=Math.max(0,Math.min(1,alpha*weight));
                    if(ctx.globalAlpha>.0015)ctx.stroke(path);
                }
            }else{
                const softGain=.45+.55*Math.max(0,Math.min(1,softN));
                const bands=[
                    {w:coreWidth+visualR*2.00,a:.035*softGain},
                    {w:coreWidth+visualR*1.28,a:.070*softGain},
                    {w:coreWidth+visualR*.72,a:.12},
                    {w:coreWidth+visualR*.30,a:.18}
                ];
                for(const b of bands){ctx.lineWidth=Math.max(.15,b.w);ctx.globalAlpha=Math.max(0,Math.min(1,alpha*b.a));ctx.stroke(path);}
            }
            ctx.restore();
        }
        const lightningPreparedCache=new WeakMap();
        let lightningPreparedFrame=null;
        function getPreparedLightningFrame(paths,layer,now,cfg=currentSweepConfig(layer),layerIndex=-1){
            // A new random position is required only when random mode is enabled.
            // Otherwise a new lightning cycle does not change the selected geometry.
            const cycleKey=cfg.lightningRandomPosition===true?(Number(cfg.lightningCycleCount)||0):0;
            const signature=[cfg.lightningMode,cfg.lightningEveryN,cfg.lightningRandomPosition?1:0,cfg.lightningSegmentPercent,normalizeLightningPrecisionValue(cfg.lightningPrecision),cycleKey,layer?.N,layer?.K].join('|');
            const sameFrame=lightningPreparedFrame;
            if(sameFrame&&sameFrame.now===now&&sameFrame.paths===paths&&sameFrame.layer===layer&&sameFrame.signature===signature)return sameFrame;

            // Frame-pooled Morph geometry keeps the same Array identity while its points
            // are mutated on the next display frame. Never persist lightning pieces in a
            // WeakMap for that case: prepare them once for THIS frame using reusable
            // point buffers instead. Static geometry retains the cross-frame cache.
            const dynamicFramePaths=frameGeometryRuntime.active && Number(paths?._frameGeometryId)===frameGeometryRuntime.frameId;
            if(dynamicFramePaths){
                const scratch=getLightningDynamicScratch(layer);
                const visible=paths?._lightningRenderedRail===true?paths:prepareWebVisiblePaths(paths,layer);
                const exact=paths?._exactLightningSplineRail===true?exactLightningSelection(visible,layer,cfg,layerIndex):null;
                const pieces=exact?.pieces||getLightningModePieces(visible,layer,scratch,cfg,layerIndex);
                const data=scratch.data;
                data.now=now;data.paths=paths;data.layer=layer;data.signature=signature;data.visible=visible;data.pieces=pieces;data.exactRanges=exact?.ranges||null;
                data.strikePath=exact?.strikePath||lightningPiecesPath(pieces);data.prechargeT=NaN;data.prechargePath=null;data._insideClipPath=undefined;data._outsideClipPath=undefined;
                lightningPreparedFrame=data;
                return data;
            }

            // Static/path-cached geometry survives across animation frames.
            let cached=lightningPreparedCache.get(paths);
            if(cached&&cached.layer===layer&&cached.signature===signature){cached.now=now;cached.prechargeT=NaN;cached.prechargePath=null;lightningPreparedFrame=cached;return cached;}
            const visible=paths?._lightningRenderedRail===true?paths:prepareWebVisiblePaths(paths,layer);
            const exact=paths?._exactLightningSplineRail===true?exactLightningSelection(visible,layer,cfg,layerIndex):null;
            const pieces=exact?.pieces||getLightningModePieces(visible,layer,null,cfg,layerIndex);
            const data={now,paths,layer,signature,visible,pieces,exactRanges:exact?.ranges||null,strikePath:exact?.strikePath||lightningPiecesPath(pieces),prechargeT:NaN,prechargePath:null};
            lightningPreparedCache.set(paths,data);lightningPreparedFrame=data;return data;
        }
        // Somata 6.9 — microstrike count is intentionally unbounded in the UI/state.
        // For ordinary counts preserve the historical pulse stack exactly. For very large
        // counts, the MAX-union GPU path only needs the strongest pulse of each alternating
        // color parity; selecting those analytically keeps an arbitrary integer from turning
        // into an O(N) frame loop.
        function collectLightningMicroPulses(t,count,target=[]){
            target.length=0;const rawCount=Number(count),n=Number.isFinite(rawCount)?Math.max(0,Math.round(rawCount)):0;if(!n)return target;
            const evalPulse=(i)=>{if(i<0||i>=n)return null;const center=(i+1)/(n+1),pulse=Math.exp(-Math.pow((t-center)/.055,2))*Math.pow(1-center*.42,1.2);return pulse>.015?{index:i,intensity:pulse*.88}:null;};
            if(n<=64){for(let i=0;i<n;i++){const p=evalPulse(i);if(p)target.push(p);}return target;}
            const k=t*(n+1)-1,best=[null,null];
            for(let i=Math.max(0,Math.floor(k)-5);i<=Math.min(n-1,Math.ceil(k)+5);i++){const p=evalPulse(i);if(!p)continue;const parity=i&1;if(!best[parity]||p.intensity>best[parity].intensity)best[parity]=p;}
            if(best[0])target.push(best[0]);if(best[1])target.push(best[1]);return target;
        }
        function prepareLightningVectorFrame(layer,phase,prepared,layerIndex=-1,cfg=currentSweepConfig(layer)){
            const gpuArcResident=prepared?.gpuArcResident===true;
            if(!gpuArcResident&&!prepared?.pieces?.length)return null;
            migrateSharedSweepGlintConfig(cfg);
            const idx=Number.isInteger(layerIndex)?layerIndex:-1;
            const baseW=Math.max(.5,audioApplyNumeric('layer.strokeWidth',Number(layer?.strokeWidth)||1.5,idx)*getLayerStrokeWidthMultiplier(layer));
            const widthPct=Math.max(1,Math.min(100,audioApplyNumeric('lightning.width',Number(cfg.lightningWidthPercent)||64,idx)));
            const boltW=Math.max(.2,baseW*widthPct/100),strikeVis=getLightningVisualSettings(cfg,idx),preVis=getLightningPreflashSettings(cfg,idx);
            const glow=strikeVis.glowSize,glowIntensity=Math.min(32,strikeVis.strength),brightness=Math.max(0,strikeVis.brightness),softness=strikeVis.softness;
            const lineOpacity=Math.max(0,Math.min(1,audioApplyNumeric('lightning.lineOpacity',Number.isFinite(Number(cfg.lightningLineOpacity))?Number(cfg.lightningLineOpacity):100,idx)/100));
            const velocity=Math.max(.000001,lightningRateSyncEnabled()?getSynchronizedLightningCycleRateHz(cfg):getLightningCycleRateHz(cfg,idx));
            const cycleMs=1000/velocity;
            const strikeMs=Math.max(30,Math.min(700,audioApplyNumeric('lightning.duration',Number(cfg.lightningDurationMs)||120,idx)));
            const afterEnabled=cfg.lightningAfterglow!==false;
            const afterMs=afterEnabled?Math.max(0,Math.min(900,audioApplyNumeric('lightning.afterglowMs',Number(cfg.lightningAfterglowMs)||280,idx))):0;
            let strikeFrac=Math.max(.025,Math.min(.34,strikeMs/cycleMs));
            let afterFrac=Math.max(0,Math.min(.34,afterMs/cycleMs));
            if(strikeFrac+afterFrac>.68){const k=.68/(strikeFrac+afterFrac);strikeFrac*=k;afterFrac*=k;}
            const preEnd=Math.max(.18,1-strikeFrac-afterFrac),strikeEnd=preEnd+strikeFrac;
            const out={
                prepared,phase,cfg,baseW,boltW,glow,glowIntensity,brightness,softness,lineOpacity,smoothLighting:cfg.lightningSmoothLighting===true,precisionHigh:isHighPrecisionLightning(cfg),
                primary:cfg.lightningColor||'#ffffff',secondary:cfg.lightningSecondaryColor||'#7dd3fc',flash:preVis.color,flashOpacity:preVis.opacity,flashLength:getLightningFlashLengthPercent(cfg,idx)/100,
                strikePath:prepared.strikePath||(gpuArcResident?null:lightningPiecesPath(prepared.pieces)),
                showBase:cfg.lightningShowLines!==false&&getLayerLineVisible(layer)===false,
                stage:'idle',intensity:0,prechargePath:null,prechargeT:0,prechargeAlpha:0,prechargeWidth:0,microPulses:[]
            };
            if(phase<preEnd){
                const t=Math.max(0,Math.min(1,phase/preEnd));
                const exactPre=!gpuArcResident&&prepared.exactRanges?.length?buildExactLightningPrecharge(prepared,t,cfg,idx):null;
                const prechargePieces=gpuArcResident?null:(exactPre?.pieces||buildLightningPrechargePieces(prepared.pieces,t,cfg,idx));
                const path=gpuArcResident?null:(exactPre?.path||lightningPiecesPath(prechargePieces));
                out.stage='precharge';out.prechargePieces=prechargePieces;out.prechargePath=path;out.prechargeT=lightningSmooth01(t);
                // Shared Glint thickness is literal. No hidden 2 px / Lightning-width floor.
                out.prechargeWidth=Math.max(.15,baseW*preVis.widthPercent/100);
                out.prechargeAlpha=Math.pow(Math.max(0,Math.sin(Math.PI*t)),.72);
                out.prechargeBrightness=preVis.brightness;out.prechargeGlow=preVis.glowSize;out.prechargeGlowIntensity=preVis.strength;out.prechargeSoftness=preVis.softness;
                return out;
            }
            if(phase<strikeEnd){
                const t=Math.max(0,Math.min(1,(phase-preEnd)/Math.max(1e-6,strikeFrac)));
                const attack=lightningSmooth01(Math.min(1,t/.16)),release=lightningSmooth01(Math.min(1,(1-t)/.24));
                out.stage='strike';out.intensity=Math.max(0,Math.min(1,attack*(.26+.84*release)));return out;
            }
            if(afterFrac<=.0001)return out;
            const t=Math.max(0,Math.min(1,(phase-strikeEnd)/afterFrac));
            out.stage='after';out.intensity=.26*(1-lightningSmooth01(t));
            const count=Math.max(0,Math.round(audioApplyNumeric('lightning.microStrikes',Number(cfg.lightningMicroStrikes)||0,idx)));
            collectLightningMicroPulses(t,count,out.microPulses);
            return out;
        }
        function drawPreparedLightningVector(ctx,layer,alpha,frame,suppressBase=false){
            if(!frame||alpha<=.001)return;
            const aBase=Math.max(0,Math.min(1,alpha));
            if(frame.stage==='precharge'){
                const paGlow=aBase*Math.max(0,frame.prechargeAlpha||0),paCore=paGlow*Math.max(0,Math.min(1,Number.isFinite(Number(frame.flashOpacity))?Number(frame.flashOpacity):1));
                if(paGlow<=.001&&paCore<=.001)return;
                const color=frame.flash||'#ffffff',w=Math.max(.15,Number(frame.prechargeWidth)||.15),bright=Math.max(0,Number(frame.prechargeBrightness)||0);
                drawLightningHaloPath(ctx,frame.prechargePath,color,w,paGlow*frame.prechargeGlowIntensity*bright,frame.prechargeGlow,frame.smoothLighting,frame.prechargeSoftness,sweepBlendCanvasOperation(sweepGlowBlendMode(frame.cfg)));
                drawLightningUniformPath(ctx,frame.prechargePath,color,w*1.12,paCore*.32,0,sweepBlendCanvasOperation(sweepCoreBlendMode(frame.cfg)));
                drawLightningUniformPath(ctx,frame.prechargePath,color,w,paCore,0,sweepBlendCanvasOperation(sweepCoreBlendMode(frame.cfg)));
                return;
            }
            if(frame.stage==='idle')return;
            const paintStrike=(intensity,microIndex=-1)=>{
                const a=Math.max(0,Math.min(1,aBase*Math.max(0,intensity)));if(a<=.001)return;
                if(!suppressBase&&frame.showBase)drawLightningUniformPath(ctx,frame.strikePath,layer?.strokeColor||'#ffffff',frame.baseW,a*frame.lineOpacity,0,'source-over');
                const micro=microIndex>=0,outerColor=micro&&microIndex%2===0?frame.primary:frame.secondary,innerColor=micro&&microIndex%2===0?frame.secondary:frame.primary;
                const outerW=frame.precisionHigh?Math.max(frame.boltW+.22,frame.boltW*1.18):Math.max(frame.boltW+.7,frame.boltW*1.9),bright=Math.max(0,frame.brightness||0);
                drawLightningHaloPath(ctx,frame.strikePath,outerColor,outerW,a*.82*frame.glowIntensity*bright,frame.glow,frame.smoothLighting,frame.softness,sweepBlendCanvasOperation(sweepGlowBlendMode(frame.cfg)));
                // Lightning brightness is a glow-only parameter, matching the shared Glint contract.
                drawLightningUniformPath(ctx,frame.strikePath,outerColor,outerW,a*.34,0,sweepBlendCanvasOperation(sweepCoreBlendMode(frame.cfg)));
                drawLightningUniformPath(ctx,frame.strikePath,lightningBrightCoreColor(innerColor),frame.boltW,a,0,sweepBlendCanvasOperation(sweepCoreBlendMode(frame.cfg)));
            };
            paintStrike(frame.intensity,-1);
            if(frame.stage==='after')for(const pulse of frame.microPulses)paintStrike(pulse.intensity,pulse.index);
        }
        function drawLightningStrikePieces(ctx,pieces,layer,alpha,intensity=1,microIndex=-1,preparedPath=null,suppressBase=false,cfg=currentSweepConfig(layer),layerIndex=-1){
            const baseW=Math.max(.5,audioApplyNumeric('layer.strokeWidth',Number(layer?.strokeWidth)||1.5,layerIndex)*getLayerStrokeWidthMultiplier(layer));
            const widthPct=Math.max(1,Math.min(100,audioApplyNumeric('lightning.width',Number(cfg.lightningWidthPercent)||64,layerIndex))),boltW=Math.max(.2,baseW*widthPct/100);
            const primary=cfg.lightningColor||'#ffffff',secondary=cfg.lightningSecondaryColor||'#7dd3fc',vis=getLightningVisualSettings(cfg,layerIndex);
            const glow=vis.glowSize,glowIntensity=Math.min(32,vis.strength),brightness=Math.max(0,vis.brightness),softness=vis.softness;
            const a=Math.max(0,Math.min(1,alpha*Math.max(0,intensity)));if(a<=.001)return;
            const lineOpacity=Math.max(0,Math.min(1,audioApplyNumeric('lightning.lineOpacity',Number.isFinite(Number(cfg.lightningLineOpacity))?Number(cfg.lightningLineOpacity):100,layerIndex)/100));
            const showBase=!suppressBase && cfg.lightningShowLines!==false && getLayerLineVisible(layer)===false,path=preparedPath||lightningPiecesPath(pieces);
            if(showBase)drawLightningUniformPath(ctx,path,layer?.strokeColor||'#ffffff',baseW,a*lineOpacity,0,'source-over');
            const micro=microIndex>=0,outerColor=micro&&microIndex%2===0?primary:secondary,innerColor=micro&&microIndex%2===0?secondary:primary;
            const outerW=isHighPrecisionLightning(cfg)?Math.max(boltW+.22,boltW*1.18):Math.max(boltW+.7,boltW*1.9);
            drawLightningHaloPath(ctx,path,outerColor,outerW,a*.82*glowIntensity*brightness,glow,cfg.lightningSmoothLighting===true,softness,sweepBlendCanvasOperation(sweepGlowBlendMode(cfg)));
            drawLightningUniformPath(ctx,path,outerColor,outerW,a*.34,0,sweepBlendCanvasOperation(sweepCoreBlendMode(cfg)));
            drawLightningUniformPath(ctx,path,lightningBrightCoreColor(innerColor),boltW,a,0,sweepBlendCanvasOperation(sweepCoreBlendMode(cfg)));
        }
        function drawLightningPrechargePieces(ctx,pieces,layer,alpha,t,prepared=null,cfg=currentSweepConfig(layer),layerIndex=-1){
            const baseW=Math.max(.5,audioApplyNumeric('layer.strokeWidth',Number(layer?.strokeWidth)||1.5,layerIndex)*getLayerStrokeWidthMultiplier(layer)),pre=getLightningPreflashSettings(cfg,layerIndex);
            const tt=Math.max(0,Math.min(1,Number(t)||0)),flashPieces=buildLightningPrechargePieces(pieces,tt,cfg,layerIndex),path=lightningPiecesPath(flashPieces);
            const w=Math.max(.15,baseW*pre.widthPercent/100),env=Math.pow(Math.max(0,Math.sin(Math.PI*tt)),.72),paGlow=Math.max(0,alpha*env),paCore=paGlow*pre.opacity;
            drawLightningHaloPath(ctx,path,pre.color,w,paGlow*pre.strength*pre.brightness,pre.glowSize,cfg.lightningSmoothLighting===true,pre.softness,sweepBlendCanvasOperation(sweepGlowBlendMode(cfg)));
            drawLightningUniformPath(ctx,path,pre.color,w*1.12,paCore*.32,0,sweepBlendCanvasOperation(sweepCoreBlendMode(cfg)));
            drawLightningUniformPath(ctx,path,pre.color,w,paCore,0,sweepBlendCanvasOperation(sweepCoreBlendMode(cfg)));
        }
        function drawSweepLightning(ctx,visible,layer,alpha,phase,prepared=null,suppressBase=false,cfg=currentSweepConfig(layer),layerIndex=-1){
            const velocity=Math.max(.000001,lightningRateSyncEnabled()?getSynchronizedLightningCycleRateHz(cfg):getLightningCycleRateHz(cfg,layerIndex));
            const cycleMs=1000/velocity,strikeMs=Math.max(30,Math.min(700,audioApplyNumeric('lightning.duration',Number(cfg.lightningDurationMs)||120,layerIndex))),afterEnabled=cfg.lightningAfterglow!==false,afterMs=afterEnabled?Math.max(0,Math.min(900,audioApplyNumeric('lightning.afterglowMs',Number(cfg.lightningAfterglowMs)||280,layerIndex))):0;
            let strikeFrac=Math.max(.025,Math.min(.34,strikeMs/cycleMs)),afterFrac=Math.max(0,Math.min(.34,afterMs/cycleMs));if(strikeFrac+afterFrac>.68){const k=.68/(strikeFrac+afterFrac);strikeFrac*=k;afterFrac*=k;}
            const preEnd=Math.max(.18,1-strikeFrac-afterFrac),strikeEnd=preEnd+strikeFrac;
            const pieces=prepared?.pieces||getLightningModePieces(visible,layer,null,cfg,layerIndex);if(!pieces.length)return;const strikePath=prepared?.strikePath||lightningPiecesPath(pieces);
            if(phase<preEnd){drawLightningPrechargePieces(ctx,pieces,layer,alpha,phase/preEnd,prepared,cfg,layerIndex);return;}
            if(phase<strikeEnd){const t=Math.max(0,Math.min(1,(phase-preEnd)/Math.max(1e-6,strikeFrac))),attack=lightningSmooth01(Math.min(1,t/.16)),release=lightningSmooth01(Math.min(1,(1-t)/.24)),intensity=Math.max(0,Math.min(1,attack*(.26+.84*release)));drawLightningStrikePieces(ctx,pieces,layer,alpha,intensity,-1,strikePath,suppressBase,cfg,layerIndex);return;}
            if(afterFrac<=.0001)return;
            const t=Math.max(0,Math.min(1,(phase-strikeEnd)/afterFrac));drawLightningStrikePieces(ctx,pieces,layer,alpha,.26*(1-lightningSmooth01(t)),-1,strikePath,suppressBase,cfg,layerIndex);
            const count=Math.max(0,Math.round(audioApplyNumeric('lightning.microStrikes',Number(cfg.lightningMicroStrikes)||0,layerIndex))),micro=collectLightningMicroPulses(t,count,[]);for(const pulse of micro)drawLightningStrikePieces(ctx,pieces,layer,alpha,pulse.intensity,pulse.index,strikePath,suppressBase,cfg,layerIndex);
        }
        // v136: Lightning stays vector at every corridor scale. No bitmap/raster cache is used.

        function buildAcrossFigureSweepPieces(visible,phase,targetPieces=null,scratch=null,cfg=currentSweepConfig(),layerIndex=-1){
            let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
            for(const path of visible||[])for(const p of path?.points||[]){if(!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
            const out=targetPieces||[];
            if(!Number.isFinite(minX)||maxX<=minX||!Number.isFinite(minY))return out;
            const span=Math.max(1,maxX-minX),band=Math.max(8,span*Math.max(.015,Math.min(1,audioApplyNumeric('sweep.length',Number(cfg.lengthPercent)||18,layerIndex)/100))),half=band*.5;
            const travel=1-Math.abs(2*phase-1),cx=minX+(maxX-minX)*travel;
            for(const path of visible||[]){const pts=path?.points||[];if(pts.length<2)continue;const segCount=path.closed?pts.length:pts.length-1;
                for(let si=0;si<segCount;si++){const a=pts[si],b=pts[(si+1)%pts.length];if(!a||!b)continue;const dx=b.x-a.x;
                    if(Math.abs(dx)<1e-9){if(Math.abs(a.x-cx)<=half){const piece=scratch?acquireEffectPiece(scratch):[a,b];if(scratch){piece[0]=a;piece[1]=b;piece.length=2;}out.push(piece);}continue;}
                    let u0=(cx-half-a.x)/dx,u1=(cx+half-a.x)/dx;if(u0>u1){const q=u0;u0=u1;u1=q;}u0=Math.max(0,Math.min(1,u0));u1=Math.max(0,Math.min(1,u1));if(u1-u0<=1e-6)continue;
                    const piece=scratch?acquireEffectPiece(scratch):[];
                    const x0=a.x+(b.x-a.x)*u0,y0=a.y+(b.y-a.y)*u0,x1=a.x+(b.x-a.x)*u1,y1=a.y+(b.y-a.y)*u1;
                    if(scratch){effectXYAt(piece,0,x0,y0);effectXYAt(piece,1,x1,y1);piece.length=2;}else piece.push({x:x0,y:y0},{x:x1,y:y1});
                    out.push(piece);
                }
            }
            return out;
        }



        function getPreparedCanonicalSweepFrame(paths,layer,phase,now,cfg=currentSweepConfig(layer),layerIndex=-1){
            const visible=prepareWebVisiblePaths(paths,layer),table=buildPathLengthTable(visible);
            const lenFrac=Math.max(.01,Math.min(1,audioApplyNumeric('sweep.length',Number(cfg?.lengthPercent)||18,layerIndex)/100));return{now,paths,layer,visible,table,canonicalGPU:true,mode:cfg?.mode,phase,layerIndex,lenFrac};
        }

        function getPreparedSweepFrame(paths,layer,phase,now,cfg=currentSweepConfig(layer),layerIndex=-1){
            const signature=[effectiveGlintType(cfg),cfg.mode,cfg.lengthPercent,cfg.everyN,layer?.N,layer?.K,phase].join('|');
            const hit=sweepPreparedFrame;
            if(hit&&hit.now===now&&hit.paths===paths&&hit.layer===layer&&hit.signature===signature)return hit;
            const visible=prepareWebVisiblePaths(paths,layer);
            const scratch=resetEffectPieceScratch(sweepGeometryScratch),pieces=scratch.pieces;
            const lenFrac=Math.max(.01,Math.min(1,audioApplyNumeric('sweep.length',Number(cfg.lengthPercent)||18,layerIndex)/100));
            if(visible?.length){
                if(cfg.mode==='across'){
                    buildAcrossFigureSweepPieces(visible,phase,pieces,scratch,cfg,layerIndex);
                }else if(cfg.mode==='perSegment'||cfg.mode==='everyNth'){
                    const nth=Math.max(2,Math.min(24,Math.round(Number(cfg.everyN)||2))),localPhase=1-Math.abs(2*phase-1);let global=0;
                    for(const path of visible){const {table,segments}=getSweepSegmentsForPath(path,layer);for(const seg of segments){const use=cfg.mode==='perSegment'||(global%nth===0);global++;if(!use)continue;const len=Math.max(1.5,Math.min(seg.length,seg.length*lenFrac)),center=localPhase*seg.length,a=Math.max(0,center-len*.5),b=Math.min(seg.length,center+len*.5);if(b-a<=1e-5)continue;const pts=sampleSweepRange(table,seg.start+a,b-a,96,scratch);if(pts?.length>1)pieces.push(pts);}}
                }else if(cfg.mode==='perPath'){
                    const canonical=buildPathLengthTable(visible),staticPaths=!isCurrentFrameDynamicPathList(visible);
                    for(const range of ensurePathLengthRanges(canonical).ranges){const path=visible[range.pathIndex],table=buildSinglePathLengthTable(path,staticPaths);if(!(table.total>0))continue;const len=Math.max(2,table.total*lenFrac),startAt=phase*table.total-len*.5;buildWrappedSweepPieces(table,0,table.total,startAt,len,Math.max(12,Math.min(140,Math.ceil(len/3))),pieces,scratch);}
                }else{
                    const canonical=buildPathLengthTable(visible),total=canonical.total,staticPaths=!isCurrentFrameDynamicPathList(visible);
                    if(total>0){const len=Math.max(2,total*lenFrac),center=phase*total,startAt=center-len*.5;for(let wrap=-1;wrap<=1;wrap++){const a=startAt+wrap*total,b=a+len;for(const range of ensurePathLengthRanges(canonical).ranges){const ia=Math.max(a,range.start),ib=Math.min(b,range.start+range.length);if(ib>ia){const path=visible[range.pathIndex],table=buildSinglePathLengthTable(path,staticPaths);const pts=sampleSweepRange(table,ia-range.start,ib-ia,160,scratch);if(pts?.length>1)pieces.push(pts);}}}}
                }
            }
            const data=scratch.data;data.now=now;data.paths=paths;data.layer=layer;data.signature=signature;data.visible=visible;data.pieces=pieces;
            sweepPreparedFrame=data;
            return data;
        }

        function prepareLayerFrameSweepData(frameCtx){
            if(!frameCtx)return null;
            if(frameCtx.sweepPreparedReady)return frameCtx.sweepPrepared;
            const layer=frameCtx.layer,cfg=frameCtx.layerSweep||getLayerSweepConfig(layer),paths=getLayerFrameAuxiliaryPaths(frameCtx),now=frameCtx.now||performance.now();
            let data=frameCtx.sweepData;if(!data)data=frameCtx.sweepData={};
            data.cfg=cfg;data.layerIndex=frameCtx.layerIndex;data.paths=paths;data.now=now;data.prepared=null;data.phase=0;data.lightningPhase=0;data.lightningVector=null;data.lightningSpectralPrepared=null;data.lightningSpectralCfg=null;data.lightningSpectralVisual=null;data.lightningSpectralW=0;data.sweepW=0;data.glintVisual=null;data.vectorPath=null;data.bezierGlintGPU=false;data.canonicalGPU=false;data.gpuMorphArc=false;
            if(cfg?.enabled===true&&paths?.length){
                const phase=getSweepMotionPhase(now,cfg);data.phase=phase;
                if(cfg.effectType==='lightning'){
                    const lightningPaths=buildExactLightningPaths(frameCtx);
                    data.paths=lightningPaths;
                    data.lightningPhase=getLightningMotionPhase(now,cfg,frameCtx.layerIndex);
                    data.prepared=getPreparedLightningFrame(lightningPaths,layer,now,cfg,frameCtx.layerIndex);
                    data.lightningVector=prepareLightningVectorFrame(layer,data.lightningPhase,data.prepared,frameCtx.layerIndex,cfg);
                    if(data.lightningVector?.stage==='precharge'&&normalizeSweepFlashMode(cfg.flashMode)==='spectral'){
                        const spectralCfg={...cfg,flashType:'spectral',glintPrecision:'spectral',_lightningPreflashBlend:false,_lightningPreflashCoreOnTop:true,_lightningSpectralAudio:true,spectralSectorDegrees:Math.max(1,Math.min(360,Number.isFinite(Number(cfg.spectralSectorDegrees))?Number(cfg.spectralSectorDegrees):45)),spectralAngularSpeed:Math.max(-720,Math.min(720,Number.isFinite(Number(cfg.spectralAngularSpeed))?Number(cfg.spectralAngularSpeed):90)),color:cfg.color||'#ffffff'};
                        const spectralPrepared=buildBezierGlintPrepared(frameCtx,lightningPaths,spectralCfg,data.lightningVector.prechargeT,now,frameCtx.layerIndex);
                        if(spectralPrepared){const f=data.lightningVector;data.lightningSpectralPrepared=spectralPrepared;data.lightningSpectralCfg=spectralCfg;data.lightningSpectralW=f.prechargeWidth;data.lightningSpectralVisual={glowSize:f.prechargeGlow,strength:f.prechargeGlowIntensity,brightness:f.prechargeBrightness,softness:f.prechargeSoftness,opacity:f.flashOpacity};}
                    }
                }else{
                    const glintType=effectiveGlintType(cfg);
                    if(glintType==='high'||glintType==='chaotic'||glintType==='spectral'){
                        const exactPaths=buildExactLightningPaths(frameCtx),bezierPrepared=buildBezierGlintPrepared(frameCtx,exactPaths,cfg,phase,now,frameCtx.layerIndex);
                        if(bezierPrepared){data.paths=exactPaths;data.prepared=bezierPrepared;data.bezierGlintGPU=true;data.canonicalGPU=false;}
                    }
                    if(!data.bezierGlintGPU){
                        const glintPaths=isHighPrecisionGlint(cfg)?buildHighPrecisionGlintPaths(frameCtx):paths;data.paths=glintPaths;
                        const nativeCanonical=WebGPUCanonicalSweepRenderer.canUse(cfg,state.tunnel?.active===true);data.prepared=nativeCanonical?getPreparedCanonicalSweepFrame(glintPaths,layer,phase,now,cfg,frameCtx.layerIndex):getPreparedSweepFrame(glintPaths,layer,phase,now,cfg,frameCtx.layerIndex);data.canonicalGPU=nativeCanonical;
                        if(typeof Path2D!=='undefined'&&data.prepared?.pieces?.length){const vp=new Path2D();for(const pts of data.prepared.pieces){if(!pts?.length)continue;vp.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++)vp.lineTo(pts[i].x,pts[i].y);}data.vectorPath=vp;}
                    }
                    const baseW=Math.max(.5,Number(frameCtx.strokeWidth)||Math.max(.5,audioApplyNumeric('layer.strokeWidth',Number(layer?.strokeWidth)||1.5,frameCtx.layerIndex)*getLayerStrokeWidthMultiplier(layer))),raw=audioApplyNumeric('sweep.width',Number(cfg.widthPercent),frameCtx.layerIndex),widthPct=Number.isFinite(raw)?Math.max(0,Math.min(200,raw)):100;data.sweepW=baseW*widthPct/100;data.glintVisual=getGlintVisualSettings(cfg,frameCtx.layerIndex);
                }
            }
            frameCtx.sweepPrepared=data;frameCtx.sweepPreparedReady=true;
            return data;
        }


        const lightningBrightCoreColorCache=new Map();
        function lightningBrightCoreColor(color){
            const key=String(color||'#ffffff');let hit=lightningBrightCoreColorCache.get(key);if(hit)return hit;
            const rgb=GPUColorCache.rgb(key),mix=.48;
            hit=`rgb(${Math.round((rgb[0]+(1-rgb[0])*mix)*255)},${Math.round((rgb[1]+(1-rgb[1])*mix)*255)},${Math.round((rgb[2]+(1-rgb[2])*mix)*255)})`;
            if(lightningBrightCoreColorCache.size>64)lightningBrightCoreColorCache.clear();lightningBrightCoreColorCache.set(key,hit);return hit;
        }
        function lightningVisualGlowRadius(glow){
            // Bulb semantics: the user value is the maximum halo radius in pixels. Do not
            // compress or clamp large values; the GPU clips the analytic capsule to the target.
            return Math.max(0,Number(glow)||0);
        }
        function lightningPrechargePiecesForGL(pieces,t,cfg,layerIndex=-1){
            return buildLightningPrechargePieces(pieces,t,cfg,layerIndex);
        }
        function queueLightningStrikeWebGL(ctx,pieces,layer,alpha,frame,intensity,microIndex=-1,suppressBase=false){
            const a=Math.max(0,Math.min(1,(Number(alpha)||0)*Math.max(0,Number(intensity)||0)));if(a<=.001)return true;
            if(!suppressBase&&frame.showBase){const p=frame.strikePath;if(p)drawLightningUniformPath(ctx,p,layer?.strokeColor||'#ffffff',frame.baseW,a*frame.lineOpacity,0,'source-over');}
            const micro=microIndex>=0,outerColor=micro&&microIndex%2===0?frame.primary:frame.secondary,innerColor=micro&&microIndex%2===0?frame.secondary:frame.primary;
            const outerW=frame.precisionHigh?Math.max(frame.boltW+.22,frame.boltW*1.18):Math.max(frame.boltW+.7,frame.boltW*1.9),bright=Math.max(0,frame.brightness||0);
            const haloA=a*.82*frame.glowIntensity*bright,glowR=lightningVisualGlowRadius(frame.glow);
            SweepGPURenderer.queueStroke(ctx,pieces,outerW,outerColor,0,glowR,haloA*(frame.smoothLighting?.34:.27),frame.softness);
            SweepGPURenderer.queueStroke(ctx,pieces,outerW,outerColor,a*.34,0,0,0);
            SweepGPURenderer.queueStroke(ctx,pieces,frame.boltW,lightningBrightCoreColor(innerColor),a,0,0,0);
            return true;
        }
        function queueMovingSweepGlowWebGL(ctx,paths,layer,alpha=1,now=performance.now(),frameData=null){
            if(!SweepGPURenderer.isAvailable())return false;
            const cfg=frameData?.cfg||currentSweepConfig(layer),layerIndex=Number.isInteger(frameData?.layerIndex)?frameData.layerIndex:-1;
            if(!cfg?.enabled||alpha<=.001)return true;
            if(cfg.effectType==='lightning'){
                const prepared=frameData?.prepared||getPreparedLightningFrame(paths,layer,now,cfg,layerIndex);
                if(!prepared?.visible?.length||!prepared?.pieces?.length)return true;
                const lightningPhase=frameData?frameData.lightningPhase:getLightningMotionPhase(now,cfg,layerIndex),frame=frameData?.lightningVector||prepareLightningVectorFrame(layer,lightningPhase,prepared,layerIndex,cfg);
                if(!frame||frame.stage==='idle')return true;
                if(frame.stage==='precharge'){
                    const paGlow=Math.max(0,Math.min(1,alpha*frame.prechargeAlpha)),paCore=paGlow*Math.max(0,Math.min(1,Number.isFinite(Number(frame.flashOpacity))?Number(frame.flashOpacity):1));if(paGlow<=.001&&paCore<=.001)return true;
                    const pp=frame.prechargePieces?.length?frame.prechargePieces:lightningPrechargePiecesForGL(prepared.pieces,frame.prechargeT,cfg,layerIndex),glowR=lightningVisualGlowRadius(frame.prechargeGlow),flashColor=frame.flash||'#ffffff',w=Math.max(.15,frame.prechargeWidth),bright=Math.max(0,frame.prechargeBrightness||0);
                    SweepGPURenderer.queueStroke(ctx,pp,w,flashColor,0,glowR,paGlow*frame.prechargeGlowIntensity*bright*(frame.smoothLighting?.32:.24),frame.prechargeSoftness);
                    SweepGPURenderer.queueStroke(ctx,pp,w*1.12,flashColor,paCore*.32,0,0,0);
                    SweepGPURenderer.queueStroke(ctx,pp,w,flashColor,paCore,0,0,0);
                    return true;
                }
                queueLightningStrikeWebGL(ctx,prepared.pieces,layer,alpha,frame,frame.intensity,-1,false);
                if(frame.stage==='after')for(const pulse of frame.microPulses)queueLightningStrikeWebGL(ctx,prepared.pieces,layer,alpha,frame,pulse.intensity,pulse.index,false);
                return true;
            }
            const phase=frameData?frameData.phase:getSweepMotionPhase(now,cfg),prepared=frameData?.prepared||getPreparedSweepFrame(paths,layer,phase,now,cfg,layerIndex),pieces=prepared?.pieces;
            if(!pieces?.length)return true;
            let sweepW=Number(frameData?.sweepW)||0;if(!(sweepW>.001)){const baseW=Math.max(.5,audioApplyNumeric('layer.strokeWidth',Number(layer?.strokeWidth)||1.5,layerIndex)*getLayerStrokeWidthMultiplier(layer)),raw=audioApplyNumeric('sweep.width',Number(cfg.widthPercent),layerIndex),widthPct=Number.isFinite(raw)?Math.max(0,Math.min(200,raw)):75;sweepW=baseW*widthPct/100;}
            if(!(sweepW>.001))return true;
            const vis=frameData?.glintVisual||getGlintVisualSettings(cfg,layerIndex),a=Math.max(0,Math.min(1,Number(alpha)||0)),coreA=a*Math.max(0,Math.min(1,Number.isFinite(Number(vis.opacity))?Number(vis.opacity):1));
            const glowAlpha=vis.glowSize>.001&&vis.strength>.001?a*.22*vis.strength*vis.brightness:0;
            if(glowAlpha>.0001)SweepGPURenderer.queueStroke(ctx,pieces,Math.max(.15,sweepW),cfg.color||'#ffffff',0,vis.glowSize,glowAlpha,vis.softness);
            SweepGPURenderer.queueStroke(ctx,pieces,Math.max(.15,sweepW),cfg.color||'#ffffff',coreA,0,0,0);
            return true;
        }

        function drawMovingSweepGlow(ctx,paths,layer,alpha=1,now=performance.now(),frameData=null,outerStateIsolated=false){
            const cfg=frameData?.cfg||currentSweepConfig(layer);const layerIndex=Number.isInteger(frameData?.layerIndex)?frameData.layerIndex:-1;if(!cfg?.enabled||alpha<=.001)return;
            if(cfg.effectType==='lightning'){
                const prepared=frameData?.prepared||getPreparedLightningFrame(paths,layer,now,cfg,layerIndex);
                if(!prepared?.visible?.length||!prepared?.pieces?.length)return;
                const lightningPhase=frameData?frameData.lightningPhase:getLightningMotionPhase(now,cfg,layerIndex);
                const vectorFrame=frameData?.lightningVector||prepareLightningVectorFrame(layer,lightningPhase,prepared,layerIndex,cfg);
                const behavior=normalizeLightningBehaviorValue(cfg.lightningBehavior,'inside');
                const lightningClip=getPreparedLightningClipPath(prepared,behavior);
                if(lightningClip){ctx.save();try{ctx.clip(lightningClip,'evenodd');}catch(_err){ctx.clip(lightningClip);}drawPreparedLightningVector(ctx,layer,alpha,vectorFrame,false);ctx.restore();}
                else drawPreparedLightningVector(ctx,layer,alpha,vectorFrame,false);
                return;
            }
            const basePhase=frameData?frameData.phase:getSweepMotionPhase(now,cfg);
            const prepared=frameData?.prepared||getPreparedSweepFrame(paths,layer,basePhase,now,cfg,layerIndex),pieces=prepared?.pieces;
            if(!pieces?.length)return;
            let sweepW=Number(frameData?.sweepW)||0;
            if(!(sweepW>.001)){
                const baseW=Math.max(.5,audioApplyNumeric('layer.strokeWidth',Number(layer?.strokeWidth)||1.5,layerIndex)*getLayerStrokeWidthMultiplier(layer)),raw=audioApplyNumeric('sweep.width',Number(cfg.widthPercent),layerIndex),widthPct=Number.isFinite(raw)?Math.max(0,Math.min(200,raw)):100;
                sweepW=baseW*widthPct/100;
            }
            if(!(sweepW>.001))return;
            if(!outerStateIsolated)ctx.save();ctx.globalCompositeOperation=composite;ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=Math.max(.15,sweepW);ctx.strokeStyle=cfg.color||'#ffffff';ctx.shadowBlur=0;
            const vectorPath=frameData?.vectorPath||null;
            if(vectorPath){
                strokeCurrentGlintPath(ctx,cfg,alpha,frameData?.glintVisual||null,vectorPath);
            }else{
                ctx.beginPath();
                for(const pts of pieces){ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);}
                strokeCurrentGlintPath(ctx,cfg,alpha,frameData?.glintVisual||null);
            }
            if(!outerStateIsolated)ctx.restore();
        }
        function sweepAnimationTick(){
            if(!state.layers.some(l=>getLayerSweepConfig(l).enabled===true)) return false;
            requestMainCanvasRender();
            return true;
        }
        function gpuPathFxAnimationTick(){
            // v502: Moving Line belongs to the linear-motion Morph class, but owns its own clock.
            // It repaints both a static canonical figure and a figure already driven by full/minimal/project Morph.
            const motionActive=(state.layers||[]).some(l=>l?.visible!==false&&l?.lineMotionFx?.enabled===true);
            const spriteActive=(state.layers||[]).some(l=>l?.visible!==false&&l?.sprite?.enabled===true);
            if(!motionActive&&!spriteActive)return false;requestMainCanvasRender();return true;
        }
        function ensureGpuPathFxAnimation(){
            const active=(state.layers||[]).some(l=>l?.visible!==false&&(l?.lineMotionFx?.enabled===true||l?.sprite?.enabled===true));
            if(active)animationScheduler.add('gpu-path-fx',gpuPathFxAnimationTick);else animationScheduler.remove('gpu-path-fx');
        }
        function ensureSweepAnimation(){
            const anyEnabled=state.layers.some(l=>getLayerSweepConfig(l).enabled===true);
            if(anyEnabled) animationScheduler.add('sweep',sweepAnimationTick);
            else animationScheduler.remove('sweep');
        }
        function getLayerParticleConfig(layer){
            const owner=ensureLayerEffectState(layer);if(!owner)return normalizeParticleConfig(null);
            owner.particles=normalizeParticleConfig(owner.particles);return owner.particles;
        }
        function particleAnimationTick(){
            const any=(state.layers||[]).some(l=>l?.visible!==false&&getLayerParticleConfig(l).enabled===true);
            if(!any)return false;requestMainCanvasRender();return true;
        }
        function ensureParticleAnimation(){
            const any=(state.layers||[]).some(l=>l?.visible!==false&&getLayerParticleConfig(l).enabled===true);
            if(any){animationScheduler.add('particles',particleAnimationTick);try{WebGPUParticleRenderer?.warmup?.();}catch(_){}}
            else animationScheduler.remove('particles');
        }
        function syncParticlePaletteOptions(){
            const sel=document.getElementById('particlePalette');if(!sel)return;
            let keys=[];try{keys=typeof getActivePlaylistPaletteKeys==='function'?getActivePlaylistPaletteKeys():[];}catch(_){keys=[];}
            if(!keys.length)keys=['standard'];
            const signature=keys.join('|');if(sel.dataset.paletteSignature!==signature){const current=sel.value;sel.innerHTML='';for(const key of keys){const o=document.createElement('option');o.value=key;try{o.textContent=getPlaylistPaletteDisplayName(key);}catch(_){o.textContent=key;}sel.appendChild(o);}sel.dataset.paletteSignature=signature;if(keys.includes(current))sel.value=current;}
        }
        function syncParticleUI(){
            const active=getActiveEffectLayer();if(!active)return;const c=getLayerParticleConfig(active);
            syncParticlePaletteOptions();
            const master=state.masterLayerEdit===true;
            const show=document.getElementById('showParticles');if(show)show.checked=master?everyLayerMatches(l=>getLayerParticleConfig(l).enabled===true):c.enabled===true;
            const set=(id,v)=>{const el=document.getElementById(id);if(el&&document.activeElement!==el)el.value=String(v);};
            set('particleStyle',c.style);set('particleMode',c.mode);set('particleColorMode',c.colorMode);set('particlePalette',c.paletteKey);set('particleDensity',c.density);set('particleDensityMultiplier',c.densityMultiplier);set('particleSize',c.sizePx);set('particleScatter',c.scatter);set('particleScatterMultiplier',c.scatterMultiplier);set('particleSizeVariation',c.sizeVariation);set('particleSizeVariationMultiplier',c.sizeVariationMultiplier);set('particleSpeed',c.speedPercent);set('particleSpeedMultiplier',c.speedMultiplier);set('particleOpacity',c.opacity);set('particleTwinkle',c.twinkle);set('particleSpiralRadius',c.spiralRadiusPx);set('particleSpiralRadiusMultiplier',c.spiralRadiusMultiplier);set('particleSpiralTurns',c.spiralTurns);
            const txt=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};txt('particleDensityText',`${Math.round(c.density)} × ${Number(c.densityMultiplier).toFixed(2).replace(/\.?0+$/,'')||'1'}`);txt('particleSizeText',`${Number(c.sizePx).toFixed(1).replace('.0','')} px`);txt('particleScatterText',`${Math.round(c.scatter)}% × ${Number(c.scatterMultiplier).toFixed(2).replace(/\.?0+$/,'')||'1'}`);txt('particleSizeVariationText',`${Math.round(c.sizeVariation)}% × ${Number(c.sizeVariationMultiplier).toFixed(2).replace(/\.?0+$/,'')||'1'}`);txt('particleSpeedText',`${Math.round(c.speedPercent)}% × ${Number(c.speedMultiplier).toFixed(2).replace(/\.?0+$/,'')||'1'}`);txt('particleOpacityText',`${Math.round(c.opacity)}%`);txt('particleTwinkleText',`${Math.round(c.twinkle)}%`);txt('particleSpiralRadiusText',`${Number(c.spiralRadiusPx).toFixed(1).replace('.0','')} px × ${Number(c.spiralRadiusMultiplier).toFixed(2).replace(/\.?0+$/,'')||'1'}`);txt('particleSpiralTurnsText',`${Number(c.spiralTurns).toFixed(2).replace(/\.?0+$/,'')} об.`);
            document.getElementById('particlePaletteRow')?.classList.toggle('hidden',c.colorMode!=='palette');document.getElementById('particleSpiralRadiusRow')?.classList.toggle('hidden',c.mode!=='spiralZ');document.getElementById('particleSpiralTurnsRow')?.classList.toggle('hidden',c.mode!=='spiralZ');
            document.getElementById('btnSidebarParticles')?.classList.toggle('feature-enabled',show?.checked===true);
            ensureParticleAnimation();
        }

        function isChaosCircleMorphPair(layerIndex){
            const base=state.layers?.[layerIndex];
            const src=runtimeState.morph.renderSourceLayers?.[layerIndex] || runtimeState.morph.sourceVisuals?.[layerIndex] || base;
            const dst=runtimeState.morph.renderTargetLayers?.[layerIndex] || runtimeState.morph.targetVisuals?.[layerIndex] || base;
            return src?.chaosStar===true || dst?.chaosStar===true;
        }

        function buildCurrentChaosCircleMorphPaths(layerIndex,t){
            const cacheKey=`chaos-circle|${frameMorphCacheKey(layerIndex,t)}|${state.morph.slideType||'sector'}`;
            if(frameGeometryRuntime.active){const hit=frameGeometryRuntime.circlePaths.get(cacheKey);if(hit){frameGeometryRuntime.stats.circleHits++;return hit;}}
            const base=state.layers[layerIndex];
            const src=runtimeState.morph.renderSourceLayers?.[layerIndex] || { ...base, ...(runtimeState.morph.sourceVisuals?.[layerIndex]||{}) };
            const dst=runtimeState.morph.renderTargetLayers?.[layerIndex] || { ...base, ...(runtimeState.morph.targetVisuals?.[layerIndex]||{}) };
            if(!src||!dst)return[];
            const plan=getChaosCircleMorphPlan(src,dst,state.morph.slideType||'sector');
            if(!plan?.pathPlans?.length)return[];
            const u=Number.isFinite(Number(t))?Number(t):0;
            const closurePlan=getMorphClosureTransitionPlan(plan.srcClosed,plan.dstClosed,u);
            const geometryT=closurePlan.geometryT;
            const rs=getEffectiveLayerRadius(src,220),rd=getEffectiveLayerRadius(dst,rs),R=rs+(rd-rs)*geometryT;
            const profilePts=interpolateMorphProfile(src,dst,geometryT,plan.profileScratch);
            const closeProfile=plan.srcClosed===plan.dstClosed?plan.srcClosed:(closurePlan.closureMix>=.5?plan.dstClosed:plan.srcClosed);
            const sourceRounding=Math.max(0,Math.min(MAX_ROUNDING_PERCENT,Number(src.rounding)||0));
            const targetRounding=Math.max(0,Math.min(MAX_ROUNDING_PERCENT,Number(dst.rounding)||0));
            const currentRoundingFrac=Math.max(0,Math.min(2,(sourceRounding+(targetRounding-sourceRounding)*geometryT)/100));
            const result=frameGeometryRuntime.active?getFrameOutputPool(circleFrameOutputPools,layerIndex):[];
            const resultPathPool=frameGeometryRuntime.active?(result._pathPool||(result._pathPool=[])):null;
            let resultPathWrite=0;
            for(const pp of plan.pathPlans){
                let vertices=pp.auxVertexPts;
                if(!vertices||vertices.length!==pp.from.length)vertices=pp.auxVertexPts=Array.from({length:pp.from.length},()=>({x:0,y:0}));
                for(let i=0;i<vertices.length;i++){
                    const ang=pp.from[i]+pp.delta[i]*geometryT;
                    vertices[i].x=R*Math.cos(ang);vertices[i].y=R*Math.sin(ang);
                }
                if(vertices.length<2)continue;
                const opts=pp.auxApplyProfileOptions||(pp.auxApplyProfileOptions={});
                opts.collapseReferenceLength=R*pp.collapseFactor;
                opts.spiralEnabled=false;
                opts.spiralOrder=0;
                opts.spiralTangential=false;
                opts.spiralRoundSeams=true;
                opts.spiralClosed=true;
                opts.roundingFrac=currentRoundingFrac;
                opts.spiralStep=1;
                opts.polygonN=Math.max(2,vertices.length);
                opts.profileMode=base.profileMode;
                opts.scratch=opts;
                const polylines=applyProfileToVertexRing(vertices,profilePts,R,closeProfile,opts);
                for(const pl of polylines||[])if(pl?.points?.length>1){
                    if(!frameGeometryRuntime.active){result.push({points:pl.points.map(q=>({x:q.x,y:q.y,widthScale:Number.isFinite(Number(q.widthScale))?Number(q.widthScale):1})),closed:Boolean(pl.closed),cornerFlags:pl.cornerFlags||[]});continue;}
                    let item=resultPathPool[resultPathWrite];
                    if(!item)item=resultPathPool[resultPathWrite]={points:[],closed:false,cornerFlags:[]};
                    else frameGeometryRuntime.stats.circlePathReuses++;
                    const dstPts=item.points,srcPts=pl.points;
                    for(let qi=0;qi<srcPts.length;qi++){
                        let q=dstPts[qi];if(!q)q=dstPts[qi]={x:0,y:0,widthScale:1};
                        q.x=Number(srcPts[qi]?.x)||0;q.y=Number(srcPts[qi]?.y)||0;q.widthScale=Number.isFinite(Number(srcPts[qi]?.widthScale))?Number(srcPts[qi].widthScale):1;
                    }
                    dstPts.length=srcPts.length;item.closed=Boolean(pl.closed);item.cornerFlags=pl.cornerFlags||[];result.push(item);resultPathWrite++;
                }
            }
            if(frameGeometryRuntime.active){result._frameGeometryId=frameGeometryRuntime.frameId;frameGeometryRuntime.stats.circleBuilds++;frameGeometryRuntime.circlePaths.set(cacheKey,result);}
            return result;
        }

        function buildCurrentCircleMorphPaths(layerIndex,t){
            const cacheKey=frameMorphCacheKey(layerIndex,t);
            if(frameGeometryRuntime.active){ const hit=frameGeometryRuntime.circlePaths.get(cacheKey); if(hit){ frameGeometryRuntime.stats.circleHits++; return hit; } }
            const base=state.layers[layerIndex];
            const src=runtimeState.morph.renderSourceLayers?.[layerIndex] || { ...base, ...(runtimeState.morph.sourceVisuals?.[layerIndex]||{}) };
            const dst=runtimeState.morph.renderTargetLayers?.[layerIndex] || { ...base, ...(runtimeState.morph.targetVisuals?.[layerIndex]||{}) };
            if(!src||!dst)return[];
            const plan=getCircleMorphPlan(src,dst,state.morph.slideType||'sector');
            if(!plan?.pathPlans?.length)return[];
            const u=Number.isFinite(Number(t))?Number(t):0;
            const closurePlan=getMorphClosureTransitionPlan(plan.srcClosed,plan.dstClosed,u);
            const geometryT=closurePlan.geometryT;
            const rs=getEffectiveLayerRadius(src,220),rd=getEffectiveLayerRadius(dst,rs),R=rs+(rd-rs)*geometryT;
            const rawProfilePts=interpolateMorphProfile(src,dst,geometryT,plan.profileScratch);
            // interpolateMorphProfile only writes finite correspondence points here, so
            // no filtering copy is needed for the already pre-sampled spline grid.
            const profilePts=rawProfilePts;
            const closeProfile=plan.srcClosed===plan.dstClosed?plan.srcClosed:(closurePlan.closureMix>=.5?plan.dstClosed:plan.srcClosed);
            const sourceRounding=Math.max(0,Math.min(MAX_ROUNDING_PERCENT,Number(src.rounding)||0));
            const targetRounding=Math.max(0,Math.min(MAX_ROUNDING_PERCENT,Number(dst.rounding)||0));
            const currentRoundingFrac=Math.max(0,Math.min(2,(sourceRounding+(targetRounding-sourceRounding)*geometryT)/100));
            const result=frameGeometryRuntime.active ? getFrameOutputPool(circleFrameOutputPools,layerIndex) : [];
            const resultPathPool=frameGeometryRuntime.active ? (result._pathPool || (result._pathPool=[])) : null;
            let resultPathWrite=0;
            for(const pp of plan.pathPlans){
                let vertices=pp.auxVertexPts;
                if(!vertices||vertices.length!==pp.from.length) vertices=pp.auxVertexPts=Array.from({length:pp.from.length},()=>({x:0,y:0}));
                for(let i=0;i<vertices.length;i++){const ang=pp.from[i]+pp.delta[i]*geometryT;vertices[i].x=R*Math.cos(ang);vertices[i].y=R*Math.sin(ang);}
                if(vertices.length<2)continue;
                const opts=pp.auxApplyProfileOptions || (pp.auxApplyProfileOptions={});
                opts.collapseReferenceLength=R*pp.collapseFactor;
                opts.spiralEnabled=isSpiralLayer(base);
                opts.spiralOrder=getEffectiveSpiralOrder(base);
                opts.spiralTangential=base.spiralTangential===true;
                opts.spiralRoundSeams=base.spiralRoundSeams!==false;
                opts.spiralClosed=base.spiralClosed!==false;
                opts.roundingFrac=currentRoundingFrac;
                opts.spiralStep=getEffectiveSpiralStep(base);
                opts.polygonN=Math.max(2,Math.round(Number(base.N)||vertices.length||4));
                opts.profileMode=base.profileMode;
                opts.scratch=opts;
                const polylines=applyProfileToVertexRing(vertices,profilePts,R,closeProfile,opts);
                for(const pl of polylines||[]) if(pl?.points?.length>1){
                    if(!frameGeometryRuntime.active){
                        result.push({points:pl.points.map(q=>({x:q.x,y:q.y})),closed:Boolean(pl.closed),cornerFlags:pl.cornerFlags||[]});
                        continue;
                    }
                    let item=resultPathPool[resultPathWrite];
                    if(!item)item=resultPathPool[resultPathWrite]={points:[],closed:false,cornerFlags:[]};
                    else frameGeometryRuntime.stats.circlePathReuses++;
                    const dstPts=item.points,srcPts=pl.points;
                    for(let qi=0;qi<srcPts.length;qi++){
                        let q=dstPts[qi];if(!q)q=dstPts[qi]={x:0,y:0,widthScale:1};
                        q.x=Number(srcPts[qi]?.x)||0;q.y=Number(srcPts[qi]?.y)||0;
                        q.widthScale=Number.isFinite(Number(srcPts[qi]?.widthScale))?Number(srcPts[qi].widthScale):1;
                    }
                    dstPts.length=srcPts.length;item.closed=Boolean(pl.closed);item.cornerFlags=pl.cornerFlags||[];
                    result.push(item);resultPathWrite++;
                }
            }
            if(frameGeometryRuntime.active){ result._frameGeometryId=frameGeometryRuntime.frameId; frameGeometryRuntime.stats.circleBuilds++; frameGeometryRuntime.circlePaths.set(cacheKey,result); }
            return result;
        }
        function getAuxiliaryLayerPaths(layerIndex, layer, staticDrawData = null) {
            const finish=(paths)=>state.fourierMode?prepareFourierPathList(paths||[]):(paths||[]);
            const greenRt=runtimeState.projectMorph;
            const greenOwnsFrame=greenRt?.active===true&&greenRt?.transitionActive===true;
            if(greenOwnsFrame&&greenRt.renderMode==='crossfade'){
                const fadeT=Math.max(0,Math.min(1,Number(greenRt.fadeProgress)||0));
                const snapshotPaths=(fadeT<.5?greenRt.sourceGeometry:greenRt.targetGeometry)?.[layerIndex];
                if(Array.isArray(snapshotPaths)&&snapshotPaths.length)return finish(snapshotPaths);
            }
            let greenPaths=greenOwnsFrame?greenRt.frameGeometry?.[layerIndex]:null;
            if(greenOwnsFrame&&greenRt.renderMode!=='crossfade'&&(!Array.isArray(greenPaths)||!greenPaths.length)&&typeof ensureProjectMorphFrameGeometryLayer==='function'){
                greenPaths=ensureProjectMorphFrameGeometryLayer(layerIndex,greenRt.renderProgress);
            }
            if(Array.isArray(greenPaths)&&greenPaths.length)return finish(greenPaths);
            if (runtimeState.morph.active && state.morph.mode !== 'light') {
                const t = Number.isFinite(runtimeState.morph.geometryT) ? runtimeState.morph.geometryT : 0;
                const current = typeof getCurrentMorphCpuPaths==='function'
                    ? getCurrentMorphCpuPaths(layerIndex,t,'auxiliary-paths')
                    : ((state.morph.mode==='circleSlide'||(typeof spiralMorphUsesCircleRebuild==='function'&&spiralMorphUsesCircleRebuild()))
                        ? (isChaosCircleMorphPair(layerIndex) ? buildCurrentChaosCircleMorphPaths(layerIndex,t) : buildCurrentCircleMorphPaths(layerIndex,t))
                        : buildCurrentMorphPaths(layerIndex, t));
                if (current?.length) return finish(current);
            }
            const staticPaths=staticDrawData?.paths || getCachedLayerDrawData(layer)?.paths || [];
            // Static Spiral effects share the exact retained cubic carrier with the base line.
            // Do this once here so Graffiti/Web/Sweep compatibility paths cannot fit their own
            // spline and drift across neighbouring spiral turns.
            if(isSpiralLayer(layer)&&state.fourierMode!==true&&typeof buildExactSpiralEffectPaths==='function')return finish(buildExactSpiralEffectPaths(staticPaths,layer));
            return finish(staticPaths);
        }
        function prepareWebVisiblePaths(paths, layer) {
            const source=Array.isArray(paths)?paths:[];
            // v534: stable visual rails already contain the final spline/rounding shape.
            // Re-rounding them here was both wrong (double smoothing) and O(points) work
            // on every Morph frame. Effects must consume the same resident carrier rail.
            if(source?._exactSpiralEffectRail===true || source?._stableRoundedSplineRail===true || (source.length>0&&source.every(path=>path?._exactSpiralEffectRail===true||path?._stableRoundedSplineRail===true||path?._greenRenderedRail===true)))return source;
            const rounding = getRoundingStrength(layer?.rounding);
            if (rounding <= .001) return source;

            const dynamicFrame=isCurrentFrameDynamicPathList(source);
            if(!dynamicFrame && source && typeof source==='object'){
                let variants=persistentRoundedPathsCache.get(source);
                const key='static:'+rounding.toFixed(5);
                const hit=variants?.get(key);
                if(hit)return hit;
                const rounded=source.map(path => {
                    const pts=path?.points||[];
                    if(pts.length<3)return path;
                    return { ...path, points:smoothMorphPath(pts,Boolean(path.closed),rounding,path.cornerFlags||[]) };
                });
                if(!variants){variants=new Map();persistentRoundedPathsCache.set(source,variants);}
                variants.set(key,rounded);
                return rounded;
            }

            if(frameGeometryRuntime.active && source && typeof source==='object'){
                let variants=frameGeometryRuntime.roundedPaths.get(source);
                const dynamicMorph = dynamicFrame && !isSpiralLayer(layer);
                const key=(dynamicMorph?'morph-v92:':'corner:')+rounding.toFixed(5);
                const hit=variants?.get(key);
                if(hit) return hit;
                const rounded=source.map(path => {
                    const pts = path?.points || [];
                    if (pts.length < 3) return path;
                    if(dynamicMorph){
                        let holder=path._effectMorphRoundedPath;
                        if(!holder)holder=path._effectMorphRoundedPath={points:[]};
                        holder.closed=Boolean(path.closed);holder.cornerFlags=[];
                        holder._src=path._src||null;holder._dst=path._dst||null;
                        buildRoundedMorphPolylinePoints(pts,holder.closed,rounding,holder.points);
                        return holder;
                    }
                    return { ...path, points: smoothMorphPath(pts, Boolean(path.closed), rounding, path.cornerFlags || []) };
                });
                rounded._frameGeometryId=frameGeometryRuntime.frameId;
                if(!variants){ variants=new Map(); frameGeometryRuntime.roundedPaths.set(source,variants); }
                variants.set(key,rounded);
                return rounded;
            }
            return source.map(path => {
                const pts = path?.points || [];
                if (pts.length < 3) return path;
                return { ...path, points: smoothMorphPath(pts, Boolean(path.closed), rounding, path.cornerFlags || []) };
            });
        }
        function webSignedArea(points) {
            let a=0;
            for(let i=0,n=points.length;i<n;i++){
                const p=points[i],q=points[(i+1)%n]; a += p.x*q.y-q.x*p.y;
            }
            return a*.5;
        }
        function webHashSigned(a,b,c,d=0) {
            let x=(Math.imul((a+1)|0,73856093)^Math.imul((b+1)|0,19349663)^Math.imul((c+1)|0,83492791)^Math.imul((d+1)|0,2654435761))>>>0;
            x ^= x>>>16; x=Math.imul(x,2246822519)>>>0; x^=x>>>13; x=Math.imul(x,3266489917)>>>0; x^=x>>>16;
            return (x/4294967295)*2-1;
        }
        function getWebBranchFlags(cfg){
            const c=cfg&&typeof cfg==='object'?cfg:{};
            const explicit=['inside','outsideStraight','outsideArc'].some(k=>Object.prototype.hasOwnProperty.call(c,k));
            if(explicit)return{inside:c.inside===true,outsideStraight:c.outsideStraight===true,outsideArc:c.outsideArc===true};
            const legacy=['inside','outside','combined'].includes(c.region)?c.region:'inside';
            return{inside:legacy!=='outside',outsideStraight:false,outsideArc:legacy!=='inside'};
        }
        function getWebStyleProfile(cfg,width,dpr=1){
            const style=['web','laser','spiderSun'].includes(cfg?.style)?cfg.style:'web',base=Math.max(.03,Number(width)||.6),px=Math.max(.1,Number(dpr)||1);
            if(style==='laser')return{style,width:Math.max(.03,base*.72),alpha:1,halo:Math.min(14,Math.max(1.2,base*5.8))*px,shadow:Math.min(14,Math.max(1.2,base*5.8))};
            if(style==='spiderSun')return{style,width:Math.max(.03,base*.86),alpha:.82,halo:Math.min(4.5,Math.max(.2,base*1.4))*px,shadow:Math.min(4.5,Math.max(.2,base*1.4))};
            return{style,width:base,alpha:.88,halo:Math.min(6,Math.max(.1,base*2.4))*px,shadow:Math.min(6,base*2.4)};
        }
        function resolveWebPrimaryColor(cfg,layer=null,frameCtx=null){
            if(cfg?.matchLineColor===true){
                const lineColor=frameCtx?.strokeColor || layer?.strokeColor || '#ffffff';
                return colorBaseHex6(lineColor,'#ffffff');
            }
            return /^#[0-9a-f]{6}$/i.test(cfg?.color||'')?cfg.color:'#ffffff';
        }
        const webRuntime = { corners:new Map(), lastCleanup:0, pendingByLayer:new Map(), desiredVisibilityByLayer:new Map(), transitionByLayer:new Map(), nextCornerTrackId:1 };
        // v525: visibility animation owns a scheduler task.  A static scene therefore keeps
        // painting while Web grows out of / collapses into a corner instead of waiting for
        // another morph, tunnel or audio frame to happen to invalidate the canvas.
        function ensureWebTransitionAnimation(){
            animationScheduler.add('web-visibility-transition',(now)=>{
                let active=false;
                for(const tr of webRuntime.transitionByLayer.values()){
                    if(!tr)continue;
                    const d=Math.max(60,Number(tr.duration)||180);
                    if(now-(Number(tr.start)||0)<d+20){active=true;break;}
                }
                requestMainCanvasRender();
                return active;
            });
        }
        function hasActiveMorphForWebSwitch() {
            return Boolean(runtimeState.morph?.active || runtimeState.minimalMorph?.active);
        }
        function applyWebSwitchPatch(patch, requestRender = true, targetLayer = null) {
            if (!patch) return false;
            const owner=ensureLayerEffectState(targetLayer || getActiveEffectLayer());
            if(!owner)return false;
            let changed=false;
            if(Object.prototype.hasOwnProperty.call(patch,'showWeb')){
                const next=patch.showWeb===true;
                if(owner.showWeb!==next)changed=true;
                owner.showWeb=next;
                if(!next){
                    for(const key of Array.from(webRuntime.corners.keys()))if(String(key).startsWith(`${owner.id}:`))webRuntime.corners.delete(key);
                    webRuntime.transitionByLayer.delete(owner.id);
                    webRuntime.desiredVisibilityByLayer.delete(owner.id);
                }
            }
            if(Object.prototype.hasOwnProperty.call(patch,'type')){
                const nextType=patch.type==='rounding'?'rounding':'bevel';
                if(owner.web.type!==nextType)changed=true;
                owner.web.type=nextType;
            }
            if(changed&&requestRender)requestMainCanvasRender();
            return changed;
        }
        function queueWebSwitchForNextMorph(patch) {
            if(!patch)return false;
            const targets=getEffectTargets();
            if(!targets.length)return false;
            const hasShow=Object.prototype.hasOwnProperty.call(patch,'showWeb');
            const hasType=Object.prototype.hasOwnProperty.call(patch,'type');
            const now=performance.now();
            if(hasShow){
                // User visibility toggle is immediate in both directions. Any historical
                // visibility transition/pending state is cancelled in the same event tick.
                const desired=patch.showWeb===true;
                for(const layer of targets){
                    const owner=ensureLayerEffectState(layer);if(!owner)continue;
                    webRuntime.pendingByLayer.delete(owner.id);
                    webRuntime.transitionByLayer.delete(owner.id);
                    webRuntime.desiredVisibilityByLayer.delete(owner.id);
                    applyWebSwitchPatch({showWeb:desired},false,owner);
                }
            }
            if(hasType){
                if(hasActiveMorphForWebSwitch()){
                    for(const layer of targets){const prev=webRuntime.pendingByLayer.get(layer.id)||{};webRuntime.pendingByLayer.set(layer.id,{...prev,type:patch.type});}
                }else{
                    for(const layer of targets){webRuntime.pendingByLayer.delete(layer.id);applyWebSwitchPatch({type:patch.type},false,layer);}
                }
            }
            syncWebOutlineUI();requestMainCanvasRender();return Boolean(hasType&&hasActiveMorphForWebSwitch());
        }
        function applyPendingWebSwitchAtMorphBoundary() {
            if(!webRuntime.pendingByLayer.size)return false;
            const now=performance.now();let changed=false;
            for(const [id,pending] of Array.from(webRuntime.pendingByLayer.entries())){
                const layer=state.layers.find(l=>l.id===id);webRuntime.pendingByLayer.delete(id);if(!layer)continue;
                ensureLayerEffectState(layer);
                const wasVisible=layer.showWeb===true,oldType=layer.web.type==='rounding'?'rounding':'bevel';
                const nextVisible=Object.prototype.hasOwnProperty.call(pending,'showWeb')?pending.showWeb===true:wasVisible;
                const nextType=Object.prototype.hasOwnProperty.call(pending,'type')?(pending.type==='rounding'?'rounding':'bevel'):oldType;
                layer.showWeb=nextVisible;layer.web.type=nextType;changed=true;
                if(!nextVisible)webRuntime.transitionByLayer.delete(id);
                else if(!wasVisible)webRuntime.transitionByLayer.set(id,{kind:'fadeIn',fromType:nextType,toType:nextType,start:now,duration:180});
                else if(oldType!==nextType)webRuntime.transitionByLayer.set(id,{kind:'type',fromType:oldType,toType:nextType,start:now,duration:180});
            }
            syncWebOutlineUI();if(changed)requestMainCanvasRender();return changed;
        }
        function flushPendingWebSwitchIfMorphStopped() {
            if(hasActiveMorphForWebSwitch()||!webRuntime.pendingByLayer.size)return false;
            let changed=false;
            for(const [id,pending] of Array.from(webRuntime.pendingByLayer.entries())){
                const layer=state.layers.find(l=>l.id===id);webRuntime.pendingByLayer.delete(id);if(!layer)continue;
                webRuntime.transitionByLayer.delete(id);changed=applyWebSwitchPatch(pending,false,layer)||changed;
            }
            syncWebOutlineUI();if(changed)requestMainCanvasRender();return changed;
        }
        function webSmoothstep01(x){x=Math.max(0,Math.min(1,x));return x*x*x*(x*(x*6-15)+10);}
        function webWrappedUnitDistance(a,b){
            let d=Math.abs((Number(a)||0)-(Number(b)||0));
            return Math.min(d,1-d);
        }
        function resolveDynamicWebCornerRuntime(layerId,pathIndex,anchorU,anchorX,anchorY,total,now){
            const frameId=Number(frameGeometryRuntime.frameId)||0;
            const lid=String(layerId||'layer');
            const px=Number(anchorX)||0,py=Number(anchorY)||0,u=((Number(anchorU)||0)%1+1)%1;
            const spatialGate=Math.max(20,Math.min(180,(Number(total)||0)*.12));
            let bestKey=null,best=null,bestScore=Infinity;
            for(const [key,rt] of webRuntime.corners){
                if(rt?.trackedDynamic!==true||rt.layerId!==lid||rt.pathIndex!==pathIndex||rt.seenFrame===frameId)continue;
                const du=webWrappedUnitDistance(rt.anchorU,u);
                const ds=Math.hypot((Number(rt.anchorX)||0)-px,(Number(rt.anchorY)||0)-py);
                if(du>.18&&ds>spatialGate)continue;
                const score=du*260+ds/Math.max(1,spatialGate)*24;
                if(score<bestScore){bestScore=score;best=rt;bestKey=key;}
            }
            if(!best){
                const id=webRuntime.nextCornerTrackId++;
                bestKey=`${lid}:dyn:${pathIndex}:${id}`;
                best={growth:0,last:now,lastSeen:now,trackedDynamic:true,layerId:lid,pathIndex,anchorU:u,anchorX:px,anchorY:py,seenFrame:frameId};
                webRuntime.corners.set(bestKey,best);
            }
            best.seenFrame=frameId;best.lastSeen=now;best.anchorU=u;best.anchorX=px;best.anchorY=py;
            return best;
        }
        function collectWebSharpCorners(paths, thresholdDeg, hysteresisDeg = 8) {
            const threshold=Math.max(1,Math.min(179,Number(thresholdDeg)||45));
            const margin=Math.max(2,Math.min(18,Number(hysteresisDeg)||8));
            const prepared=webCornersPreparedFrame;
            if(prepared&&prepared.frameId===frameGeometryRuntime.frameId&&prepared.paths===paths&&prepared.threshold===threshold&&prepared.margin===margin)return prepared.corners;
            const corners=webDrawScratch.corners;corners.length=0;
            for(let pi=0;pi<(paths||[]).length;pi++){
                const path=paths[pi],pts=path?.points||[],closed=Boolean(path?.closed);
                if(pts.length<3)continue;
                const areaSign=closed?(webSignedArea(pts)>=0?1:-1):0;
                const start=closed?0:1,end=closed?pts.length:pts.length-1;
                for(let i=start;i<end;i++){
                    // cornerFlags are metadata, not a visibility mask. Static cached geometry
                    // can mark only authored profile corners while still containing real polygon
                    // bends. Always evaluate the actual current angle so web behavior matches
                    // static and morphing geometry.
                    const stableOrdinal=i;
                    const prev=pts[(i-1+pts.length)%pts.length],p=pts[i],next=pts[(i+1)%pts.length];
                    const inX=p.x-prev.x,inY=p.y-prev.y,outX=next.x-p.x,outY=next.y-p.y;
                    const inLen=Math.hypot(inX,inY),outLen=Math.hypot(outX,outY); if(inLen<1e-4||outLen<1e-4)continue;
                    const dot=Math.max(-1,Math.min(1,(inX*outX+inY*outY)/(inLen*outLen)));
                    const turnDeg=Math.acos(dot)*180/Math.PI;
                    if(turnDeg < threshold-margin) continue;
                    const cross=inX*outY-inY*outX;
                    const signedTurn=closed?cross*areaSign:cross;
                    if(closed&&Math.abs(signedTurn)<=1e-7)continue;
                    const target=webSmoothstep01((turnDeg-(threshold-margin))/(margin*1.5));
                    const ci=corners.length;let c=webDrawScratch.cornerPool[ci];if(!c)c=webDrawScratch.cornerPool[ci]={};
                    c.x=p.x;c.y=p.y;c.turnDeg=turnDeg;c.target=target;c.concave=closed?signedTurn<0:false;c.convex=closed?signedTurn>0:true;c.pathIndex=pi;c.pointIndex=i;c.cornerOrdinal=stableOrdinal;
                    c.prevX=prev.x;c.prevY=prev.y;c.nextX=next.x;c.nextY=next.y;c.inLen=inLen;c.outLen=outLen;
                    c.uxPrev=(prev.x-p.x)/inLen;c.uyPrev=(prev.y-p.y)/inLen;c.uxNext=(next.x-p.x)/outLen;c.uyNext=(next.y-p.y)/outLen;
                    corners.push(c);
                    if(corners.length>=220){webCornersPreparedFrame={frameId:frameGeometryRuntime.frameId,paths,threshold,margin,corners};return corners;}
                }
            }
            webCornersPreparedFrame={frameId:frameGeometryRuntime.frameId,paths,threshold,margin,corners};
            return corners;
        }
        // v527: “В углах” means authored/structural KINKS, not every dense spline sample
        // whose local tangent happens to bend. Prefer cornerFlags/profile-corner metadata and
        // fall back to the angular detector only when the rail carries no structural markers.
        function collectWebKinkCorners(paths, thresholdDeg, hysteresisDeg = 8) {
            const threshold=Math.max(1,Math.min(179,Number(thresholdDeg)||45));
            const margin=Math.max(2,Math.min(18,Number(hysteresisDeg)||8));
            let hasMarkers=false;
            for(const path of paths||[]){
                const flags=Array.isArray(path?.cornerFlags)?path.cornerFlags:null,pts=path?.points||[];
                if(flags?.some(Boolean)||pts.some(p=>p?.__profileKeyCorner===true||p?.__profileCorner===true)){hasMarkers=true;break;}
            }
            if(!hasMarkers)return collectWebSharpCorners(paths,threshold,margin);
            const out=[];
            for(let pi=0;pi<(paths||[]).length;pi++){
                const path=paths[pi],pts=path?.points||[],closed=Boolean(path?.closed),flags=Array.isArray(path?.cornerFlags)?path.cornerFlags:null;
                if(pts.length<3)continue;
                const areaSign=closed?(webSignedArea(pts)>=0?1:-1):0,start=closed?0:1,end=closed?pts.length:pts.length-1;
                for(let i=start;i<end;i++){
                    const p=pts[i],marked=flags?.[i]===true||p?.__profileKeyCorner===true||p?.__profileCorner===true;if(!marked)continue;
                    const prev=pts[(i-1+pts.length)%pts.length],next=pts[(i+1)%pts.length];
                    const inX=p.x-prev.x,inY=p.y-prev.y,outX=next.x-p.x,outY=next.y-p.y,inLen=Math.hypot(inX,inY),outLen=Math.hypot(outX,outY);if(inLen<1e-4||outLen<1e-4)continue;
                    const dot=Math.max(-1,Math.min(1,(inX*outX+inY*outY)/(inLen*outLen))),turnDeg=Math.acos(dot)*180/Math.PI;if(turnDeg<threshold-margin)continue;
                    const cross=inX*outY-inY*outX,signedTurn=closed?cross*areaSign:cross;if(closed&&Math.abs(signedTurn)<=1e-7)continue;
                    out.push({x:p.x,y:p.y,turnDeg,target:webSmoothstep01((turnDeg-(threshold-margin))/(margin*1.5)),concave:closed?signedTurn<0:false,convex:closed?signedTurn>0:true,pathIndex:pi,pointIndex:i,cornerOrdinal:i,prevX:prev.x,prevY:prev.y,nextX:next.x,nextY:next.y,inLen,outLen,uxPrev:(prev.x-p.x)/inLen,uyPrev:(prev.y-p.y)/inLen,uxNext:(next.x-p.x)/outLen,uyNext:(next.y-p.y)/outLen});
                    if(out.length>=220)return out;
                }
            }
            return out;
        }

        // v138: Web threads keep their stable logical corner anchors, but their
        // visible geometry is clipped by the exact rounded contour used by the
        // current frame. This makes Web coincide with static/Morph rounding without
        // deriving unstable "corners" from the densely sampled rounded path itself.
        function buildWebRoundedContourClipPath(paths){
            if(typeof Path2D==='undefined'||!Array.isArray(paths)||!paths.length)return null;
            const clip=new Path2D();
            let hasClosed=false;
            for(const path of paths){
                const pts=path?.points||[];
                if(path?.closed!==true||pts.length<3)continue;
                clip.moveTo(Number(pts[0].x)||0,Number(pts[0].y)||0);
                for(let i=1;i<pts.length;i++)clip.lineTo(Number(pts[i].x)||0,Number(pts[i].y)||0);
                clip.closePath();
                hasClosed=true;
            }
            return hasClosed?clip:null;
        }

        // v139: Web depth walks along the complete visible contour instead of being
        // limited by the two immediate samples adjacent to a corner. On a closed path,
        // 100% at ×1 equals one quarter of the perimeter in both directions, so the
        // resulting chord reaches roughly through the figure centre. ×2 reaches almost
        // half the perimeter in both directions and therefore sweeps nearly to the
        // opposite side of the shape.
        function nearestWebDistanceOnTable(table,x,y,out=webDrawScratch.nearest){
            const px=Number(x)||0,py=Number(y)||0;
            let bestSq=Infinity,bestDistance=0,bestX=px,bestY=py;
            for(const seg of table?.segs||[]){
                const vx=seg.b.x-seg.a.x,vy=seg.b.y-seg.a.y,den=vx*vx+vy*vy;
                const u=den>1e-12?Math.max(0,Math.min(1,((px-seg.a.x)*vx+(py-seg.a.y)*vy)/den)):0;
                const qx=seg.a.x+vx*u,qy=seg.a.y+vy*u,dx=qx-px,dy=qy-py,sq=dx*dx+dy*dy;
                if(sq<bestSq){bestSq=sq;bestDistance=seg.start+seg.len*u;bestX=qx;bestY=qy;}
            }
            out.distance=bestDistance;out.x=bestX;out.y=bestY;return out;
        }
        function pointAtWrappedWebDistance(table,distance,out){
            const total=Number(table?.total)||0;
            if(total<=1e-8){out.x=0;out.y=0;return out;}
            let d=Number(distance)||0;d=((d%total)+total)%total;
            return pointAtPathDistance(table,Math.min(total-1e-9,d),out);
        }
        // v525: "Глубина в угол" is a real percentage of the visible contour span
        // between neighbouring detected corners.  The previous 3 px per percent rule made
        // a nominal 20% depend on sampling density and could collapse to almost nothing on
        // rounded / morphing paths.  Project logical corners onto the actual visible rail once
        // per frame and derive the two neighbouring arc lengths there.
        function buildWebCornerMetrics(corners,tables,visualPaths){
            const metrics=new Array(corners?.length||0),groups=new Map();
            for(let i=0;i<metrics.length;i++){
                const c=corners[i],table=tables?.[c.pathIndex],path=visualPaths?.[c.pathIndex];
                if(!(table?.total>4)){metrics[i]=null;continue;}
                const near=nearestWebDistanceOnTable(table,c.x,c.y,{distance:0,x:0,y:0});
                const m={distance:near.distance,x:near.x,y:near.y,total:table.total,closed:path?.closed===true,cornerSpan:0};
                metrics[i]=m;let g=groups.get(c.pathIndex);if(!g){g=[];groups.set(c.pathIndex,g);}g.push(i);
            }
            for(const indices of groups.values()){
                indices.sort((a,b)=>metrics[a].distance-metrics[b].distance);
                const n=indices.length;
                for(let rank=0;rank<n;rank++){
                    const idx=indices[rank],m=metrics[idx],c=corners[idx],total=m.total;
                    let before=Infinity,after=Infinity;
                    if(n>1){
                        if(rank>0)before=m.distance-metrics[indices[rank-1]].distance;
                        else if(m.closed)before=m.distance+(total-metrics[indices[n-1]].distance);
                        if(rank<n-1)after=metrics[indices[rank+1]].distance-m.distance;
                        else if(m.closed)after=(total-m.distance)+metrics[indices[0]].distance;
                    }
                    // Open/single-corner paths keep a geometric fallback, but never use
                    // immediate dense rounded samples as the sole depth definition.
                    const fallback=Math.max(0,Math.min(Number(c?.inLen)||0,Number(c?.outLen)||0));
                    if(!Number.isFinite(before)||before<=1e-6)before=fallback;
                    if(!Number.isFinite(after)||after<=1e-6)after=fallback;
                    m.cornerSpan=Math.max(0,Math.min(before,after,total*.499));
                    // When rounding has replaced the authored kink by an arc, recover that arc's
                    // centre from three points on the exact visible contour. Spider Sun rays then
                    // originate at the rounding radius centre rather than from an arbitrary sample.
                    m.roundCenterX=Number(c?.x)||m.x;m.roundCenterY=Number(c?.y)||m.y;m.rounded=false;
                    const displaced=Math.hypot(m.x-(Number(c?.x)||m.x),m.y-(Number(c?.y)||m.y));
                    if(m.closed&&m.cornerSpan>3&&displaced>.5){const probe=Math.max(1.5,Math.min(m.cornerSpan*.32,total*.035)),pa=pointAtWrappedWebDistance(tables[c.pathIndex],m.distance-probe,{x:0,y:0}),pb=pointAtWrappedWebDistance(tables[c.pathIndex],m.distance+probe,{x:0,y:0});const ax=pa.x,ay=pa.y,bx=m.x,by=m.y,cx=pb.x,cy=pb.y,den=2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by));if(Math.abs(den)>1e-5){const aa=ax*ax+ay*ay,bb=bx*bx+by*by,cc=cx*cx+cy*cy,ux=(aa*(by-cy)+bb*(cy-ay)+cc*(ay-by))/den,uy=(aa*(cx-bx)+bb*(ax-cx)+cc*(bx-ax))/den,rr=Math.hypot(ux-bx,uy-by);if(Number.isFinite(rr)&&rr<Math.max(8,m.cornerSpan*4)){m.roundCenterX=ux;m.roundCenterY=uy;m.rounded=true;}}}
                }
            }
            return metrics;
        }

        function getPersistentWebClipPath(paths){
            if(!paths||isCurrentFrameDynamicPathList(paths))return buildWebRoundedContourClipPath(paths);
            if(persistentWebClipCache.has(paths))return persistentWebClipCache.get(paths);
            const clip=buildWebRoundedContourClipPath(paths);persistentWebClipCache.set(paths,clip||null);return clip;
        }
        const lightningOutsideClipCache=new WeakMap();
        function buildLightningOutsideClipPath(paths){
            if(typeof Path2D==='undefined'||!Array.isArray(paths)||!paths.length)return null;
            let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,hasClosed=false;
            for(const path of paths){
                if(path?.closed!==true)continue;
                const pts=path?.points||[];if(pts.length<3)continue;
                hasClosed=true;for(const p of pts){const x=Number(p?.x),y=Number(p?.y);if(!Number.isFinite(x)||!Number.isFinite(y))continue;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
            }
            if(!hasClosed||!Number.isFinite(minX)||!Number.isFinite(minY)||!Number.isFinite(maxX)||!Number.isFinite(maxY))return null;
            const span=Math.max(1,maxX-minX,maxY-minY),pad=Math.max(4096,span*12);
            const clip=new Path2D();clip.rect(minX-pad,minY-pad,(maxX-minX)+pad*2,(maxY-minY)+pad*2);
            for(const path of paths){
                const pts=path?.points||[];if(path?.closed!==true||pts.length<3)continue;
                clip.moveTo(Number(pts[0].x)||0,Number(pts[0].y)||0);for(let i=1;i<pts.length;i++)clip.lineTo(Number(pts[i].x)||0,Number(pts[i].y)||0);clip.closePath();
            }
            return clip;
        }
        function getPersistentLightningOutsideClipPath(paths){
            if(!paths||isCurrentFrameDynamicPathList(paths))return buildLightningOutsideClipPath(paths);
            if(lightningOutsideClipCache.has(paths))return lightningOutsideClipCache.get(paths);
            const clip=buildLightningOutsideClipPath(paths);lightningOutsideClipCache.set(paths,clip||null);return clip;
        }
        function getPreparedLightningClipPath(prepared,behavior){
            if(!prepared?.visible?.length)return null;
            const mode=normalizeLightningBehaviorValue(behavior,'symmetric');
            if(mode==='symmetric')return null;
            // v293: dynamic morph geometry reuses scratch-array identities, so clear these
            // slots when the frame is prepared (see getPreparedLightningFrame). Within one
            // frame every tunnel copy then shares exactly one Path2D mask instead of rebuilding it.
            if(mode==='inside'){
                if(prepared._insideClipPath===undefined)prepared._insideClipPath=getPersistentWebClipPath(prepared.visible)||null;
                return prepared._insideClipPath;
            }
            if(prepared._outsideClipPath===undefined)prepared._outsideClipPath=getPersistentLightningOutsideClipPath(prepared.visible)||null;
            return prepared._outsideClipPath;
        }
        const persistentWebKinkCornerCache=new WeakMap();
        function getPersistentWebKinkCorners(paths,threshold,margin=8){
            if(!paths||isCurrentFrameDynamicPathList(paths))return collectWebKinkCorners(paths,threshold,margin);
            let variants=persistentWebKinkCornerCache.get(paths);if(!variants){variants=new Map();persistentWebKinkCornerCache.set(paths,variants);}const key=`${Number(threshold).toFixed(4)}|${Number(margin).toFixed(2)}`;const hit=variants.get(key);if(hit)return hit;
            const stable=collectWebKinkCorners(paths,threshold,margin).map(c=>({...c}));variants.set(key,stable);return stable;
        }
        function getPersistentWebCorners(paths,threshold,margin=8){
            if(!paths||isCurrentFrameDynamicPathList(paths))return collectWebSharpCorners(paths,threshold,margin);
            let variants=persistentWebCornerCache.get(paths);if(!variants){variants=new Map();persistentWebCornerCache.set(paths,variants);}const key=`${Number(threshold).toFixed(4)}|${Number(margin).toFixed(2)}`;const hit=variants.get(key);if(hit)return hit;
            const stable=collectWebSharpCorners(paths,threshold,margin).map(c=>({...c}));variants.set(key,stable);return stable;
        }
        function getPersistentWebVectorRecord(paths,key){
            if(!paths||isCurrentFrameDynamicPathList(paths))return null;
            let variants=persistentWebVectorCache.get(paths);if(!variants){variants=new Map();persistentWebVectorCache.set(paths,variants);}let rec=variants.get(key);if(!rec){rec={paths:Object.create(null),gpuCommandCaches:Object.create(null)};variants.set(key,rec);}else{if(!rec.paths)rec.paths=Object.create(null);if(!rec.gpuCommandCaches)rec.gpuCommandCaches=Object.create(null);}return rec;
        }

        function prepareLayerFrameWebData(frameCtx){
            if(!frameCtx)return null;
            if(frameCtx.webPreparedReady)return frameCtx.webPrepared;
            const layer=frameCtx.layer,paths=getLayerFrameAuxiliaryPaths(frameCtx);
            let data=frameCtx.webData;if(!data)data=frameCtx.webData={};
            data.enabled=getLayerWebEnabled(layer)===true;data.layerIndex=frameCtx.layerIndex;data.paths=paths;data.visualPaths=null;data.clipPath=null;data.insideClipPath=null;data.outsideClipPath=null;data.cfg=null;data.corners=[];data.spacing=0;data.depthPercent=0;data.depthMultiplier=1;data.jitterStrength=0;data.region='inside';data.insideEnabled=true;data.outsideStraightEnabled=false;data.outsideArcEnabled=false;data.placementMode='selfIntersection';data.oscillating=false;data.oscillationStrength=10;data.oscillationStrengthMultiplier=1;data.oscillationMultiplier=1;data.oscillationPhase=0;data.color='#ffffff';data.secondaryColor='#00ffff';data.sunDegrees=20;data.width=0;data.renderWidth=0;data.threadAlpha=.88;data.haloRadius=1;data.shadowBlur=1;data.style='web';data.now=frameCtx.now||performance.now();data.owner=null;data.transition=null;data.visibilityFactor=1;
            data.pathBevel=null;data.pathRounding=null;data.animating=false;data.visualPathTables=null;data.cornerMetrics=null;data.persistentVectorRecord=null;data._branchPathCache=null;
            if(data.enabled&&paths?.length){
                const owner=ensureLayerEffectState(layer),cfg=owner?.web||getLayerWebConfig(layer);data.owner=owner;data.transition=owner?webRuntime.transitionByLayer.get(owner.id):null;data.cfg=cfg;
                data.visualPaths=getLayerFrameRoundedPaths(frameCtx);
                const branches=getWebBranchFlags(cfg);data.insideEnabled=branches.inside;data.outsideStraightEnabled=branches.outsideStraight;data.outsideArcEnabled=branches.outsideArc;
                data.region=branches.inside?(branches.outsideArc?'combined':'inside'):(branches.outsideArc?'outside':'inside');
                data.placementMode=['corners','selfIntersection','selfIntersectionCorridor'].includes(cfg.placementMode)?cfg.placementMode:'selfIntersection';
                data.oscillating=cfg.oscillating===true;
                data.oscillationStrength=Math.max(0,Math.min(100,Number.isFinite(Number(cfg.oscillationStrength))?Number(cfg.oscillationStrength):10));
                data.oscillationStrengthMultiplier=Math.max(.015625,Math.min(64,Number.isFinite(Number(cfg.oscillationStrengthMultiplier))?Number(cfg.oscillationStrengthMultiplier):1));
                data.oscillationMultiplier=Math.max(.015625,Math.min(64,Number.isFinite(Number(cfg.oscillationMultiplier))?Number(cfg.oscillationMultiplier):1));
                const morphCycleSec=typeof getTapMorphIntervalSec==='function'?getTapMorphIntervalSec(Number(state?.morph?.intervalSec)||5,'full'):(Number(state?.morph?.intervalSec)||5),morphCycleMs=Math.max(100,morphCycleSec*1000);
                // Oscillation is an independent absolute-time effect. It must never reset or
                // stall when blue/green Morph changes its phase or FPS governor cadence.
                data.oscillationPhase=((data.now%morphCycleMs)/morphCycleMs)*Math.PI*2*data.oscillationMultiplier;
                data.insideClipPath=getPersistentWebClipPath(data.visualPaths);
                data.outsideClipPath=getPersistentLightningOutsideClipPath(data.visualPaths);
                data.clipPath=(branches.inside&&!branches.outsideStraight&&!branches.outsideArc)?data.insideClipPath:((!branches.inside&&(branches.outsideStraight||branches.outsideArc))?data.outsideClipPath:null);
                data.visualPathTables=new Array(data.visualPaths?.length||0);
                const webStaticPaths=!isCurrentFrameDynamicPathList(data.visualPaths);
                for(let pi=0;pi<data.visualPathTables.length;pi++){
                    const vp=data.visualPaths[pi];
                    data.visualPathTables[pi]=vp?.points?.length>2?buildSinglePathLengthTable(vp,webStaticPaths):null;
                }
                const threshold=audioApplyNumeric('web.angleThreshold',Number(cfg.angleThreshold)||60,frameCtx.layerIndex);
                data.corners=(data.placementMode==='corners'||cfg.style==='spiderSun')?getPersistentWebKinkCorners(paths,threshold,8):getPersistentWebCorners(paths,threshold,8);
                data.cornerMetrics=buildWebCornerMetrics(data.corners,data.visualPathTables,data.visualPaths);
                data.spacing=Math.max(1,Math.min(80,audioApplyNumeric('web.spacing',Number(cfg.spacing)||10,frameCtx.layerIndex)));
                data.depthPercent=Math.max(0,Math.min(100,audioApplyNumeric('web.distance',Number.isFinite(Number(cfg.distance))?Number(cfg.distance):20,frameCtx.layerIndex)));
                data.depthMultiplier=Math.max(0,Number.isFinite(Number(cfg.depthMultiplier))?Number(cfg.depthMultiplier):1);
                const variation=Math.max(0,Math.min(45,audioApplyNumeric('web.angleVariation',Number(cfg.angleVariation)||0,frameCtx.layerIndex)));
                data.jitterStrength=Math.sin(variation*Math.PI/180)*.9;
                data.color=resolveWebPrimaryColor(cfg,layer,frameCtx);data.secondaryColor=/^#[0-9a-f]{6}$/i.test(cfg.secondaryColor||'')?cfg.secondaryColor:'#00ffff';data.sunDegrees=Math.max(5,Math.min(90,Number(cfg.sunDegrees)||20));
                const baseLineWidth=Math.max(.1,Number(frameCtx.strokeWidth)||audioApplyNumeric('layer.strokeWidth',Number(layer?.strokeWidth)||1.5,frameCtx.layerIndex)*getLayerStrokeWidthMultiplier(layer));
                const widthBase=cfg.widthRelative===true
                    ? Math.max(.05,Math.min(12,baseLineWidth*Math.max(.01,Math.min(4,(Number(cfg.widthPercent)||40)/100))))
                    : Math.max(.1,Math.min(4,Number(cfg.width)||.6));
                data.width=Math.max(.03,Math.min(24,audioApplyNumeric('web.width',widthBase,frameCtx.layerIndex)));
                const style=getWebStyleProfile(cfg,data.width,Number(frameCtx.frame?.dpr)||1);data.style=style.style;data.renderWidth=style.width;data.threadAlpha=style.alpha;data.haloRadius=style.halo;data.shadowBlur=style.shadow;
                const vecKey=[branches.inside?1:0,branches.outsideStraight?1:0,branches.outsideArc?1:0,data.style,data.placementMode,threshold.toFixed(3),data.spacing.toFixed(3),data.depthPercent.toFixed(3),data.depthMultiplier.toFixed(4),variation.toFixed(3)].join('|');
                data.persistentVectorRecord=(data.transition||data.oscillating)?null:getPersistentWebVectorRecord(data.visualPaths,vecKey);
                if(data.persistentVectorRecord)data._branchPathCache=data.persistentVectorRecord.paths;
            }
            frameCtx.webPrepared=data;frameCtx.webPreparedReady=true;
            return data;
        }

        function drawWebThreads(ctx, paths, layer, alpha = 1, forcedType = null, prepared=null, outerStateIsolated=false, forcedBranch=null) {
            if((prepared ? prepared.enabled!==true : getLayerWebEnabled(layer)!==true)||alpha<=.001)return;
            const glRecorder=ctx?.__spiroGLGeometryRecorder===true;
            const cfg=prepared?.cfg||getLayerWebConfig(layer),flags=prepared?{inside:prepared.insideEnabled===true,outsideStraight:prepared.outsideStraightEnabled===true,outsideArc:prepared.outsideArcEnabled===true}:getWebBranchFlags(cfg);
            const branches=forcedBranch?[forcedBranch]:['inside','outsideStraight','outsideArc'].filter(k=>flags[k]);
            if(!branches.length)return;
            // Canvas needs a different parity clip for the inside and outside branches.
            // Split them here; GPU callers normally request one explicit branch at a time.
            if(!forcedBranch&&branches.length>1&&!glRecorder){for(const branch of branches)drawWebThreads(ctx,paths,layer,alpha,forcedType,prepared,outerStateIsolated,branch);return;}
            const branch=forcedBranch||branches[0];if(!['inside','outsideStraight','outsideArc'].includes(branch)||!flags[branch])return;
            const layerIndex=Number.isInteger(prepared?.layerIndex)?prepared.layerIndex:-1;
            const effectivePlacement=(prepared?.placementMode||cfg.placementMode),useKinkCorners=effectivePlacement==='corners'||cfg.style==='spiderSun';
            const corners=prepared?.corners||(useKinkCorners?collectWebKinkCorners(paths||[],audioApplyNumeric('web.angleThreshold',Number(cfg.angleThreshold)||60,layerIndex),8):collectWebSharpCorners(paths||[],audioApplyNumeric('web.angleThreshold',Number(cfg.angleThreshold)||60,layerIndex),8));
            if(!corners.length)return;
            const type=forcedType ? (forcedType==='rounding'?'rounding':'bevel') : (cfg.type==='rounding'?'rounding':'bevel');
            const spacing=prepared?.spacing||Math.max(1,Math.min(80,audioApplyNumeric('web.spacing',Number(cfg.spacing)||10,layerIndex)));
            const depthPercent=Number.isFinite(prepared?.depthPercent)?prepared.depthPercent:Math.max(0,Math.min(100,audioApplyNumeric('web.distance',Number.isFinite(Number(cfg.distance))?Number(cfg.distance):20,layerIndex)));
            const depthMultiplier=Number.isFinite(prepared?.depthMultiplier)?prepared.depthMultiplier:Math.max(0,Number.isFinite(Number(cfg.depthMultiplier))?Number(cfg.depthMultiplier):1);
            const jitterStrength=Number.isFinite(prepared?.jitterStrength)?prepared.jitterStrength:Math.sin(Math.max(0,Math.min(45,audioApplyNumeric('web.angleVariation',Number(cfg.angleVariation)||0,layerIndex)))*Math.PI/180)*.9;
            const now=prepared?.now||performance.now();
            const placementMode=['corners','selfIntersection','selfIntersectionCorridor'].includes(prepared?.placementMode||cfg.placementMode)?(prepared?.placementMode||cfg.placementMode):'selfIntersection';
            const oscillating=(prepared?.oscillating??cfg.oscillating)===true,oscStrength=Math.max(0,Math.min(100,Number(prepared?.oscillationStrength??cfg.oscillationStrength??10))),oscStrengthMultiplier=Math.max(.015625,Math.min(64,Number(prepared?.oscillationStrengthMultiplier??cfg.oscillationStrengthMultiplier??1))),oscStrengthEffective=Math.min(8,(oscStrength/100)*oscStrengthMultiplier),oscMultiplier=Math.max(.015625,Math.min(64,Number(prepared?.oscillationMultiplier??cfg.oscillationMultiplier??1)));
            const webCycleSec=typeof getTapMorphIntervalSec==='function'?getTapMorphIntervalSec(Number(state?.morph?.intervalSec)||5,'full'):(Number(state?.morph?.intervalSec)||5),webCycleMs=Math.max(100,webCycleSec*1000);
            const oscillationPhase=Number.isFinite(Number(prepared?.oscillationPhase))?Number(prepared.oscillationPhase):((now%webCycleMs)/webCycleMs)*Math.PI*2*oscMultiplier;
            const color=prepared?.color||resolveWebPrimaryColor(cfg,layer,null),secondaryColor=prepared?.secondaryColor||(/^#[0-9a-f]{6}$/i.test(cfg.secondaryColor||'')?cfg.secondaryColor:'#00ffff'),sunDegrees=Math.max(5,Math.min(90,Number(prepared?.sunDegrees??cfg.sunDegrees)||20));
            let width=Number(prepared?.width)||0;
            if(!(width>0)){
                const baseLineWidth=Math.max(.1,audioApplyNumeric('layer.strokeWidth',Number(layer?.strokeWidth)||1.5,layerIndex)*getLayerStrokeWidthMultiplier(layer));
                const widthBase=cfg.widthRelative===true?Math.max(.05,Math.min(12,baseLineWidth*Math.max(.01,Math.min(4,(Number(cfg.widthPercent)||40)/100)))):Math.max(.1,Math.min(4,Number(cfg.width)||.6));
                width=Math.max(.03,Math.min(24,audioApplyNumeric('web.width',widthBase,layerIndex)));
            }
            const style=prepared?.renderWidth>0?{width:prepared.renderWidth,alpha:prepared.threadAlpha??.88,shadow:prepared.shadowBlur??Math.min(6,width*2.4)}:getWebStyleProfile(cfg,width,1);
            const visibility=Math.max(0,Math.min(1,Number(prepared?._visibilityFactor??prepared?.visibilityFactor??1)));
            if(visibility<=.0005)return;
            const cacheKey=`${type}:${branch}`;
            const cachedPath=(!oscillating&&visibility>=.999&&!prepared?.transition)?(prepared?._branchPathCache?.[cacheKey]||null):null;
            const clipPath=branch==='inside'?(prepared?.insideClipPath||prepared?.clipPath):(prepared?.outsideClipPath||prepared?.clipPath);
            if(cachedPath&&!glRecorder){
                if(!outerStateIsolated)ctx.save();
                if(clipPath){try{ctx.clip(clipPath,'evenodd');}catch(_err){ctx.clip(clipPath);}}
                ctx.globalAlpha=Math.max(0,Math.min(1,alpha*style.alpha));ctx.strokeStyle=color;ctx.lineWidth=style.width;ctx.lineCap='round';ctx.lineJoin='round';ctx.shadowColor=color;ctx.shadowBlur=style.shadow;
                ctx.stroke(cachedPath);if(style.style==='laser'&&secondaryColor!==color){ctx.strokeStyle=secondaryColor;ctx.shadowColor=secondaryColor;ctx.shadowBlur=Math.max(1,style.shadow*.65);ctx.lineWidth=Math.max(.08,style.width*.34);ctx.globalAlpha=Math.max(0,Math.min(1,alpha*style.alpha*.92));ctx.stroke(cachedPath);}if(!outerStateIsolated)ctx.restore();return;
            }

            let animating=false;
            const canCache=Boolean(prepared&&typeof Path2D!=='undefined'&&!glRecorder&&!oscillating&&visibility>=.999&&!prepared?.transition);
            const pathTarget=canCache?new Path2D():ctx;if(!canCache)ctx.beginPath();
            for(let ci=0;ci<corners.length;ci++){
                const c=corners[ci];
                const wantsConcave=branch==='outsideStraight';if(wantsConcave?c.concave!==true:c.concave===true)continue;
                const visualPath=prepared?.visualPaths?.[c.pathIndex]||paths?.[c.pathIndex],closed=visualPath?.closed===true;
                const table=prepared?.visualPathTables?.[c.pathIndex]||(visualPath?.points?.length>2?buildPathLengthTable([visualPath]):null),useContour=Boolean(table?.total>4);
                const metric=prepared?.cornerMetrics?.[ci]||null;
                let localMax=0,anchorDistance=0,anchorX=c.x,anchorY=c.y;
                if(metric&&useContour){anchorDistance=metric.distance;anchorX=metric.x;anchorY=metric.y;}
                else if(useContour){const near=nearestWebDistanceOnTable(table,c.x,c.y);anchorDistance=near.distance;anchorX=near.x;anchorY=near.y;}
                const localCornerMode=placementMode==='corners'||branch==='outsideStraight'||style.style==='spiderSun';
                if(!localCornerMode&&closed&&useContour){
                    localMax=Math.min(table.total*.499,table.total*.25*(Math.max(0,Math.min(100,depthPercent))/100)*depthMultiplier);
                }else{
                    const pct=Math.max(0,Math.min(100,depthPercent))/100;
                    const visibleSpan=metric?.cornerSpan>0?metric.cornerSpan:Math.max(0,Math.min(Number(c.inLen)||0,Number(c.outLen)||0));
                    localMax=Math.max(0,Math.min(useContour?table.total*.499:Infinity,visibleSpan*pct*depthMultiplier));
                }
                if(localMax<1)continue;
                const maxCount=Math.max(1,Math.min(96,Math.floor(localMax/spacing)));
                let rt;const dynamicWebPaths=isCurrentFrameDynamicPathList(paths)||isCurrentFrameDynamicPathList(prepared?.visualPaths);
                if(dynamicWebPaths&&useContour){rt=resolveDynamicWebCornerRuntime(layer?.id||'layer',c.pathIndex,anchorDistance/table.total,anchorX,anchorY,table.total,now);}
                else{const key=`${layer?.id||'layer'}:${c.pathIndex}:${c.cornerOrdinal}`;rt=webRuntime.corners.get(key);if(!rt){rt={growth:0,last:now,lastSeen:now};webRuntime.corners.set(key,rt);}}
                const rawDt=Math.max(0,(now-rt.last)/1000),dt=rawDt>1.25?0:rawDt;rt.last=now;rt.lastSeen=now;const target=placementMode==='corners'?1:Math.max(0,Math.min(1,c.target));
                const visibilityTransition=prepared?.transition?.kind==='visibility';
                if(visibilityTransition){
                    // Visibility itself is the birth/death envelope.  Do not multiply it by a
                    // second slow attack: that was the apparent "wait until the cycle ends".
                    // Each next thread now grows continuously from the corner as visibility rises.
                    rt.growth=target;
                }else{
                    const k=1-Math.exp(-dt*8.5);rt.growth+=(target-rt.growth)*k;if(Math.abs(target-rt.growth)>.004)animating=true;
                }
                const totalPhase=rt.growth*maxCount*visibility;
                if(style.style==='spiderSun'){
                    const grow=webSmoothstep01(Math.max(0,Math.min(1,rt.growth*visibility)));
                    if(grow>.001){
                        const originX=metric?.rounded===true?metric.roundCenterX:(Number(c.x)||anchorX),originY=metric?.rounded===true?metric.roundCenterY:(Number(c.y)||anchorY),reach=Math.max(1,localMax*grow);
                        let va={x:c.uxPrev,y:c.uyPrev},vb={x:c.uxNext,y:c.uyNext};
                        if(useContour){const aa=pointAtWrappedWebDistance(table,anchorDistance-localMax,webDrawScratch.pointA),bb=pointAtWrappedWebDistance(table,anchorDistance+localMax,webDrawScratch.pointB),al=Math.hypot(aa.x-originX,aa.y-originY),bl=Math.hypot(bb.x-originX,bb.y-originY);if(al>1e-4)va={x:(aa.x-originX)/al,y:(aa.y-originY)/al};if(bl>1e-4)vb={x:(bb.x-originX)/bl,y:(bb.y-originY)/bl};}
                        let a0=Math.atan2(va.y,va.x),a1=Math.atan2(vb.y,vb.x),delta=((a1-a0+Math.PI*3)%(Math.PI*2))-Math.PI;
                        // “Паучье Солнце”: the first/primary median is the true angular
                        // bisector. Extra medians are added symmetrically at sunDegrees so
                        // changing density never makes the whole fan jump sideways.
                        const mid=a0+delta*.5,half=Math.abs(delta)*.5,step=Math.max(5,sunDegrees)*Math.PI/180,offsets=[0];
                        for(let off=step;off<half-1e-5&&offsets.length<35;off+=step){offsets.push(-off,off);}
                        if(half>1e-5){offsets.push(-half,half);}offsets.sort((a,b)=>a-b);
                        const rays=[];for(let ri=0;ri<Math.min(36,offsets.length);ri++){const off=offsets[ri],phase=oscillating?Math.sin(oscillationPhase+ri*.73+c.cornerOrdinal*.19)*(.035*oscStrengthEffective):0,ang=mid+Math.sign(delta||1)*off+phase,edge=half>1e-5?Math.min(1,Math.abs(off)/half):0,rr=reach*(1-.08*edge),x=originX+Math.cos(ang)*rr,y=originY+Math.sin(ang)*rr;rays.push({ang,x,y});pathTarget.moveTo(originX,originY);pathTarget.lineTo(x,y);}
                        rays.sort((a,b)=>a.ang-b.ang);const rings=Math.max(1,Math.min(28,Math.floor(reach/Math.max(2,spacing))));for(let qi=1;qi<=rings;qi++){const rf=qi/rings;for(let ri=0;ri<rays.length-1;ri++){const p0=rays[ri],p1=rays[ri+1];pathTarget.moveTo(originX+(p0.x-originX)*rf,originY+(p0.y-originY)*rf);pathTarget.lineTo(originX+(p1.x-originX)*rf,originY+(p1.y-originY)*rf);}}
                        if(oscillating)animating=true;
                    }
                    continue;
                }
                for(let ti=0;ti<maxCount;ti++){
                    const life=totalPhase-ti;if(life<=.001)continue;
                    const isStraight=branch==='outsideStraight',tg=isStraight?1:webSmoothstep01(life);
                    const base=Math.min(localMax,spacing*(ti+1)),rnd=webHashSigned(c.pathIndex,c.cornerOrdinal,ti,137),asym=rnd*jitterStrength;
                    let rawDa=Math.max(.25,Math.min(localMax,base*(1+asym*.55))),rawDb=Math.max(.25,Math.min(localMax,base*(1-asym*.55)));
                    const threadPhase=webHashSigned(c.pathIndex,c.cornerOrdinal,ti,911)*Math.PI,wave=Math.sin(oscillationPhase+threadPhase);
                    if(isStraight&&oscillating&&oscStrength>0){const slide=Math.min(.78,.035+.245*oscStrengthEffective)*wave;rawDa=Math.max(.25,Math.min(localMax,rawDa*(1+slide)));rawDb=Math.max(.25,Math.min(localMax,rawDb*(1-slide)));animating=true;}
                    const da=rawDa*tg,db=rawDb*tg;let ax,ay,bx,by;
                    if(useContour){const a=pointAtWrappedWebDistance(table,anchorDistance-da,webDrawScratch.pointA),b=pointAtWrappedWebDistance(table,anchorDistance+db,webDrawScratch.pointB);ax=a.x;ay=a.y;bx=b.x;by=b.y;}
                    else{ax=c.x+c.uxPrev*da;ay=c.y+c.uyPrev*da;bx=c.x+c.uxNext*db;by=c.y+c.uyNext*db;}
                    const dx=bx-ax,dy=by-ay,len=Math.max(.001,Math.hypot(dx,dy)),midX=(ax+bx)*.5,midY=(ay+by)*.5;
                    let waveX=0,waveY=0;
                    if(!isStraight&&oscillating&&oscStrength>0){const amp=Math.min(144,Math.max(.25,spacing*(.25+1.75*oscStrengthEffective))),nx=-dy/len,ny=dx/len;waveX=nx*amp*wave*tg;waveY=ny*amp*wave*tg;animating=true;}
                    pathTarget.moveTo(ax,ay);
                    if(branch==='inside'){
                        if(type==='bevel'){if(oscillating&&oscStrength>0)pathTarget.quadraticCurveTo(midX+waveX,midY+waveY,bx,by);else pathTarget.lineTo(bx,by);}
                        else pathTarget.quadraticCurveTo(anchorX+waveX,anchorY+waveY,bx,by);
                    }else if(branch==='outsideStraight'){
                        pathTarget.lineTo(bx,by);
                    }else{
                        let vx=anchorX-midX,vy=anchorY-midY,vl=Math.hypot(vx,vy);if(vl<.001){vx=-dy;vy=dx;vl=Math.max(.001,Math.hypot(vx,vy));}
                        // Crucial v523 fix: the control point collapses with tg too, so a curved
                        // outside thread grows from and returns into the corner instead of popping.
                        const reach=Math.max(spacing*tg,Math.max(rawDa,rawDb)*.55*tg),controlX=anchorX+(vx/vl)*reach+waveX,controlY=anchorY+(vy/vl)*reach+waveY;
                        pathTarget.quadraticCurveTo(controlX,controlY,bx,by);
                    }
                }
            }
            if(canCache){prepared._branchPathCache=prepared._branchPathCache||Object.create(null);prepared._branchPathCache[cacheKey]=pathTarget;if(!animating&&prepared?.persistentVectorRecord&&!prepared?.transition)prepared.persistentVectorRecord.paths[cacheKey]=pathTarget;}
            if(prepared)prepared.animating=prepared.animating||animating||visibility<.999;
            if(!outerStateIsolated)ctx.save();if(!glRecorder&&clipPath){try{ctx.clip(clipPath,'evenodd');}catch(_err){ctx.clip(clipPath);}}
            ctx.globalAlpha=Math.max(0,Math.min(1,alpha*style.alpha));ctx.strokeStyle=color;ctx.lineWidth=style.width;ctx.lineCap='round';ctx.lineJoin='round';ctx.shadowColor=color;ctx.shadowBlur=style.shadow;if(canCache)ctx.stroke(pathTarget);else ctx.stroke();if(style.style==='laser'&&secondaryColor!==color){ctx.globalAlpha=Math.max(0,Math.min(1,alpha*style.alpha*.92));ctx.strokeStyle=secondaryColor;ctx.shadowColor=secondaryColor;ctx.shadowBlur=Math.max(1,style.shadow*.65);ctx.lineWidth=Math.max(.08,style.width*.34);if(canCache)ctx.stroke(pathTarget);else ctx.stroke();}if(!outerStateIsolated)ctx.restore();
            if(now-webRuntime.lastCleanup>1200){webRuntime.lastCleanup=now;for(const [key,rt0] of webRuntime.corners){const ttl=rt0?.trackedDynamic===true?3200:1800;if(now-rt0.lastSeen>ttl)webRuntime.corners.delete(key);}}
            if((animating||oscillating||visibility<.999)&&(!prepared||prepared._renderRequestedFrame!==frameGeometryRuntime.frameId)){if(prepared)prepared._renderRequestedFrame=frameGeometryRuntime.frameId;requestMainCanvasRender();}
        }

        function drawWebThreadsAnimated(ctx, paths, layer, alpha = 1, prepared=null, outerStateIsolated=false, forcedBranch=null) {
            if ((prepared ? prepared.enabled!==true : getLayerWebEnabled(layer) !== true) || alpha <= .001) return;
            const owner=prepared?.owner||ensureLayerEffectState(layer),tr=prepared?prepared.transition:(owner?webRuntime.transitionByLayer.get(owner.id):null);
            if (!tr) {if(owner?.showWeb!==true)return;if(prepared)prepared._visibilityFactor=1;drawWebThreads(ctx,paths,layer,alpha,null,prepared,outerStateIsolated,forcedBranch);return;}
            const duration=Math.max(60,Number(tr.duration)||180),now=prepared?.now||performance.now(),p=Math.max(0,Math.min(1,(now-Number(tr.start||0))/duration)),e=webSmoothstep01(p);
            if(tr.kind==='visibility'){
                const from=Math.max(0,Math.min(1,Number(tr.from)||0)),to=Math.max(0,Math.min(1,Number(tr.to)||0));
                // Faster initial motion on reveal, smoothstep on collapse: visibly immediate
                // without a discontinuity in geometry or alpha.
                const ve=to>from?(1-Math.pow(1-p,3)):e,factor=from+(to-from)*ve;
                if(prepared)prepared._visibilityFactor=factor;
                if(factor>.0005)drawWebThreads(ctx,paths,layer,alpha,null,prepared,outerStateIsolated,forcedBranch);
                if(p>=1&&owner){
                    if(tr.disableAtEnd===true||to<=.0005){owner.showWeb=false;for(const key of Array.from(webRuntime.corners.keys()))if(String(key).startsWith(`${owner.id}:`))webRuntime.corners.delete(key);}
                    webRuntime.transitionByLayer.delete(owner.id);webRuntime.desiredVisibilityByLayer.delete(owner.id);if(prepared){prepared.transition=null;prepared._visibilityFactor=to;}
                }else if(!prepared||prepared._transitionRenderRequestedFrame!==frameGeometryRuntime.frameId){if(prepared)prepared._transitionRenderRequestedFrame=frameGeometryRuntime.frameId;requestMainCanvasRender();}
                return;
            }
            if(prepared)prepared._visibilityFactor=1;
            if (tr.kind === 'type') {
                if (1 - e > .001) drawWebThreads(ctx,paths,layer,alpha*(1-e),tr.fromType,prepared,outerStateIsolated,forcedBranch);
                if (e > .001) drawWebThreads(ctx,paths,layer,alpha*e,tr.toType,prepared,outerStateIsolated,forcedBranch);
            } else {
                if (e > .001) drawWebThreads(ctx,paths,layer,alpha*e,tr.toType,prepared,outerStateIsolated,forcedBranch);
            }
            if (p >= 1 && owner) {webRuntime.transitionByLayer.delete(owner.id);if(prepared)prepared.transition=null;}
            else if(!prepared||prepared._transitionRenderRequestedFrame!==frameGeometryRuntime.frameId){if(prepared)prepared._transitionRenderRequestedFrame=frameGeometryRuntime.frameId;requestMainCanvasRender();}
        }

        function getLightningFlashAlpha(progress) {
            const p=Math.max(0,Math.min(1,Number(progress)||0));
            if(p<.86) return 0;
            if(p<.94){const x=(p-.86)/.08;return x*x*(3-2*x);}
            const x=(p-.94)/.06; const q=1-Math.max(0,Math.min(1,x)); return q*q;
        }
        function syncMorphModeDependentUI() {
            const mode=state.morph.mode;
            const fade=document.getElementById('morphFadeDurationRow');
            const slide=document.getElementById('morphSlideTypeRow');
            const overflow=document.getElementById('morphCircleOverflowRow');
            fade?.classList.toggle('is-visible', mode==='fade');
            // Sliding only makes sense while points actually move. Fade teleports them.
            slide?.classList.toggle('is-visible', ['topology','calm','circleSlide','light'].includes(mode));
            // Radius overflow is a property of circular morphing only.
            overflow?.classList.toggle('hidden', mode!=='circleSlide');
        }
        function syncMotionUI(){
            const m=normalizeMotionState(),active=getActiveEffectLayer(),r=normalizeLayerMotionRotation(active);
            const setCheck=(id,v)=>{const el=document.getElementById(id);if(el)el.checked=v===true;};
            const setVal=(id,v)=>{const el=document.getElementById(id);if(el&&document.activeElement!==el)el.value=String(v);};
            const rotationTargets=getMotionRotationTargets();
            const rotationEnabled=state.masterLayerEdit===true&&rotationTargets.length?rotationTargets.every(l=>normalizeLayerMotionRotation(l).enabled):r.enabled;
            setCheck('motionRotationEnabled',rotationEnabled);setVal('motionRotationSpeed',r.speed);setVal('motionRotationMultiplier',r.multiplier);setVal('motionTunnelLag',r.tunnelLag);setVal('motionTunnelLagMultiplier',r.tunnelLagMultiplier);
            const dir=document.getElementById('motionRotationDirection');if(dir){dir.value=r.direction;dir.dataset.direction=r.direction;dir.textContent=r.direction==='cw'?'↻ По часовой':'↺ Против часовой';dir.setAttribute('aria-label',r.direction==='cw'?'Направление вращения слоя: по часовой. Клик — против часовой':'Направление вращения слоя: против часовой. Клик — по часовой');dir.setAttribute('aria-pressed',r.direction==='cw'?'true':'false');}
            setCheck('motionCameraEnabled',m.cameraEnabled);setVal('motionCameraSpeed',m.cameraSpeed);setVal('motionCameraMultiplier',m.cameraMultiplier);setVal('motionCameraAmount',m.cameraAmount);
            setCheck('motionColorEnabled',m.colorEnabled);setVal('motionColorSpeed',m.colorSpeed);setVal('motionColorMultiplier',m.colorMultiplier);
            const rt=document.getElementById('motionRotationSpeedText');if(rt)rt.textContent=`${formatDisplayNumber(r.speed,0)}°/с × ${formatDisplayNumber(r.multiplier,2)}`;
            const lag=document.getElementById('motionTunnelLagText');if(lag)lag.textContent=`${formatDisplayNumber(r.tunnelLag,0)}° × ${formatDisplayNumber(r.tunnelLagMultiplier,2)}`;
            const ct=document.getElementById('motionCameraSpeedText');if(ct)ct.textContent=`${formatDisplayNumber(m.cameraSpeed,0)}% × ${formatDisplayNumber(m.cameraMultiplier,2)}`;
            const ca=document.getElementById('motionCameraAmountText');if(ca)ca.textContent=`${formatDisplayNumber(m.cameraAmount,0)}%`;
            const col=document.getElementById('motionColorSpeedText');if(col)col.textContent=`${formatDisplayNumber(m.colorSpeed,0)}% × ${formatDisplayNumber(m.colorMultiplier,2)}`;
            document.getElementById('motionRotationBlock')?.classList.toggle('disabled',!rotationEnabled);
            document.getElementById('motionCameraBlock')?.classList.toggle('disabled',!m.cameraEnabled);
            document.getElementById('motionColorBlock')?.classList.toggle('disabled',!m.colorEnabled);
            document.getElementById('btnSidebarMotion')?.classList.toggle('feature-enabled',anyMotionEnabled());
            const sel=document.querySelector('#motionPaletteHost select');if(sel&&sel.value!==m.paletteKey)sel.value=m.paletteKey;
        }

        function syncSidebarToolStates() {
            const layer=(state.layers || []).find(l=>l.id===state.activeLayerId) || state.layers?.[0] || null;
            const lineBtn=document.getElementById('btnSidebarLines');
            document.getElementById('btnSidebarShape')?.classList.toggle('feature-enabled',linesAreEffectivelyVisible());
            lineBtn?.classList.toggle('feature-enabled',linesAreEffectivelyVisible());
            syncLineMasterVisibilityUI();
            const effectLayer=getActiveEffectLayer();
            const master=state.masterLayerEdit===true;
            const lampsEnabled=master?everyLayerMatches(l=>getLayerLampsEnabled(l)):getLayerLampsEnabled(effectLayer);
            document.getElementById('btnSidebarLamps')?.classList.toggle('feature-enabled',lampsEnabled);
            const graffitiEnabled=master?everyLayerMatches(l=>l.lineProfileApplication==='graffiti'):layer?.lineProfileApplication==='graffiti';
            lineBtn?.classList.toggle('graffiti-enabled',graffitiEnabled);
            const desiredWebState=l=>webRuntime.desiredVisibilityByLayer.has(l.id)?webRuntime.desiredVisibilityByLayer.get(l.id)===true:l.showWeb===true;
            const webEnabled=master?everyLayerMatches(desiredWebState):(effectLayer?desiredWebState(effectLayer):false);
            document.getElementById('btnSidebarWeb')?.classList.toggle('feature-enabled',webEnabled);
            const sweepEnabled=master?everyLayerMatches(l=>getLayerSweepConfig(l).enabled===true):getLayerSweepConfig(effectLayer).enabled===true;
            document.getElementById('btnSidebarSweep')?.classList.toggle('feature-enabled',sweepEnabled);
            const particlesEnabled=master?everyLayerMatches(l=>normalizeParticleConfig(l?.particles).enabled===true):normalizeParticleConfig(effectLayer?.particles).enabled===true;
            document.getElementById('btnSidebarParticles')?.classList.toggle('feature-enabled',particlesEnabled);
            document.getElementById('btnSidebarFourier')?.classList.toggle('fourier-on',state.fourierMode===true);
            syncMotionUI();
            const fourierToggle=document.getElementById('fourierModeToggle');if(fourierToggle)fourierToggle.checked=state.fourierMode===true;
            syncFourierStrengthUI();
        }
        function normalizeLineProfileValue(value, fallback='round') {
            return ['round','slash','square','circle','cross'].includes(value) ? value : fallback;
        }
        function normalizeLineMarkerType(value, fallback='slash') {
            return ['circle','square','cross','slash'].includes(value) ? value : fallback;
        }
        function getLayerMainLineMode(layer){
            if(!layer)return 'point';
            if(layer.lineProfileApplication==='graffiti')return 'graffiti';
            if(layer?.sprite?.enabled===true)return 'sprite';
            const p=normalizeLineProfileValue(layer.lineProfileStroke ?? layer.lineProfile,'round');
            return p==='round'?'point':'dash';
        }
        function setLayerMainLineMode(layer,mode){
            if(!layer)return;ensureLayerEffectState(layer);mode=['point','dash','sprite','graffiti'].includes(mode)?mode:'point';
            if(mode==='graffiti'){layer.sprite.enabled=false;setLayerGraffitiMode(layer,true);layer.lineProfileGraffiti='slash';return;}
            setLayerGraffitiMode(layer,false);
            if(mode==='sprite'){layer.sprite=normalizeLineSpriteConfig(layer.sprite);layer.sprite.enabled=true;layer.lineProfileApplication='stroke';layer.lineProfile='round';layer.lineProfileStroke='round';frameGraphPerformanceRuntime.penaltyUntilFrame=0;return;}
            layer.sprite.enabled=false;
            if(mode==='dash'){layer.lineMarkerType=normalizeLineMarkerType(layer.lineMarkerType||layer.lineProfileStroke,'slash');layer.lineProfile=layer.lineMarkerType;layer.lineProfileStroke=layer.lineMarkerType;}
            else{if(layer.lineProfileStroke!=='round')layer.lineMarkerType=normalizeLineMarkerType(layer.lineProfileStroke,layer.lineMarkerType||'slash');layer.lineProfile='round';layer.lineProfileStroke='round';}
        }
        function rememberCurrentLineProfile(layer) {
            if(!layer)return;
            const active=normalizeLineProfileValue(layer.lineProfileStroke ?? layer.lineProfile,'round');
            layer.lineProfileStroke=active;layer.lineProfile=active;
        }
        function setLayerLineProfile(layer, profile) {
            if(!layer)return;
            const spriteOn=layer?.sprite?.enabled===true;
            const value=spriteOn?'round':normalizeLineProfileValue(profile,'round');
            if(value!=='round')layer.lineMarkerType=normalizeLineMarkerType(value,'slash');
            layer.lineProfile=value;layer.lineProfileStroke=value;
        }
        function setLayerGraffitiProfile(layer, profile) {
            if(!layer)return;
            layer.lineProfileGraffiti='slash';
        }
        function setLayerGraffitiMode(layer, enabled) {
            if(!layer)return;
            const on=enabled===true;
            const current=layer.lineProfileApplication==='graffiti';
            rememberCurrentLineProfile(layer);
            if(on && !current){
                if(!['round','slash','square'].includes(layer.lineProfileGraffiti))layer.lineProfileGraffiti='slash';
                layer.lineProfileApplication='graffiti';
                if(!Number.isFinite(Number(layer.graffitiAngle)))layer.graffitiAngle=45;
                if(!['absolute','relative'].includes(layer.graffitiAngleMode))layer.graffitiAngleMode='absolute';
                if(!Number.isFinite(Number(layer.graffitiNibLength)))layer.graffitiNibLength=10;
                layer.graffitiBaseStrokeWidth=null;
            } else if(!on && current){
                // Backward compatibility for v108 projects that stored the old tripled width.
                const base=Number(layer.graffitiBaseStrokeWidth),width=Number(layer.strokeWidth);
                if(Number.isFinite(base)&&Number.isFinite(width)&&Math.abs(width-base*3)<.05)layer.strokeWidth=Math.max(.5,Math.min(20,base));
                layer.graffitiBaseStrokeWidth=null;layer.lineProfileApplication='stroke';
            } else layer.lineProfileApplication=on?'graffiti':'stroke';
            layer.lineProfile=normalizeLineProfileValue(layer.lineProfileStroke ?? layer.lineProfile,'round');
            layer.lineProfileStroke=layer.lineProfile;
            if(!['absolute','relative'].includes(layer.graffitiAngleMode))layer.graffitiAngleMode='absolute';
            if(!['pointed','blunt','pinched','round'].includes(layer.graffitiNibShape))layer.graffitiNibShape='pointed';
            if(!Number.isFinite(Number(layer.graffitiNibLength)))layer.graffitiNibLength=10;
            if(!Number.isFinite(Number(layer.graffitiNibLengthMultiplier)))layer.graffitiNibLengthMultiplier=1;
            if(!['perSegment','everyNth','across','perPath','whole'].includes(layer.graffitiVariationMode))layer.graffitiVariationMode='perSegment';
            if(!Number.isFinite(Number(layer.graffitiVariationEveryN)))layer.graffitiVariationEveryN=2;
            if(typeof layer.graffitiSizeVariationEnabled!=='boolean')layer.graffitiSizeVariationEnabled=false;
            if(!Number.isFinite(Number(layer.graffitiSizeVariation)))layer.graffitiSizeVariation=0;
            if(!Number.isFinite(Number(layer.graffitiSizeFocus)))layer.graffitiSizeFocus=50;
            if(typeof layer.graffitiRotationVariationEnabled!=='boolean')layer.graffitiRotationVariationEnabled=false;
            if(!Number.isFinite(Number(layer.graffitiRotationVariation)))layer.graffitiRotationVariation=0;
            if(!Number.isFinite(Number(layer.graffitiRotationMultiplier)))layer.graffitiRotationMultiplier=1;
            if(!Number.isFinite(Number(layer.graffitiRotationFocus)))layer.graffitiRotationFocus=50;
            syncSidebarInputs();
            syncSidebarToolStates();
            requestMainCanvasRender();
        }
        function syncFourierStrengthUI() {
            state.fourierStrength=Math.max(0,Math.min(100,Number(state.fourierStrength ?? 50)));
            const r=document.getElementById('fourierStrength');if(r&&document.activeElement!==r)r.value=String(state.fourierStrength);
            const t=document.getElementById('fourierStrengthText');if(t)t.textContent=`${Math.round(state.fourierStrength)}%`;
        }
        function setFourierMode(enabled, syncControl = true) {
            state.fourierMode = enabled === true;
            if(syncControl){const cb=document.getElementById('fourierModeToggle');if(cb)cb.checked=state.fourierMode;}
            document.getElementById('btnSidebarFourier')?.classList.toggle('fourier-on',state.fourierMode);
            syncFourierStrengthUI();
            requestMainCanvasRender();
        }
        function setSidebarMode(mode) {
            state.sidebarMode = ['shape','lines','lamps','web','sweep','particles','motion','palette','fourier'].includes(mode) ? mode : 'shape';
            const aside=document.getElementById('settingsSidebar');
            ['shape','lines','lamps','web','sweep','particles','motion','palette','fourier'].forEach(name=>aside?.classList.toggle(`sidebar-mode-${name}`,state.sidebarMode===name));
            document.querySelectorAll('[data-sidebar-mode]').forEach(btn=>{const on=btn.dataset.sidebarMode===state.sidebarMode;btn.classList.toggle('active',on);btn.setAttribute('aria-pressed',on?'true':'false');});
            if(state.sidebarMode==='palette'&&typeof renderPlaylistPaletteStudio==='function')renderPlaylistPaletteStudio();
            syncSidebarToolStates();
        }
        function syncWebOutlineUI() {
            const effectLayer=getActiveEffectLayer();
            const web = getLayerWebConfig(effectLayer);
            const outline = state.lineOutline || (state.lineOutline = { enabled:false, color:'#ffffff', width:1.5, mode:'outer' });
            outline.mode=['outer','inner','median'].includes(outline.mode)?outline.mode:'outer';
            const pendingWebSwitch = effectLayer ? (webRuntime.pendingByLayer.get(effectLayer.id) || {}) : {};
            const desiredVisibility=effectLayer?webRuntime.desiredVisibilityByLayer.get(effectLayer.id):undefined;
            const showWeb = document.getElementById('showWeb'); if (showWeb) showWeb.checked = state.masterLayerEdit===true ? getEffectTargets().every(l=>webRuntime.desiredVisibilityByLayer.has(l.id)?webRuntime.desiredVisibilityByLayer.get(l.id)===true:l.showWeb===true) : (desiredVisibility===undefined?getLayerWebEnabled(effectLayer):desiredVisibility===true);
            const type=document.getElementById('webType'),styleSel=document.getElementById('webStyle'),inside=document.getElementById('webInside'),outsideStraight=document.getElementById('webOutsideStraight'),outsideArc=document.getElementById('webOutsideArc'),placement=document.getElementById('webPlacementMode'),osc=document.getElementById('webOscillating'),os=document.getElementById('webOscillationStrength'),osmult=document.getElementById('webOscillationStrengthMultiplier'),omult=document.getElementById('webOscillationMultiplier'),a=document.getElementById('webAngleThreshold'),w=document.getElementById('webWidth'),wr=document.getElementById('webWidthRelative'),wp=document.getElementById('webWidthPercent'),wc=document.getElementById('webColor'),wmc=document.getElementById('webMatchLineColor'),wsc=document.getElementById('webSecondaryColor'),wsd=document.getElementById('webSunDegrees'),d=document.getElementById('webDistance'),dm=document.getElementById('webDepthMultiplier'),sp=document.getElementById('webSpacing'),av=document.getElementById('webAngleVariation');
            if(type)type.value=(pendingWebSwitch.type || web.type)==='rounding'?'rounding':'bevel';
            const branches=getWebBranchFlags(web),placementValue=['corners','selfIntersection','selfIntersectionCorridor'].includes(web.placementMode)?web.placementMode:'selfIntersection';
            if(styleSel)styleSel.value=['web','laser','spiderSun'].includes(web.style)?web.style:'web';if(inside)inside.checked=branches.inside;if(outsideStraight)outsideStraight.checked=branches.outsideStraight;if(outsideArc)outsideArc.checked=branches.outsideArc;if(placement)placement.value=placementValue;if(osc)osc.checked=web.oscillating===true;if(os)os.value=Math.max(0,Math.min(100,Number.isFinite(Number(web.oscillationStrength))?Number(web.oscillationStrength):10));if(osmult)osmult.value=String(Math.max(.015625,Math.min(64,Number(web.oscillationStrengthMultiplier)||1)));if(omult)omult.value=String(Math.max(.015625,Math.min(64,Number(web.oscillationMultiplier)||1)));
            if(a)a.value=web.angleThreshold;if(w)w.value=web.width;if(wr)wr.checked=web.widthRelative===true;if(wp){wp.value=web.widthPercent??40;wp.disabled=web.widthRelative!==true;}if(wmc)wmc.checked=web.matchLineColor===true;if(wc){wc.value=web.color||'#ffffff';wc.disabled=web.matchLineColor===true;}if(wsc)wsc.value=web.secondaryColor||'#00ffff';if(wsd)wsd.value=Math.max(5,Math.min(90,Number(web.sunDegrees)||20));if(d)d.value=Math.max(0,Math.min(100,Number.isFinite(Number(web.distance))?Number(web.distance):20));if(dm)dm.value=Math.max(0,Number(web.depthMultiplier)||0);if(sp)sp.value=web.spacing;if(av)av.value=web.angleVariation;
            const at=document.getElementById('webAngleText'),wt=document.getElementById('webWidthText'),dt=document.getElementById('webDistanceText'),dmt=document.getElementById('webDepthMultiplierText'),st=document.getElementById('webSpacingText'),vt=document.getElementById('webVariationText'),ost=document.getElementById('webOscillationStrengthText'),osmt=document.getElementById('webOscillationStrengthMultiplierText'),omt=document.getElementById('webOscillationMultiplierText'),wsdt=document.getElementById('webSunDegreesText');
            if(at)at.textContent=`${Math.round(Number(web.angleThreshold)||60)}°`;
            if(wt)wt.textContent=web.widthRelative===true?`${Math.round(Number(web.widthPercent)||40)}% линии`:`${(Number(web.width)||.6).toFixed(1)} px`;
            if(dt)dt.textContent=`${Math.round(Math.max(0,Math.min(100,Number.isFinite(Number(web.distance))?Number(web.distance):20)))}%`;
            if(dmt)dmt.textContent=`×${Math.max(0,Number(web.depthMultiplier)||0).toFixed(2)}`;
            if(st)st.textContent=`${Math.round(Number(web.spacing)||10)} px`;
            if(vt)vt.textContent=`${Math.round(Number(web.angleVariation)||0)}°`;
            if(ost)ost.textContent=`${Math.round(Math.max(0,Math.min(100,Number.isFinite(Number(web.oscillationStrength))?Number(web.oscillationStrength):10)))}%`;
            if(osmt){const m=Math.max(.015625,Math.min(64,Number(web.oscillationStrengthMultiplier)||1));osmt.textContent=`×${m.toFixed(m<1?3:(m%1?2:0)).replace(/0+$/,'').replace(/\.$/,'')}`;}if(wsdt)wsdt.textContent=`${Math.round(Math.max(5,Math.min(90,Number(web.sunDegrees)||20)))}°`;document.getElementById('webSecondaryColorRow')?.classList.toggle('hidden',web.style!=='laser');document.getElementById('webSunDegreesRow')?.classList.toggle('hidden',web.style!=='spiderSun');if(omt){const m=Math.max(.015625,Math.min(64,Number(web.oscillationMultiplier)||1));omt.textContent=`×${m.toFixed(m<1?3:(m%1?2:0)).replace(/0+$/,'').replace(/\.$/,'')}`;}
            const osr=document.getElementById('webOscillationStrengthRow'),osmr=document.getElementById('webOscillationStrengthMultiplierRow'),omr=document.getElementById('webOscillationMultiplierRow');if(osr)osr.classList.toggle('disabled',web.oscillating!==true);if(osmr)osmr.classList.toggle('disabled',web.oscillating!==true);if(omr)omr.classList.toggle('disabled',web.oscillating!==true);
            const badge=document.getElementById('webModeBadge');if(badge){const names=[];if(branches.inside)names.push('внутренняя');if(branches.outsideStraight)names.push('внешняя прямая');if(branches.outsideArc)names.push('внешняя дуговая');const rr=names.length?names.join(' + '):'ветви выключены',pp={corners:'углы',selfIntersection:'самопересечения',selfIntersectionCorridor:'самопересечения + коридор'}[placementValue]||'самопересечения';badge.textContent=`${rr} · ${pp}`;}
            const oe=document.getElementById('paramLineOutlineEnabled'), oc=document.getElementById('paramLineOutlineColor'), or=document.getElementById('paramLineOutlineWidth'), on=document.getElementById('numLineOutlineWidth'), ot=document.getElementById('lineOutlineWidthText');
            if(oe)oe.checked=outline.enabled===true;if(oc)oc.value=outline.color||'#ffffff';if(or)or.value=outline.width;if(on)on.value=outline.width;if(ot)ot.textContent=`${Number(outline.width||1.5).toFixed(1)} px`;
            const om={outer:'paramLineOutlineOuter',inner:'paramLineOutlineInner',median:'paramLineOutlineMedian'};for(const [mode,id] of Object.entries(om)){const el=document.getElementById(id);if(el)el.checked=outline.mode===mode;}
        }
        function syncLampSettingsUI() {
            const c=getActiveLampConfig() || state.lamps;
            {const base=Math.max(1,Number.isFinite(Number(c.radius))?Number(c.radius):50),mult=Math.max(0,Number.isFinite(Number(c.radiusMultiplier))?Number(c.radiusMultiplier):1);if(base>50){const effective=base*mult;if(effective<=0){c.radius=50;c.radiusMultiplier=0;}else{const nextMult=Math.max(1,Math.ceil(effective/50));c.radius=effective/nextMult;c.radiusMultiplier=nextMult;}}else{c.radius=base;c.radiusMultiplier=mult;}}
            const mode=c.colorMode || (c.rainbow?'rainbow':c.matchLineColor?'line':'selected');
            c.colorMode=mode; c.matchLineColor=mode==='line'; c.rainbow=mode==='rainbow';
            const vals={lampColor:c.color,lampWebGL:c.webgl!==false,lampHD:c.hd===true,lampRasterized:c.rasterized===true,lampFreezeLight:c.freezeLight===true,lampFreezeTailSec:c.freezeTailSec??1.5,lampBrightness:c.brightness,lampRadius:c.radius,lampRadiusMultiplier:c.radiusMultiplier??1,lampSoftness:c.softness,lampSoftnessMultiplier:c.softnessMultiplier??1,lampBlendMode:c.blendMode,lampType:c.type,lampDensity:c.density??100,lampDensityMultiplier:c.densityMultiplier??1,lampScatter:c.scatter??0,lampScatterMultiplier:c.scatterMultiplier??1,lampSizeVariation:c.sizeVariation??0,lampSizeVariationMultiplier:c.sizeVariationMultiplier??1,lampBrightnessVariation:c.brightnessVariation??0,lampBrightnessVariationMultiplier:c.brightnessVariationMultiplier??1,lampAdaptiveBrightness:c.adaptiveBrightness!==false,lampAdaptiveAdjustBrightness:c.adaptiveAdjustBrightness===true,lampAdaptiveStrength:c.adaptiveStrength??100,lampAdaptiveStrengthMultiplier:c.adaptiveStrengthMultiplier??1,lampAdaptiveFadeSec:c.adaptiveFadeSec??1,lampMorphEnabled:c.morphEnabled===true,lampMorphSize:c.morphSize??20,lampMorphBrightness:c.morphBrightness??25,lampMorphInertia:c.morphInertia??50,lampCornerInertiaLinked:c.cornerInertiaLinked!==false,lampCalmMode:c.calmMode===true,lampSnapToContour:withLampConfig(c,()=>isLampContourAttachmentEnabled())};
            for(const [id,v] of Object.entries(vals)){const el=document.getElementById(id);if(!el)continue;if(el.type==='checkbox')el.checked=!!v;else el.value=v;}
            const glQualityActive=c.webgl!==false;
            const hdQuality=document.getElementById('lampHD'), rasterQuality=document.getElementById('lampRasterized');
            if(hdQuality){hdQuality.disabled=glQualityActive;hdQuality.closest('label')?.classList.toggle('disabled',glQualityActive);}
            if(rasterQuality){rasterQuality.disabled=glQualityActive;rasterQuality.closest('label')?.classList.toggle('disabled',glQualityActive);}
            const showLines=document.getElementById('showLines'); if(showLines) showLines.checked=linesAreEffectivelyVisible();
            const showLamps=document.getElementById('showLamps'); if(showLamps) showLamps.checked=state.masterLayerEdit===true?everyLayerMatches(l=>getLayerLampsEnabled(l)):getLayerLampsEnabled(getActiveEffectLayer());
            const positionMode=['key','corners','arbitrary'].includes(c.positionMode)?c.positionMode:'key';
            document.querySelectorAll('[data-lamp-position]').forEach(btn=>{const on=btn.dataset.lampPosition===positionMode;btn.classList.toggle('active',on);btn.setAttribute('aria-pressed',on?'true':'false');});
            const motionMode=c.morphMotionMode==='current'?'dynamic':(['linear','ghost','dynamic','smooth'].includes(c.morphMotionMode)?c.morphMotionMode:'linear');
            document.querySelectorAll('[data-lamp-motion]').forEach(btn=>{const on=btn.dataset.lampMotion===motionMode;btn.classList.toggle('active',on);btn.setAttribute('aria-pressed',on?'true':'false');});
            document.querySelectorAll('[data-lamp-color-mode]').forEach(btn=>btn.classList.toggle('active',btn.dataset.lampColorMode===mode));
            const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};
            const fmt=n=>Number(n).toFixed(Math.abs(Number(n)%1)>.001?1:0);
            set('lampFreezeTailText',`${formatTimeSeconds(Math.max(.05,Number(c.freezeTailSec??1.5)))} с`);
            const freezeTailInput=document.getElementById('lampFreezeTailSec'),freezeTailRow=document.getElementById('lampFreezeTailRow');
            if(freezeTailInput)freezeTailInput.disabled=c.freezeLight!==true;
            freezeTailRow?.classList.toggle('disabled',c.freezeLight!==true);
            set('lampBrightnessText',`${Math.round(c.brightness)}%`);
            set('lampRadiusText',`${fmt(c.radius)} px × ${fmt(c.radiusMultiplier??1)}`);
            set('lampSoftnessText',`${Math.round(c.softness)}% × ${fmt(c.softnessMultiplier??1)}`);
            set('lampDensityText',`${Math.round(Number(c.density??100))}% × ${fmt(c.densityMultiplier??1)}`);
            set('lampScatterText',`${Math.round(Number(c.scatter)||0)}% × ${fmt(c.scatterMultiplier??1)}`);
            set('lampSizeVariationText',`${Math.round(Number(c.sizeVariation??0))}% × ${fmt(c.sizeVariationMultiplier??1)}`);
            set('lampBrightnessVariationText',`${Math.round(Number(c.brightnessVariation??0))}% × ${fmt(c.brightnessVariationMultiplier??1)}`);
            set('lampAdaptiveStrengthText',`${Math.round(Number(c.adaptiveStrength??100))}% × ${fmt(c.adaptiveStrengthMultiplier??1)}`);
            set('lampAdaptiveFadeText',`${formatTimeSeconds(Math.max(0,Number(c.adaptiveFadeSec??1)))} с`);
            set('lampMorphSizeText',`${Math.round(Number(c.morphSize??20))}%`);
            set('lampMorphBrightnessText',`${Math.round(Number(c.morphBrightness??25))}%`);
            set('lampMorphInertiaText',`${Math.round(Number(c.morphInertia??50))}%`);
            document.getElementById('lampMorphInertiaRow')?.classList.toggle('hidden',motionMode!=='dynamic');
            document.getElementById('lampMorphSettings')?.classList.toggle('hidden',c.morphEnabled!==true);
            document.getElementById('lampDensityRow')?.classList.toggle('hidden',positionMode!=='arbitrary');
            const cornerRow=document.getElementById('lampCornerInertiaRow');
            cornerRow?.classList.toggle('hidden',positionMode!=='corners');
            const cornerSlider=document.getElementById('lampCornerInertia');
            const cornerLinked=c.cornerInertiaLinked!==false;
            if(cornerSlider){
                cornerSlider.min='0';cornerSlider.max=cornerLinked?'100':'15';cornerSlider.step=cornerLinked?'1':'0.1';
                cornerSlider.value=String(cornerLinked?Math.max(0,Math.min(100,Number(c.cornerInertiaPercent??10))):Math.max(0,Math.min(15,Number(c.cornerInertiaSec??0.5))));
            }
            const cornerSec=lampCornerInertiaMs(c)/1000;
            set('lampCornerInertiaText',cornerLinked?`${Math.round(Number(c.cornerInertiaPercent??10))}% · ${formatTimeSeconds(cornerSec)} с`:`${formatTimeSeconds(cornerSec)} с`);
            const selected=mode==='selected';
            const color=document.getElementById('lampColor'); if(color) color.disabled=!selected;
            const palette=document.getElementById('lampColorPresets'); if(palette) palette.style.opacity=selected?'1':'.42';
        }

        function syncSweepUI() {
            const effectLayer=getActiveEffectLayer(),c=getLayerSweepConfig(effectLayer);migrateSharedSweepGlintConfig(c);
            delete c.blurEnabled;delete c.blur;
            const allowed=['perSegment','everyNth','across','perPath','whole'];if(c.mode==='lightning'){c.effectType='lightning';c.mode='whole';}if(!allowed.includes(c.mode))c.mode='whole';
            c.effectType=c.effectType==='lightning'?'lightning':'glint';c.flashMode=normalizeSweepFlashMode(c.flashMode);c.flashType=normalizeGlintPrecisionValue(c.flashType??c.glintPrecision);if(c.flashType==='spectral')c.flashType='high';c.glintPrecision=c.flashType;
            const lightningMode=c.effectType==='lightning',spectral=c.flashMode==='spectral';
            const e=document.getElementById('showSweep');if(e)e.checked=state.masterLayerEdit===true?everyLayerMatches(l=>getLayerSweepConfig(l).enabled===true):c.enabled===true;
            const et=document.getElementById('sweepEffectType');if(et)et.value=c.effectType;
            c.coreBlendMode=normalizeSweepBlendMode(c.coreBlendMode);c.glowBlendMode=normalizeSweepBlendMode(c.glowBlendMode);const cbm=document.getElementById('sweepCoreBlendMode');if(cbm)cbm.value=c.coreBlendMode;const gbm=document.getElementById('sweepGlowBlendMode');if(gbm)gbm.value=c.glowBlendMode;
            document.getElementById('sweepGlintSettings')?.classList.remove('hidden');document.getElementById('sweepLightningSettings')?.classList.toggle('hidden',!lightningMode);document.getElementById('sweepLightningRasterToggle')?.classList.toggle('hidden',!lightningMode);
            const title=document.getElementById('sweepGlintSectionTitle');if(title)title.textContent='Проблеск';const fm=document.getElementById('sweepFlashMode');if(fm)fm.value=c.flashMode;
            document.getElementById('sweepMovingSettings')?.classList.toggle('hidden',spectral);document.getElementById('sweepSpectralSettings')?.classList.toggle('hidden',!spectral);document.getElementById('sweepGlintPrecisionRow')?.classList.toggle('hidden',lightningMode||spectral);document.getElementById('sweepStandaloneMotionSettings')?.classList.toggle('hidden',lightningMode||spectral);
            const gp=document.getElementById('sweepGlintPrecision');if(gp)gp.value=c.flashType;const m=document.getElementById('sweepMode');if(m)m.value=c.mode;document.getElementById('sweepEveryNRow')?.classList.toggle('hidden',c.mode!=='everyNth');
            const n=document.getElementById('sweepEveryN');if(n)n.value=String(Math.max(2,Math.min(24,Math.round(Number(c.everyN)||2))));const nt=document.getElementById('sweepEveryNText');if(nt)nt.textContent=n?.value||'2';const d=document.getElementById('sweepDirection');if(d)d.value=c.direction||'forward';
            const bpm=Math.max(0,Number(state.tapTempo?.bpm)||0),syncActive=c.syncMusic!==false&&bpm>0;const sm=document.getElementById('sweepSyncMusic');if(sm)sm.checked=c.syncMusic!==false;const sp=document.getElementById('sweepSpeed');if(sp){sp.value=c.speed;sp.disabled=syncActive;sp.style.opacity=syncActive?'.42':'1';}{const v=Number(c.speedMultiplier);c.speedMultiplier=Number.isFinite(v)?Math.max(.015625,Math.min(64,v)):1;}const mul=document.getElementById('sweepSpeedMultiplier');if(mul)mul.value=String(c.speedMultiplier);const st=document.getElementById('sweepSpeedText');if(st){const mm=c.speedMultiplier;st.textContent=syncActive?`${Math.round(bpm)} BPM × ${mm.toFixed(mm%1?2:0)}`:`${Number(c.speed||.25).toFixed(2)} цикл/с × ${mm.toFixed(mm%1?2:0)}`;}
            c.lengthPercent=Math.max(1,Math.min(100,Number.isFinite(Number(c.lengthPercent))?Number(c.lengthPercent):18));const len=document.getElementById('sweepLength');if(len)len.value=String(c.lengthPercent);const lt=document.getElementById('sweepLengthText');if(lt)lt.textContent=`${Math.round(c.lengthPercent)}%`;
            c.spectralSectorDegrees=Math.max(1,Math.min(360,Number.isFinite(Number(c.spectralSectorDegrees))?Number(c.spectralSectorDegrees):45));c.spectralAngularSpeed=Math.max(-720,Math.min(720,Number.isFinite(Number(c.spectralAngularSpeed))?Number(c.spectralAngularSpeed):90));const ssd=document.getElementById('sweepSpectralSectorDegrees');if(ssd)ssd.value=String(c.spectralSectorDegrees);const ssdt=document.getElementById('sweepSpectralSectorText');if(ssdt)ssdt.textContent=`${Math.round(c.spectralSectorDegrees)}°`;const sas=document.getElementById('sweepSpectralAngularSpeed');if(sas)sas.value=String(c.spectralAngularSpeed);const sast=document.getElementById('sweepSpectralAngularSpeedText');if(sast)sast.textContent=`${Math.round(c.spectralAngularSpeed)}°/с`;
            c.widthPercent=Math.max(0,Math.min(200,Number.isFinite(Number(c.widthPercent))?Number(c.widthPercent):75));const swp=document.getElementById('sweepWidthPercent');if(swp)swp.value=String(c.widthPercent);const swpt=document.getElementById('sweepWidthText');if(swpt)swpt.textContent=`${Math.round(c.widthPercent)}%`;
            const col=document.getElementById('sweepColor');if(col)col.value=/^#[0-9a-f]{6}$/i.test(c.color||'')?c.color:'#ffffff';c.opacity=Math.max(0,Math.min(100,Number.isFinite(Number(c.opacity))?Number(c.opacity):100));const sop=document.getElementById('sweepOpacity');if(sop)sop.value=String(c.opacity);const sopt=document.getElementById('sweepOpacityText');if(sopt)sopt.textContent=`${Math.round(c.opacity)}%`;
            c.brightness=Math.max(0,Math.min(200,Number.isFinite(Number(c.brightness))?Number(c.brightness):100));c.glow=Math.max(0,Number.isFinite(Number(c.glow))?Number(c.glow):18);c.glowMultiplier=Math.max(0,Number.isFinite(Number(c.glowMultiplier))?Number(c.glowMultiplier):1);if(c.glow>50){const q=compactSweepPixelValue(c.glow,c.glowMultiplier,50);c.glow=q.base;c.glowMultiplier=q.multiplier;}c.glowIntensity=Math.max(0,Math.min(200,Number.isFinite(Number(c.glowIntensity))?Number(c.glowIntensity):100));c.glowIntensityMultiplier=Math.max(0,Number.isFinite(Number(c.glowIntensityMultiplier))?Number(c.glowIntensityMultiplier):1);c.softness=Math.max(0,Math.min(150,Number.isFinite(Number(c.softness))?Number(c.softness):100));c.softnessMultiplier=Math.max(0,Number.isFinite(Number(c.softnessMultiplier))?Number(c.softnessMultiplier):1);
            const sb=document.getElementById('sweepBrightness');if(sb)sb.value=String(c.brightness);const sbt=document.getElementById('sweepBrightnessText');if(sbt)sbt.textContent=`${Math.round(c.brightness)}%`;const sgl=document.getElementById('sweepGlow');if(sgl)sgl.value=String(c.glow);const sglm=document.getElementById('sweepGlowMultiplier');if(sglm)sglm.value=String(c.glowMultiplier);const sglt=document.getElementById('sweepGlowText');if(sglt)sglt.textContent=`${Math.round(c.glow*10)/10} px × ${Number(c.glowMultiplier).toFixed(c.glowMultiplier%1?1:0)}`;const sgi=document.getElementById('sweepGlowIntensity');if(sgi)sgi.value=String(c.glowIntensity);const sgim=document.getElementById('sweepGlowIntensityMultiplier');if(sgim)sgim.value=String(c.glowIntensityMultiplier);const sgit=document.getElementById('sweepGlowIntensityText');if(sgit)sgit.textContent=`${Math.round(c.glowIntensity)}% × ${Number(c.glowIntensityMultiplier).toFixed(c.glowIntensityMultiplier%1?1:0)}`;const ss=document.getElementById('sweepSoftness');if(ss)ss.value=String(c.softness);const ssm=document.getElementById('sweepSoftnessMultiplier');if(ssm)ssm.value=String(c.softnessMultiplier);const sst=document.getElementById('sweepSoftnessText');if(sst)sst.textContent=`${Math.round(c.softness)}% × ${Number(c.softnessMultiplier).toFixed(c.softnessMultiplier%1?1:0)}`;
            if(lightningMode){
                c.lightningBehavior=normalizeLightningBehaviorValue(c.lightningBehavior,'symmetric');c.lightningPrecision=normalizeLightningPrecisionValue(c.lightningPrecision);const lbeh=document.getElementById('sweepLightningBehavior');if(lbeh)lbeh.value=c.lightningBehavior;const lprec=document.getElementById('sweepLightningPrecision');if(lprec)lprec.value=c.lightningPrecision;c.lightningMode=['perSegment','everyNth','across','perPath','whole'].includes(c.lightningMode)?c.lightningMode:'perPath';c.lightningEveryN=Math.max(2,Math.min(24,Math.round(Number(c.lightningEveryN)||2)));c.lightningRandomPosition=c.lightningRandomPosition===true;const lm=document.getElementById('sweepLightningMode');if(lm)lm.value=c.lightningMode;document.getElementById('sweepLightningEveryNRow')?.classList.toggle('hidden',c.lightningMode!=='everyNth');const lne=document.getElementById('sweepLightningEveryN');if(lne)lne.value=String(c.lightningEveryN);const lnet=document.getElementById('sweepLightningEveryNText');if(lnet)lnet.textContent=String(c.lightningEveryN);const lrpos=document.getElementById('sweepLightningRandomPosition');if(lrpos)lrpos.checked=c.lightningRandomPosition;
                const lcol=document.getElementById('sweepLightningColor');if(lcol)lcol.value=/^#[0-9a-f]{6}$/i.test(c.lightningColor||'')?c.lightningColor:'#ffffff';const lscol=document.getElementById('sweepLightningSecondaryColor');if(lscol)lscol.value=/^#[0-9a-f]{6}$/i.test(c.lightningSecondaryColor||'')?c.lightningSecondaryColor:'#7dd3fc';c.lightningSegmentPercent=Math.max(1,Math.min(100,Number.isFinite(Number(c.lightningSegmentPercent))?Number(c.lightningSegmentPercent):100));const lseg=document.getElementById('sweepLightningSegmentPercent');if(lseg)lseg.value=String(c.lightningSegmentPercent);const lsegt=document.getElementById('sweepLightningSegmentText');if(lsegt)lsegt.textContent=`${Math.round(c.lightningSegmentPercent)}%`;
                c.lightningRatePercent=Math.max(0,Math.min(100,Number.isFinite(Number(c.lightningRatePercent))?Number(c.lightningRatePercent):100));c.lightningRateMultiplier=Math.max(0,Number.isFinite(Number(c.lightningRateMultiplier))?Number(c.lightningRateMultiplier):1);const lrs=document.getElementById('sweepLightningRateSync');if(lrs)lrs.checked=lightningRateSyncEnabled();const lrpct=document.getElementById('sweepLightningRatePercent');if(lrpct)lrpct.value=String(c.lightningRatePercent);const lrm=document.getElementById('sweepLightningRateMultiplier');if(lrm)lrm.value=String(c.lightningRateMultiplier);const lrt=document.getElementById('sweepLightningRateText');if(lrt){const hz=lightningRateSyncEnabled()?getSynchronizedLightningCycleRateHz(c):getLightningCycleRateHz(c,state.layers.indexOf(effectLayer)),tag=lightningRateSyncEnabled()?' · синхр.':'';lrt.textContent=hz>0?`${Math.round(c.lightningRatePercent)}% × ${c.lightningRateMultiplier.toFixed(c.lightningRateMultiplier%1?1:0)} · ${(1/hz).toFixed((1/hz)<10?2:1)} с${tag}`:`${Math.round(c.lightningRatePercent)}% × ${c.lightningRateMultiplier.toFixed(c.lightningRateMultiplier%1?1:0)} · выкл.${tag}`;}
                c.lightningDurationMs=Math.max(30,Math.min(700,Number(c.lightningDurationMs)||480));const ldur=document.getElementById('sweepLightningDuration');if(ldur)ldur.value=String(c.lightningDurationMs);const ldurt=document.getElementById('sweepLightningDurationText');if(ldurt)ldurt.textContent=`${Math.round(c.lightningDurationMs)} ms`;c.lightningWidthPercent=Math.max(1,Math.min(100,Number(c.lightningWidthPercent)||64));const lw=document.getElementById('sweepLightningWidthPercent');if(lw)lw.value=String(c.lightningWidthPercent);const lwt=document.getElementById('sweepLightningWidthText');if(lwt)lwt.textContent=`${Math.round(c.lightningWidthPercent)}%`;
                c.lightningUseGlintMultiplier=c.lightningUseGlintMultiplier!==false;c.lightningGlintMultiplier=Math.max(0,Number.isFinite(Number(c.lightningGlintMultiplier))?Number(c.lightningGlintMultiplier):2);const use=document.getElementById('sweepLightningUseGlintMultiplier');if(use)use.checked=c.lightningUseGlintMultiplier;const link=document.getElementById('sweepLightningGlintMultiplier');if(link)link.value=String(c.lightningGlintMultiplier);
                c.lightningBrightness=Math.max(0,Math.min(400,Number.isFinite(Number(c.lightningBrightness))?Number(c.lightningBrightness):100));c.lightningGlow=Math.max(0,Number.isFinite(Number(c.lightningGlow))?Number(c.lightningGlow):16);c.lightningGlowMultiplier=Math.max(0,Number.isFinite(Number(c.lightningGlowMultiplier))?Number(c.lightningGlowMultiplier):1);if(c.lightningGlow>50){const q=compactSweepPixelValue(c.lightningGlow,c.lightningGlowMultiplier,50);c.lightningGlow=q.base;c.lightningGlowMultiplier=q.multiplier;}c.lightningGlowIntensity=Math.max(0,Math.min(400,Number.isFinite(Number(c.lightningGlowIntensity))?Number(c.lightningGlowIntensity):100));c.lightningGlowIntensityMultiplier=Math.max(0,Number.isFinite(Number(c.lightningGlowIntensityMultiplier))?Number(c.lightningGlowIntensityMultiplier):1);c.lightningSoftness=Math.max(0,Math.min(150,Number.isFinite(Number(c.lightningSoftness))?Number(c.lightningSoftness):100));c.lightningSoftnessMultiplier=Math.max(0,Number.isFinite(Number(c.lightningSoftnessMultiplier))?Number(c.lightningSoftnessMultiplier):1);
                let db=c.lightningBrightness,di=c.lightningGlowIntensity*c.lightningGlowIntensityMultiplier,dg=c.lightningGlow*c.lightningGlowMultiplier,ds=c.lightningSoftness*c.lightningSoftnessMultiplier;if(c.lightningUseGlintMultiplier){db=c.brightness*c.lightningGlintMultiplier;di=c.glowIntensity*c.glowIntensityMultiplier*c.lightningGlintMultiplier;dg=c.glow*c.glowMultiplier*c.lightningGlintMultiplier;ds=c.softness*c.softnessMultiplier;}
                const dgCompact=compactSweepPixelValue(dg,1,50),diBase=Math.min(400,di),diMult=diBase>0?di/diBase:1,dsBase=Math.min(150,ds),dsMult=dsBase>0?ds/dsBase:1,lbright=document.getElementById('sweepLightningBrightness'),lgi=document.getElementById('sweepLightningGlowIntensity'),lgim=document.getElementById('sweepLightningGlowIntensityMultiplier'),lg=document.getElementById('sweepLightningGlow'),lgm=document.getElementById('sweepLightningGlowMultiplier'),lsoft=document.getElementById('sweepLightningSoftness'),lsoftm=document.getElementById('sweepLightningSoftnessMultiplier');if(lbright)lbright.value=String(Math.min(400,db));if(lgi)lgi.value=String(diBase);if(lgim)lgim.value=String(diMult);if(lg)lg.value=String(dgCompact.base);if(lgm)lgm.value=String(dgCompact.multiplier);if(lsoft)lsoft.value=String(dsBase);if(lsoftm)lsoftm.value=String(dsMult);for(const el of [lbright,lgi,lgim,lg,lgm,lsoft,lsoftm])if(el)el.disabled=c.lightningUseGlintMultiplier;
                const lbt=document.getElementById('sweepLightningBrightnessText');if(lbt)lbt.textContent=`${Math.round(db)}%`;const lgit=document.getElementById('sweepLightningGlowIntensityText');if(lgit)lgit.textContent=`${Math.round(di)}%`;const lgt=document.getElementById('sweepLightningGlowText');if(lgt)lgt.textContent=`${Math.round(dg*10)/10} px`;const lst=document.getElementById('sweepLightningSoftnessText');if(lst)lst.textContent=`${Math.round(ds)}%`;
                const lrmRaster=document.getElementById('sweepLightningRasterized');if(lrmRaster)lrmRaster.checked=c.lightningSmoothLighting!==true;const lsl=document.getElementById('sweepLightningShowLines');if(lsl)lsl.checked=c.lightningShowLines!==false;const llo=document.getElementById('sweepLightningLineOpacity');if(llo){c.lightningLineOpacity=Math.max(0,Math.min(100,Number.isFinite(Number(c.lightningLineOpacity))?Number(c.lightningLineOpacity):100));llo.value=String(c.lightningLineOpacity);const lineOn=getLayerLineVisible(effectLayer);llo.style.opacity=lineOn?'.45':'1';llo.title=lineOn?'Обычная линия уже видима — дополнительная основа не рисуется':'Прозрачность локальной основы под ударом';}const llot=document.getElementById('sweepLightningLineOpacityText');if(llot)llot.textContent=`${Math.round(c.lightningLineOpacity)}%`;
                const lag=document.getElementById('sweepLightningAfterglow');if(lag)lag.checked=c.lightningAfterglow!==false;const lam=document.getElementById('sweepLightningAfterglowMs');if(lam){c.lightningAfterglowMs=Math.max(0,Math.min(900,Number(c.lightningAfterglowMs)||280));lam.value=String(c.lightningAfterglowMs);lam.disabled=c.lightningAfterglow===false;}const lamt=document.getElementById('sweepLightningAfterglowText');if(lamt)lamt.textContent=`${Math.round(c.lightningAfterglowMs)} ms`;const lmicro=document.getElementById('sweepLightningMicroStrikes');if(lmicro){c.lightningMicroStrikes=Math.max(0,Math.round(Number(c.lightningMicroStrikes)||0));lmicro.value=String(c.lightningMicroStrikes);lmicro.disabled=c.lightningAfterglow===false;}const lmicrot=document.getElementById('sweepLightningMicroText');if(lmicrot)lmicrot.textContent=String(c.lightningMicroStrikes);
            }
            migrateSharedSweepGlintConfig(c);if(c.enabled===true)ensureSweepAnimation();
        }

        function roundPolylineForDraw(ctx, points, closed, roundingFrac, cornerFlags, cornerFactors = null) {
            if (!points || points.length < 2) return;
            const strength=Math.max(0,Math.min(2,Number(roundingFrac)||0));
            // v341: 100..200% is a continuous second stage. Preserve topology by moving
            // knots first, then reuse the proven 100% local fillet without consuming more edge.
            if(strength>1.000001&&points.length>=3){
                const pre=transformSplineKnotsForRounding(points,Boolean(closed),strength-1,cornerFlags||[]);
                return roundPolylineForDraw(ctx,pre,closed,1,cornerFlags,cornerFactors);
            }

            if (state.fourierMode && points?._fourierPrepared !== true) {
                const amount=Math.min(1,strength);
                let source=points;
                if(amount>0.001 && Array.isArray(cornerFlags) && cornerFlags.some(Boolean)) source=smoothMorphPath(points,Boolean(closed),amount,cornerFlags);
                const wave=buildFourierWavePoints(source,Boolean(closed),`poly:${amount.toFixed(4)}`);
                if(wave.length<2)return;
                ctx.moveTo(wave[0].x,wave[0].y);
                for(let i=1;i<wave.length;i++)ctx.lineTo(wave[i].x,wave[i].y);
                if(closed)ctx.closePath();
                return;
            }

            const n = points.length;
            const rawPath = () => {
                ctx.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < n; i++) ctx.lineTo(points[i].x, points[i].y);
                if (closed) ctx.closePath();
            };

            const amount = Math.min(1,strength);
            if (amount <= 0.001) {
                rawPath();
                return;
            }

            // Only active corners participate. During topology morphing a
            // corner with factor 0 must behave exactly like an ordinary sample.
            let corners = [];
            for (let i = 0; i < n; i++) {
                if (!cornerFlags?.[i]) continue;
                if (cornerFactors && Number(cornerFactors[i]) <= 0.001) continue;
                if (!closed && (i === 0 || i === n - 1)) continue; // open ends are not fillets
                corners.push(i);
            }
            if (!corners.length) {
                rawPath();
                return;
            }

            const pointOnSegment = (a, b, f) => ({
                x: a.x + (b.x - a.x) * f,
                y: a.y + (b.y - a.y) * f
            });

            const distanceForward = (from, to) => {
                if (from < 0 || to < 0 || from === to) return 0;
                let d = 0;
                let i = from;
                let guard = 0;
                while (i !== to && guard++ <= n) {
                    const j = i + 1 < n ? i + 1 : (closed ? 0 : n - 1);
                    if (j === i) break;
                    d += Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
                    i = j;
                }
                return d;
            };

            const pointAlongPath = (from, to, distance) => {
                if (from === to) return { ...points[from] };
                let remain = Math.max(0, distance);
                let i = from;
                let guard = 0;
                while (i !== to && guard++ <= n) {
                    const j = i + 1 < n ? i + 1 : (closed ? 0 : n - 1);
                    if (j === i) break;
                    const len = Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
                    if (len > 1e-9 && remain <= len) return pointOnSegment(points[i], points[j], remain / len);
                    remain -= len;
                    i = j;
                }
                return { ...points[to] };
            };

            // Emit only the untrimmed part of an original sampled path arc.
            // This is the important bit for spline profiles: samples between a
            // fillet cut point and the polygon vertex are NOT drawn at all,
            // which removes the short protruding/backtracking "tips".
            const emitPathSlice = (from, to, startDistance, endDistance) => {
                const total = distanceForward(from, to);
                const a = Math.max(0, Math.min(total, startDistance));
                const b = Math.max(a, Math.min(total, endDistance));
                if (b <= a + 1e-9) return;

                let travelled = 0;
                let i = from;
                let guard = 0;
                while (i !== to && guard++ <= n) {
                    const j = i + 1 < n ? i + 1 : (closed ? 0 : n - 1);
                    if (j === i) break;
                    const len = Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
                    const nextTravelled = travelled + len;

                    // Keep an original sample only when it lies strictly inside
                    // the retained interval. Boundary points are emitted from
                    // pointAlongPath so there is no overshoot/backtracking.
                    if (nextTravelled > a + 1e-9 && nextTravelled < b - 1e-9) {
                        ctx.lineTo(points[j].x, points[j].y);
                    }
                    if (nextTravelled >= b - 1e-9) break;
                    travelled = nextTravelled;
                    i = j;
                }

                const endPt = pointAlongPath(from, to, b);
                ctx.lineTo(endPt.x, endPt.y);
            };

            // Calculate a symmetric trim distance for every filleted corner.
            // The maximum is half of the shorter neighbouring corner-to-corner
            // arc, so adjacent fillets can meet but never cross each other.
            const data = new Map();
            const m = corners.length;
            for (let q = 0; q < m; q++) {
                const i = corners[q];
                let prevBoundary;
                let nextBoundary;

                if (closed) {
                    if (m === 1) {
                        // A single marked corner on a closed dense path has no
                        // meaningful corner-to-corner span. Fall back to the
                        // immediately adjacent samples, without drawing them
                        // again after the cut.
                        prevBoundary = (i - 1 + n) % n;
                        nextBoundary = (i + 1) % n;
                    } else {
                        prevBoundary = corners[(q - 1 + m) % m];
                        nextBoundary = corners[(q + 1) % m];
                    }
                } else {
                    prevBoundary = q > 0 ? corners[q - 1] : 0;
                    nextBoundary = q + 1 < m ? corners[q + 1] : n - 1;
                }

                const inSpan = distanceForward(prevBoundary, i);
                const outSpan = distanceForward(i, nextBoundary);
                const factor = cornerFactors
                    ? Math.max(0, Math.min(1, Number(cornerFactors[i]) || 0))
                    : 1;
                const cut = 0.5 * Math.min(inSpan, outSpan) * amount * factor;

                const inPt = pointAlongPath(prevBoundary, i, Math.max(0, inSpan - cut));
                const outPt = pointAlongPath(i, nextBoundary, cut);
                data.set(i, { prevBoundary, nextBoundary, inSpan, outSpan, cut, inPt, outPt });
            }

            if (closed) {
                const first = corners[0];
                const firstData = data.get(first);
                ctx.moveTo(firstData.outPt.x, firstData.outPt.y);

                for (let q = 0; q < m; q++) {
                    const from = corners[q];
                    const to = corners[(q + 1) % m];
                    const fromData = data.get(from);
                    const toData = data.get(to);
                    const span = distanceForward(from, to);

                    // Original spline only between the two cut points.
                    emitPathSlice(from, to, fromData.cut, Math.max(0, span - toData.cut));
                    // Replace the removed vertex neighbourhood with the fillet.
                    ctx.quadraticCurveTo(points[to].x, points[to].y, toData.outPt.x, toData.outPt.y);
                }
                ctx.closePath();
                return;
            }

            // Open path: endpoint -> first fillet -> ... -> last fillet -> endpoint.
            ctx.moveTo(points[0].x, points[0].y);
            let from = 0;
            let startTrim = 0;
            for (const corner of corners) {
                const d = data.get(corner);
                const span = distanceForward(from, corner);
                emitPathSlice(from, corner, startTrim, Math.max(0, span - d.cut));
                ctx.quadraticCurveTo(points[corner].x, points[corner].y, d.outPt.x, d.outPt.y);
                from = corner;
                startTrim = d.cut;
            }
            emitPathSlice(from, n - 1, startTrim, distanceForward(from, n - 1));
        }

