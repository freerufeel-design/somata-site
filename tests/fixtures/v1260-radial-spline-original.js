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
    // v12.6: replace the old fairing / outer-radius guard entirely for Unified.
    // Every segment is a cubic rail with a shared polar tangent at its knots.
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

// Somata 12.6 — radial spline. Works entirely on the CURRENT carrier, with
// no phase state, no cached geometry and no modification of Morph points.
// 0%: exact polyline; 100%: halfway (in polar knot space) to the circular
// target; 200%: circle. Knot tangents are always perpendicular to the local
// centre-to-knot radius for each positive slider setting.
// Complexity O(n), one cubic per source edge (open spirals remain open).
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
    const circleBlend=closed?(1-Math.cos(Math.PI*clip(value/2)))*.5:0;
    const handles=Math.max(1e-10,closed?clip(value):Math.min(1.5,value));
    let area=0,radius=0,total=0,longest=0;
    const arc=[0];
    for(let i=0;i<n;i++){
        const p=pts[i];radius=Math.max(radius,Math.hypot(p.x,p.y));
        if(i<edgeCount){
            const q=pts[(i+1)%n],length=Math.hypot(q.x-p.x,q.y-p.y);
            total+=length;longest=Math.max(longest,length);arc.push(total);
            area+=p.x*q.y-p.y*q.x;
        }
    }
    if(!Number.isFinite(total)||total<1e-12){
        ctx.moveTo(pts[0].x,pts[0].y);
        for(let i=1;i<n;i++)ctx.lineTo(pts[i].x,pts[i].y);
        if(closed)ctx.closePath();
        return true;
    }
    // The same sign and circle anchor are used continuously throughout
    // 0..200%; only the circle's weight changes, never its correspondence.
    // IMPORTANT: winding area can cross zero when a self-intersecting Morph
    // changes topology. Changing circle direction at that sign boundary would
    // teleport half of the curve. Keep one stable positive traversal for the
    // display-only circle target; clockwise source paths may temporarily
    // unwind during 100–200% rounding, but never switch discontinuously.
    const sign=1;
    const theta0=Math.atan2(pts[0].y,pts[0].x);
    const knots=new Array(n),tangents=new Array(n),theta=new Array(n);
    for(let i=0;i<n;i++){
        const p=pts[i];
        const angle=theta0+sign*2*Math.PI*arc[i]/total;
        theta[i]=angle;
        const x=closed?p.x+(radius*Math.cos(angle)-p.x)*circleBlend:p.x;
        const y=closed?p.y+(radius*Math.sin(angle)-p.y)*circleBlend:p.y;
        knots[i]={x,y};
        const norm=Math.hypot(x,y);
        if(norm>1e-10){tangents[i]={x:-sign*y/norm,y:sign*x/norm};}
        else {tangents[i]={x:-sign*Math.sin(angle),y:sign*Math.cos(angle)};}
    }
    // At exactly 200%, a dense contour can be rendered as 16 circle cubics.
    // The preceding curve approaches the same circle continuously; no phase
    // threshold, points reshuffling, or newly visible branch is involved.
    if(closed && value>=2 && n>=96 && radius>1e-10 && longest<=total/16 &&
       typeof somataDrawFullRoundingCircle==='function'){
        somataDrawFullRoundingCircle(ctx,radius,theta0,sign);
        return true;
    }
    ctx.moveTo(knots[0].x,knots[0].y);
    for(let i=0;i<edgeCount;i++){
        const j=(i+1)%n,p=knots[i],q=knots[j];
        const chord=Math.hypot(q.x-p.x,q.y-p.y);
        const baseHandle=chord*(.31*handles);
        let h1=baseHandle,h2=baseHandle;
        if(closed && value>1){
            const delta=2*Math.PI*(arc[i+1]-arc[i])/total;
            const circleHandle=(4*radius/3)*Math.tan(Math.min(Math.PI,delta)/4);
            const blend=clip(value-1);
            const blendSmooth=blend*blend*(3-2*blend);
            h1=baseHandle+(circleHandle-baseHandle)*blendSmooth;
            h2=h1;
        }
        const a=tangents[i],b=tangents[j];
        ctx.bezierCurveTo(p.x+a.x*h1,p.y+a.y*h1,
            q.x-b.x*h2,q.y-b.y*h2,q.x,q.y);
    }
    if(closed)ctx.closePath();
    return true;
}
