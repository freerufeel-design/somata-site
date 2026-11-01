'use strict';
// Somata 12.4 — lightweight, continuously weighted spline rounding.
// Only the display rail changes. Original Morph vertices, point mapping,
// phase clocks and spiral transport are never mutated.
// O(N) Bézier path: exactly one cubic per original edge (except n=2).
function somataDrawSplineCornerMode(ctx,raw,closed,rounding,options={}) {
    if(!ctx||typeof ctx.bezierCurveTo!=='function'||!Array.isArray(raw)||raw.length<2)return false;
    const pts=raw.filter(p=>p&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y)));
    const n=pts.length;
    if(n<2)return false;
    const value=Math.max(0,Math.min(2,Number(rounding)||0));
    if(value<=0){
        if(options.layer?.roundingShape==='hybrid'){
            ctx.moveTo(pts[0].x,pts[0].y);
            for(let i=1;i<n;i++)ctx.lineTo(pts[i].x,pts[i].y);
            if(closed)ctx.closePath();
            return true;
        }
        return false; // Legacy spline still keeps its native zero profile.
    }
    if(n===2){ctx.moveTo(pts[0].x,pts[0].y);ctx.lineTo(pts[1].x,pts[1].y);if(closed)ctx.closePath();return true;}
    const mix=(a,b,t)=>a+(b-a)*t;
    // 12.5: one continuous cubic display rail.  The old light spline
    // remains selectable; unified adds physical-radius fairing and aligns
    // both handles at every shared knot.  Neither path edits Morph points.
    const unified=options.layer?.roundingShape==='hybrid';
    // 12.6.1: use contour-space corner fairing, then circle convergence above 100%.
    // Every segment is a cubic rail with shared G1 tangents at its knots.
    if(unified)return somataDrawRadialSplineRounding(ctx,pts,Boolean(closed),value,options.layer);

    const smoothstep=t=>{const v=Math.max(0,Math.min(1,t));return v*v*(3-2*v);};
    // At the 200% limit a dense, well-sampled closed shape is a genuine
    // circle.  A fixed 16-piece cubic representation eliminates thousands
    // of redundant segments; use it only when every original edge occupies
    // at most 1/16 of the perimeter so the near-200% rail is already an
    // accurate circle. Sparse and highly nonuniform outlines retain their
    // own continuous 1-cubic-per-edge path at the endpoint.
    if(unified && closed && value>=2 && n>=96 &&
       typeof somataDrawFullRoundingCircle==='function'){
        let radius=0,area=0,total=0,longest=0;
        for(let i=0;i<n;i++){
            const a=pts[i],b=pts[(i+1)%n];
            radius=Math.max(radius,Math.hypot(a.x,a.y));
            area+=a.x*b.y-a.y*b.x;
            const d=Math.hypot(b.x-a.x,b.y-a.y);
            total+=d;longest=Math.max(longest,d);
        }
        if(radius>1e-10&&total>1e-10&&longest<=total/16){
            somataDrawFullRoundingCircle(ctx,radius,Math.atan2(pts[0].y,pts[0].x),area>=0?1:-1);
            return true;
        }
    }
    const u=Math.min(1,value);
    const extra=closed&&value>1?Math.max(0,Math.min(1,value-1)):0;
    const circleWeight=extra*extra*(3-2*extra);
    // Open rails have no circle target. Continue enlarging their physical
    // fairing shoulder above 100% without moving or joining the endpoints.
    const openExtra=unified&&!closed&&value>1?smoothstep(value-1):0;
    const closedLoop=Boolean(closed);
    const knots=new Array(n),derivatives=new Array(n);
    const last=n-1;
    const baselineSpline=Math.max(0,Math.min(1,Number(options.baseSplineBlend)||0));
    // A densely resampled authored spline can have hundreds of neighbours
    // between two logical polygon corners.  Smoothing ONLY immediate sample
    // neighbours then has an O(step^2) displacement and the 0–100% slider
    // looks inert.  Use a physical shoulder derived from the original base
    // polygon edge, while retaining a smoothly weighted fallback for sparse
    // contours. This changes the displayed rail, never Morph vertices.
    const layer=options.layer;
    let arc=null,perimeter=0,probeDistance=0,probeWeight=0;
    if(layer && n>=4 && Number.isFinite(Number(layer.N)) && Number(layer.N)>=3){
        let radius=0;
        for(const p of pts)radius=Math.max(radius,Math.hypot(p.x,p.y));
        // The shoulder belongs to the BASE polygon, never to a newborn
        // microscopic Morph subdivision or an expanded spline excursion.
        const authoredRadius=Number(layer.radius)*Number(layer.radiusMultiplier??1);
        const baseRadius=unified&&Number.isFinite(authoredRadius)&&authoredRadius>1e-10
            ?authoredRadius:radius;
        const baseEdge=2*baseRadius*Math.sin(Math.PI/Math.max(3,Math.round(Number(layer.N))));
        arc=[0];
        const edgeCount=closed?n:n-1;
        for(let i=0;i<edgeCount;i++){
            const j=(i+1)%n;
            perimeter+=Math.hypot(pts[j].x-pts[i].x,pts[j].y-pts[i].y);
            arc.push(perimeter);
        }
        const meanStep=perimeter/Math.max(1,edgeCount);
        const ratio=baseEdge/Math.max(meanStep,1e-12);
        let density=Math.max(0,Math.min(1,(ratio-1.5)/2.5));
        density=density*density*(3-2*density);
        probeWeight=unified?Math.min(1,0.38+0.60*density+0.24*(1-density)*openExtra):.72*density;
        probeDistance=Math.min(baseEdge*(unified?(.50+.28*openExtra):.64),perimeter/(closed?8:7));
        if(!(perimeter>1e-9&&probeDistance>1e-9&&probeWeight>1e-9))arc=null;
    }
    const probeCursors=[0,0];
    const arcPoint=(station,direction)=>{
        if(!arc)return null;
        if(closed){station=((station%perimeter)+perimeter)%perimeter;}
        else station=Math.max(0,Math.min(perimeter,station));
        // Stations advance monotonically with the contour index, except for
        // one wrap at the periodic seam. Two independent cursors keep the
        // entire physical-scale smoothing pass O(N), not O(N log N).
        let edge=probeCursors[direction];
        if(station<arc[edge])edge=0;
        while(edge<arc.length-2 && station>arc[edge+1])edge++;
        probeCursors[direction]=edge;
        const next=(edge+1)%n;
        const length=arc[edge+1]-arc[edge];
        const t=length>1e-12?(station-arc[edge])/length:0;
        return {x:pts[edge].x+(pts[next].x-pts[edge].x)*t,
                y:pts[edge].y+(pts[next].y-pts[edge].y)*t};
    };
    const at=i=>pts[(i+n)%n];
    // Move the *rendering* knots away from the hard polygon vertices.
    // Harmonic adjacent-edge weighting prevents a newborn tiny edge from
    // acquiring an O(1) influence on the parent curve.
    for(let i=0;i<n;i++){
        const p=pts[i];
        if(!closedLoop&&(i===0||i===last)){
            knots[i]={x:p.x,y:p.y};continue;
        }
        const a=at(i-1),b=at(i+1);
        const la=Math.hypot(p.x-a.x,p.y-a.y),lb=Math.hypot(b.x-p.x,b.y-p.y);
        const denom=Math.max(1e-15,la+lb);
        const left=.45*lb/denom,right=.45*la/denom;
        let x=p.x+u*(left*(a.x-p.x)+right*(b.x-p.x));
        let y=p.y+u*(left*(a.y-p.y)+right*(b.y-p.y));
        if(arc){
            const leftProbe=arcPoint(arc[i]-probeDistance,0);
            const rightProbe=arcPoint(arc[i]+probeDistance,1);
            const targetX=(leftProbe.x+rightProbe.x)*.5;
            const targetY=(leftProbe.y+rightProbe.y)*.5;
            // Interpolating this additional fairing with 0% strength ensures
            // no hard onset at the origin or at changes in sample density.
            x+=(targetX-x)*u*probeWeight;
            y+=(targetY-y)*u*probeWeight;
        }
        knots[i]={x,y};
    }
    // The max exterior radius may not fall by more than the configured
    // fraction.  A single scale is applied to knots AND their controls,
    // never per-corner, so it cannot introduce a discontinuous joint.
    const originalRadius=pts.reduce((r,p)=>Math.max(r,Math.hypot(p.x,p.y)),0);
    let outerScale=1;
    if(unified && originalRadius>1e-10){
        const maxDrop=Math.max(0,Math.min(.9,(Number(layer?.roundingMaxRadiusDrop??30)||0)/100));
        const after=knots.reduce((r,p)=>Math.max(r,Math.hypot(p.x,p.y)),0);
        if(after>1e-10)outerScale=Math.max(1,(1-maxDrop)*originalRadius/after);
    }
    // A shared derivative at each vertex gives a G1 joint regardless of
    // the two neighbouring chord lengths. Open ends remain in place.
    for(let i=0;i<n;i++){
        const p=knots[i];
        const prev=i===0&&!closedLoop?{x:2*p.x-knots[1].x,y:2*p.y-knots[1].y}:knots[(i+n-1)%n];
        const next=i===last&&!closedLoop?{x:2*p.x-knots[last-1].x,y:2*p.y-knots[last-1].y}:knots[(i+1)%n];
        const length=Math.hypot(next.x-prev.x,next.y-prev.y);
        derivatives[i]=length>1e-12?{x:(next.x-prev.x)/length,y:(next.y-prev.y)/length}:{x:0,y:0};
    }
    // The original centripetal spline is the exact 0% baseline when the
    // authored profile is already a spline. Interpolate *control geometry*,
    // not only visual opacity, so the 0% boundary has no visible jump.
    const nativeKnots=knots.map(p=>({x:p.x,y:p.y}));
    // Above 100%, the same N cubic runs progressively target the exterior
    // circle, with vertex angles following the original arc-length ordering.
    // No phase-dependent tessellation or new topology at 100/200%.
    let circle=null;
    if(circleWeight>0){
        let signedArea=0,radius=0,perimeter=0;
        const arc=[0];
        for(let i=0;i<n;i++){
            const p=pts[i],q=at(i+1);
            signedArea+=p.x*q.y-p.y*q.x;
            radius=Math.max(radius,Math.hypot(p.x,p.y));
            perimeter+=Math.hypot(q.x-p.x,q.y-p.y);
            arc.push(perimeter);
        }
        if(radius>1e-9&&perimeter>1e-9){
            const sign=signedArea>=0?1:-1;
            const firstAngle=Math.atan2(pts[0].y,pts[0].x);
            const circleKnots=[],circleTangents=[];
            for(let i=0;i<n;i++){
                const angle=firstAngle+sign*2*Math.PI*arc[i]/perimeter;
                circleKnots.push({x:radius*Math.cos(angle),y:radius*Math.sin(angle)});
                circleTangents.push({x:-sign*Math.sin(angle),y:sign*Math.cos(angle)});
            }
            circle={knots:circleKnots,tangents:circleTangents,arc,perimeter,radius};
        }
    }
    if(circle){
        for(let i=0;i<n;i++){
            knots[i].x=mix(knots[i].x,circle.knots[i].x,circleWeight);
            knots[i].y=mix(knots[i].y,circle.knots[i].y,circleWeight);
            const dx=mix(derivatives[i].x,circle.tangents[i].x,circleWeight);
            const dy=mix(derivatives[i].y,circle.tangents[i].y,circleWeight);
            const length=Math.hypot(dx,dy);
            derivatives[i]=length>1e-12?{x:dx/length,y:dy/length}:circle.tangents[i];
        }
    }
    const effectiveScale=1+(outerScale-1)*(1-circleWeight);
    ctx.moveTo(knots[0].x*effectiveScale,knots[0].y*effectiveScale);
    const edgeCount=closedLoop?n:n-1;
    for(let i=0;i<edgeCount;i++){
        const j=(i+1)%n,p=knots[i],q=knots[j];
        const length=Math.hypot(q.x-p.x,q.y-p.y);
        // A short edge has short handles even if other edges are long.
        // The cubic stays bounded and shares the exact vertex derivatives.
        const deltaCircle=circle?2*Math.PI*(circle.arc[i+1]-circle.arc[i])/circle.perimeter:0;
        const circleHandle=circle?4*circle.radius/3*Math.tan(deltaCircle/4):0;
        const nativeP=nativeKnots[i],nativeQ=nativeKnots[j];
        const baseLength=Math.hypot(nativeQ.x-nativeP.x,nativeQ.y-nativeP.y);
        const baseHandle=(baseLength/3)*u;
        let c1={x:nativeP.x+derivatives[i].x*baseHandle,y:nativeP.y+derivatives[i].y*baseHandle};
        let c2={x:nativeQ.x-derivatives[j].x*baseHandle,y:nativeQ.y-derivatives[j].y*baseHandle};
        if(baselineSpline>0 && typeof centripetalSplineBezierControls==='function'){
            const prev=i===0&&!closedLoop?{x:2*nativeP.x-nativeQ.x,y:2*nativeP.y-nativeQ.y}:nativeKnots[(i+n-1)%n];
            const next=j===last&&!closedLoop?{x:2*nativeQ.x-nativeP.x,y:2*nativeQ.y-nativeP.y}:nativeKnots[(j+1)%n];
            const native=centripetalSplineBezierControls(prev,nativeP,nativeQ,next,0.5);
            c1.x=mix(c1.x,native.c1.x,baselineSpline);c1.y=mix(c1.y,native.c1.y,baselineSpline);
            c2.x=mix(c2.x,native.c2.x,baselineSpline);c2.y=mix(c2.y,native.c2.y,baselineSpline);
        }
        if(circle && circleWeight>0){
            c1.x=mix(c1.x,circle.knots[i].x+circle.tangents[i].x*circleHandle,circleWeight);
            c1.y=mix(c1.y,circle.knots[i].y+circle.tangents[i].y*circleHandle,circleWeight);
            c2.x=mix(c2.x,circle.knots[j].x-circle.tangents[j].x*circleHandle,circleWeight);
            c2.y=mix(c2.y,circle.knots[j].y-circle.tangents[j].y*circleHandle,circleWeight);
        }
        if(unified){
            // Align AFTER both the native-spline and circle blends. Blending
            // two G1 curves by their control points is not generally G1 when
            // their handle lengths differ.  Reuse one tangent per knot.
            const align=smoothstep(u/.12);
            const firstLength=Math.hypot(c1.x-p.x,c1.y-p.y);
            const lastLength=Math.hypot(q.x-c2.x,q.y-c2.y);
            c1.x=mix(c1.x,p.x+derivatives[i].x*firstLength,align);
            c1.y=mix(c1.y,p.y+derivatives[i].y*firstLength,align);
            c2.x=mix(c2.x,q.x-derivatives[j].x*lastLength,align);
            c2.y=mix(c2.y,q.y-derivatives[j].y*lastLength,align);
        }
        ctx.bezierCurveTo(c1.x*effectiveScale,c1.y*effectiveScale,c2.x*effectiveScale,c2.y*effectiveScale,q.x*effectiveScale,q.y*effectiveScale);
    }
    if(closedLoop)ctx.closePath();
    return true;
}

// Somata 12.6.1 — two deliberately separate operations:
// 0..100% performs REAL contour-space corner fairing, without any circle
// projection. 100..200% smoothly approaches a circular display rail.
// O(N) (monotone perimeter probes), one cubic per source edge; no mutation
// of the original Morph rail, point matching or phase state.
function somataDrawRadialSplineRounding(ctx,pts,closed,value,layer){
    const n=pts.length,edgeCount=closed?n:n-1;
    if(n<2)return false;
    if(value<=0){
        ctx.moveTo(pts[0].x,pts[0].y);
        for(let i=1;i<n;i++)ctx.lineTo(pts[i].x,pts[i].y);
        if(closed)ctx.closePath();
        return true;
    }
    if(n===2){ctx.moveTo(pts[0].x,pts[0].y);ctx.lineTo(pts[1].x,pts[1].y);if(closed)ctx.closePath();return true;}
    const clip=t=>Math.max(0,Math.min(1,t));
    const smooth=t=>{const s=clip(t);return s*s*(3-2*s);};
    const u=clip(value);
    const circleWeight=closed&&value>1?smooth(value-1):0;
    let radius=0,total=0,longest=0;
    const arc=[0];
    for(let i=0;i<n;i++){
        const p=pts[i];radius=Math.max(radius,Math.hypot(p.x,p.y));
        if(i<edgeCount){
            const q=pts[(i+1)%n],length=Math.hypot(q.x-p.x,q.y-p.y);
            total+=length;longest=Math.max(longest,length);arc.push(total);
        }
    }
    if(!Number.isFinite(total)||total<1e-12){
        ctx.moveTo(pts[0].x,pts[0].y);
        for(let i=1;i<n;i++)ctx.lineTo(pts[i].x,pts[i].y);
        if(closed)ctx.closePath();
        return true;
    }
    // A dense contour has the same limit as the 16-cubic circle shortcut.
    // Do this BEFORE smoothing probes/Fourier projections: the approved
    // 200% path needs only 16 cubics and must not depend on point index.
    if(closed&&value>=2&&n>=96&&radius>1e-10&&longest<=total/16&&
        typeof somataDrawFullRoundingCircle==='function'){
        somataDrawFullRoundingCircle(ctx,radius,0,1);
        return true;
    }
    // The physical shoulder is based on the ORIGINAL base polygon edge.
    // Tiny newborn Morph edges never control the radius of the parent fillet.
    const baseRadius=Number(layer?.radius)*Number(layer?.radiusMultiplier??1);
    const sides=Math.round(Number(layer?.N));
    const baseEdge=Number.isFinite(baseRadius)&&baseRadius>1e-12&&sides>=3
        ?2*baseRadius*Math.sin(Math.PI/sides)
        :total/Math.max(closed?3:2,Math.min(edgeCount,10));
    // At 100%, probe half a base edge in either arc-length direction.
    // For an isolated polygon corner this produces the midpoint of the
    // entering/exiting tangent points. Closer corners automatically share
    // a physical support window, rather than introducing a new sharp tip.
    const reach=Math.min(.5*baseEdge*u,total/(closed?4:2.25));
    const cursors=[0,0];
    const sample=(station,which)=>{
        if(closed)station=((station%total)+total)%total;
        else station=Math.max(0,Math.min(total,station));
        let j=cursors[which];
        if(station<arc[j])j=0;
        while(j<edgeCount-1&&arc[j+1]<station)j++;
        cursors[which]=j;
        const length=arc[j+1]-arc[j],t=length>1e-14?clip((station-arc[j])/length):0;
        const a=pts[j],b=pts[(j+1)%n];
        return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
    };
    const knots=new Array(n),tangents=new Array(n),nativeTangents=new Array(n);
    for(let i=0;i<n;i++){
        const p=pts[i];
        // Open endpoints always stay in place and keep their end tangents.
        const endpoint=!closed&&(i===0||i===n-1);
        const a=sample(arc[i]-reach,0),b=sample(arc[i]+reach,1);
        const dx=b.x-a.x,dy=b.y-a.y,dnorm=Math.hypot(dx,dy);
        let tx=dnorm>1e-12?dx/dnorm:0,ty=dnorm>1e-12?dy/dnorm:0;
        if(dnorm<=1e-12){
            // Reversal / zero-length mini-edge: the nearest surviving base
            // chord is a continuous fallback, not a sudden radial flip.
            const prev=pts[Math.max(0,i-1)],next=pts[Math.min(n-1,i+1)];
            const fx=next.x-prev.x,fy=next.y-prev.y,fn=Math.hypot(fx,fy);
            if(fn>1e-12){tx=fx/fn;ty=fy/fn;}
        }
        const weight=smooth(u);
        const fx=endpoint?p.x:p.x+(.5*(a.x+b.x)-p.x)*weight;
        const fy=endpoint?p.y:p.y+(.5*(a.y+b.y)-p.y)*weight;
        knots[i]={x:fx,y:fy};
        nativeTangents[i]={x:tx,y:ty};
    }
    // Recalculate shared tangents from the rounded knots. This prevents
    // control handles pointing backwards across collapsed mini-profiles.
    for(let i=0;i<n;i++){
        const p=knots[i],a=knots[i===0?(closed?n-1:0):i-1],b=knots[i===n-1?(closed?0:n-1):i+1];
        const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
        // Use physical probe direction for the boundary and degenerate cases.
        let t=d>1e-12?{x:dx/d,y:dy/d}:nativeTangents[i];
        if(!closed&&i===0)t=nativeTangents[i];
        if(!closed&&i===n-1)t=nativeTangents[i];
        tangents[i]=t;
    }
    // Circle starts ONLY ABOVE 100%. No radial interpolation whatsoever
    // for 0..100%, so a star stays a rounded star, not an inflated circle.
    // A new Morph phase is allowed to choose a different START VERTEX of a
    // closed path. Its final visible contour must NOT change as a result.
    // 12.6.1 used atan2(pts[0]) as the start of the circular target; that
    // introduced a whole-figure teleport at 101..199% on nonuniform profiles.
    // A first contour Fourier moment gives a phase that transforms exactly
    // with cyclic rotation of the points, while depending continuously on
    // the actual geometry. When that harmonic vanishes (e.g. a multi-wound
    // star) use index-invariant pointwise radial targets instead. Blend
    // smoothly so crossing a vanishing moment cannot flip the whole rail.
    const circleKnots=circleWeight>0?new Array(n):null;
    const circleTangent=circleWeight>0?new Array(n):null;
    if(circleKnots){
        let momentX=0,momentY=0;
        // Trapezoidal first harmonic of the closed contour: one sin/cos
        // evaluation per vertex, also reused by the circle target. This is
        // index-invariant even with very uneven edge spacing and is cheaper
        // than reevaluating trigonometry for every Bézier knot.
        const cosStation=new Float64Array(n),sinStation=new Float64Array(n);
        for(let i=0;i<n;i++){
            const phase=2*Math.PI*arc[i]/total;
            const co=Math.cos(phase),si=Math.sin(phase);
            cosStation[i]=co;sinStation[i]=si;
            const previous=arc[i]-arc[i===0?n-1:i-1]+(i===0?total:0);
            const following=arc[i+1]-arc[i];
            const weight=(previous+following)*.5;
            momentX+=weight*(pts[i].x*co+pts[i].y*si);
            momentY+=weight*(pts[i].y*co-pts[i].x*si);
        }
        const confidence=Math.hypot(momentX,momentY)/(Math.max(1e-12,total*radius));
        const gaugeWeight=smooth((confidence-.003)/.12);
        const anchorLength=Math.hypot(momentX,momentY);
        const anchorCos=anchorLength>0?momentX/anchorLength:1;
        const anchorSin=anchorLength>0?momentY/anchorLength:0;
        for(let i=0;i<n;i++){
            const co=anchorCos*cosStation[i]-anchorSin*sinStation[i];
            const si=anchorSin*cosStation[i]+anchorCos*sinStation[i];
            const p=pts[i];
            const plen=Math.hypot(p.x,p.y);
            // At the origin the radial projection is undefined. Use the
            // already-faired knot, which approaches this state continuously.
            const candidate=plen>1e-9*radius?p:knots[i];
            const candidateLen=Math.hypot(candidate.x,candidate.y);
            const rx=candidateLen>1e-12?candidate.x/candidateLen:co;
            const ry=candidateLen>1e-12?candidate.y/candidateLen:si;
            let nx=gaugeWeight*co+(1-gaugeWeight)*rx;
            let ny=gaugeWeight*si+(1-gaugeWeight)*ry;
            let norm=Math.hypot(nx,ny);
            if(norm<1e-10){nx=rx;ny=ry;norm=1;}
            nx/=norm;ny/=norm;
            const x=radius*nx,y=radius*ny;
            circleKnots[i]={x,y};circleTangent[i]={x:-ny,y:nx};
            knots[i].x+=(x-knots[i].x)*circleWeight;
            knots[i].y+=(y-knots[i].y)*circleWeight;
            const tx=tangents[i].x*(1-circleWeight)+circleTangent[i].x*circleWeight;
            const ty=tangents[i].y*(1-circleWeight)+circleTangent[i].y*circleWeight;
            const tn=Math.hypot(tx,ty);
            tangents[i]=tn>1e-10?{x:tx/tn,y:ty/tn}:circleTangent[i];
        }
    }
    // Keep one cubic per original edge, and one tangent shared by BOTH
    // adjacent cubics. Controls are non-negative and chord-limited to avoid
    // backwards handles on dense and nonuniform profiles.
    ctx.moveTo(knots[0].x,knots[0].y);
    for(let i=0;i<edgeCount;i++){
        const j=(i+1)%n,p=knots[i],q=knots[j];
        const length=Math.hypot(q.x-p.x,q.y-p.y);
        const h=length*(.28*smooth(u/.12));
        // The actual circular endpoints matter for multi-wound contours:
        // arc-length spacing alone can under-estimate a star's angular turn.
        const a0=circleKnots?Math.atan2(circleKnots[i].y,circleKnots[i].x):0;
        const a1=circleKnots?Math.atan2(circleKnots[j].y,circleKnots[j].x):0;
        const delta=circleKnots?Math.abs(Math.atan2(Math.sin(a1-a0),Math.cos(a1-a0))):0;
        const circleHandle=circleKnots?(4*radius/3)*Math.tan(delta/4):0;
        const handle=h+(circleHandle-h)*circleWeight;
        const a=tangents[i],b=tangents[j];
        ctx.bezierCurveTo(p.x+a.x*handle,p.y+a.y*handle,
            q.x-b.x*handle,q.y-b.y*handle,q.x,q.y);
    }
    if(closed)ctx.closePath();
    return true;
}
