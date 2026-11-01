'use strict';
// Somata 12.6.3 — Spline+ is the only selectable corner renderer.
// The radial/contour-space Spline+ kernel below is unchanged from 12.6.2.
// All display modes now use the same rail: 0..100% rounds original corners,
// 100..200% approaches a circle; Morph point movement is untouched.
function somataDrawSplineCornerMode(ctx, raw, closed, rounding, options = {}) {
    if(!ctx || typeof ctx.bezierCurveTo !== 'function' || !Array.isArray(raw) || raw.length < 2) return false;
    const pts = raw.filter(p=>p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
    if(pts.length < 2) return false;
    const value = Math.max(0, Math.min(2, Number(rounding) || 0));
    return somataDrawRadialSplineRounding(ctx, pts, Boolean(closed), value, options.layer);
}

// Unchanged approved 12.6.2 Spline+ geometric kernel.
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
    // A spiral is not a polygon which should turn into a single circle.
    // The 12.6.2 circular target destroyed the winding/corridor geometry above
    // 100%, including a 16-cubic single-circle shortcut at exactly 200%.
    // Keep the *transported* spiral rail and its original winding intact.
    const spiralCarrier=layer?.spiralEnabled===true;
    const circleWeight=!spiralCarrier&&closed&&value>1?smooth(value-1):0;
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
    if(!spiralCarrier&&closed&&value>=2&&n>=96&&radius>1e-10&&longest<=total/16&&
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
    // Above 100%, spiral contours extend their corner support gently; unlike
    // regular closed polygons they never interpolate their entire coil into
    // a circle. Smoothstep starts with zero derivative at the 100% seam.
    const spiralExtra=spiralCarrier&&value>1?.12*smooth(value-1):0;
    const reach=Math.min(.5*baseEdge*(u+spiralExtra),total/(closed?4:2.25));
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
