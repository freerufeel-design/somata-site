'use strict';
// Somata 11.0.19 — paired tangent knot evaluation, without altering Bézier geometry.
// The baseline rail is never moved/reordered. A compact, symmetric cubic
// convolution is applied to its tangent discontinuities in *arc space*.
// It is additive: when a tiny rail is born its two opposite tangent jumps
// cancel as its length tends to zero, with no cluster topology transition.
function somataBaseEdge(layer, points, closed) {
    const n=Math.max(2,Math.round(Number(layer?.N)||0));
    const radius=(Number(layer?.radius)||0)*(Number(layer?.radiusMultiplier)||1);
    if(Number.isFinite(radius)&&radius>0&&layer?.N!=null)
        return 2*radius*Math.sin(Math.PI/n);
    const lengths=[];
    for(let i=0;i<points.length-(closed?0:1);i++){
        const p=points[i],q=points[(i+1)%points.length],d=Math.hypot(q.x-p.x,q.y-p.y);
        if(d>1e-6)lengths.push(d);
    }
    if(!lengths.length)return 0;
    lengths.sort((a,b)=>a-b);
    return lengths[Math.min(lengths.length-1,Math.floor(lengths.length*.75))];
}
function drawUnifiedFilletPath(ctx, raw, closed, rounding, cornerFlags, options={}) {
    const pts=raw||[],count=pts.length;
    // A hard knot-count cutoff switched dense Morph/spiral contours to the
    // old polygon fillet engine as soon as one more knot was introduced.
    // Treat all valid rail sizes with the same kernel instead.
    if(count<3||!ctx||typeof ctx.bezierCurveTo!=='function')return false;
    const amount=Math.max(0,Math.min(2,Number(rounding)||0));
    if(amount<1e-6)return false;
    const flags=Array.isArray(cornerFlags)?cornerFlags:[];
    const allow=i=>flags[i]===true && options.bridgeRoundFlags?.[i]!==false &&
        (closed || (i>0&&i<count-1));
    if(!pts.some((_,i)=>allow(i)))return false;
    const edge=Math.max(1e-8,Number(options.baseEdge)||somataBaseEdge(options.layer,pts,closed));
    const drop=Math.max(0,Math.min(.95,Number(options.maxRadiusDrop??options.layer?.roundingMaxRadiusDrop??30)/100));
    const mix=(a,b,t)=>a+(b-a)*t;
    const source=[]; // dense representation ONLY of the original rendered rail
    const spline=options.spline===true;
    for(let i=0;i<count-(closed?0:1);i++){
        const j=(i+1)%count,p=pts[i],q=pts[j];
        source.push({x:p.x,y:p.y,corner:allow(i),synthetic:false});
        if(!spline||typeof centripetalSplineBezierControls!=='function')continue;
        const prev=closed||i>0?pts[(i-1+count)%count]:null;
        const next=closed||j<count-1?pts[(j+1)%count]:null;
        const whole=options.wholeCurveSpline===true;
        const p0=(whole||flags[i]!==true)&&prev?prev:{x:2*p.x-q.x,y:2*p.y-q.y};
        const p3=(whole||flags[j]!==true)&&next?next:{x:2*q.x-p.x,y:2*q.y-p.y};
        const c=centripetalSplineBezierControls(p0,p,q,p3,.5);
        // Do not derive the sampling count from the base edge, radius or
        // live Morph size. ceil(edge / ...) used to jump 10->11 samples as
        // edge crossed 20, even if the authored rail did not move at all.
        // This approximation belongs to the presentation layer; a fixed
        // count keeps its topology independent of phase and monoradius.
        const sub=16;
        for(let k=1;k<sub;k++){
            const t=k/sub,u=1-t;
            source.push({x:u*u*u*p.x+3*u*u*t*c.c1.x+3*u*t*t*c.c2.x+t*t*t*q.x,
                y:u*u*u*p.y+3*u*u*t*c.c1.y+3*u*t*t*c.c2.y+t*t*t*q.y,corner:false,synthetic:true});
        }
    }
    if(!closed)source.push({x:pts[count-1].x,y:pts[count-1].y,corner:false,synthetic:false});
    // Remove zero-length spans. Coincident newborn anchors do not introduce
    // an undefined tangent or a division by zero.
    const rail=[];
    const epsilon=Math.max(1e-10,edge*1e-10);
    // A newly born microscopic edge must not be treated as a new independent
    // corner merely because its endpoints move by a few floating-point ulps.
    // Keep the geometric collapse scale separate from the much smaller
    // arithmetic epsilon used for one-sided derivatives and exact cubic knots.
    const collapseTolerance=Math.max(epsilon,edge*2e-6);
    for(let si=0;si<source.length;si++){
        const p=source[si],last=rail[rail.length-1];
        if(last&&Math.hypot(last.x-p.x,last.y-p.y)<collapseTolerance){
            last.corner ||= p.corner;last.synthetic &&= p.synthetic;
            // Never discard an authored open-path endpoint when its final
            // micro-edge collapses. The final anchor belongs to Morph.
            if(!closed && si===source.length-1){last.x=p.x;last.y=p.y;}
            continue;
        }
        rail.push({...p});
    }
    if(closed&&rail.length>1&&Math.hypot(rail[0].x-rail.at(-1).x,rail[0].y-rail.at(-1).y)<collapseTolerance){
        rail[0].corner ||= rail.at(-1).corner;
        rail[0].synthetic &&= rail.at(-1).synthetic;rail.pop();
    }
    const n=rail.length;
    if(n<3)return false;
    const edges=closed?n:n-1,arc=[0],vel=[],knots=[];
    for(let i=0;i<edges;i++){
        const p=rail[i],q=rail[(i+1)%n];
        const d=Math.hypot(q.x-p.x,q.y-p.y);
        if(d<epsilon)return false;
        vel.push({x:(q.x-p.x)/d,y:(q.y-p.y)/d});arc.push(arc[i]+d);
    }
    const length=arc[edges];
    if(!(length>epsilon))return false;
    const bisect=(sorted,x)=>{
        let lo=0,hi=sorted.length;
        while(lo<hi){const mid=(lo+hi)>>1;if(sorted[mid]<x)lo=mid+1;else hi=mid;}
        return lo;
    };
    const at=(s,side=1)=>{
        const x=closed?(side<0&&Math.abs(s-length)<epsilon?length:((s%length)+length)%length):Math.max(0,Math.min(length,s));
        let j=bisect(arc,x);
        // Modulo of a closed arc may be a few ulps above a vertex. Snap
        // from EITHER side before selecting the incoming/outgoing tangent.
        if(j>0&&Math.abs(arc[j-1]-x)<=epsilon)j--;
        if(j<arc.length&&Math.abs(arc[j]-x)<=epsilon)
            j=side<0?Math.max(0,j-1):Math.min(edges-1,j);
        else j=Math.max(0,j-1);
        j=Math.min(edges-1,j);
        const p=rail[j],v=vel[j],d=x-arc[j];
        return {point:{x:p.x+v.x*d,y:p.y+v.y*d},velocity:v};
    };
    // The triangle kernel has the compact corner response
    // G(t) = (w-|t|)^3/(6*w*w), |t|<w. Its value and derivative vanish
    // exactly at both ends. Adding responses is equivalent to convolution
    // when every corner is enabled, so overlaps NEVER change the algorithm.
    let width=Math.min(length*(closed?.48:.98),edge*.5*amount);
    if(width<epsilon)return false;
    // A newborn edge can be smaller than a pixel but have a full-size
    // tangent change. If one of its anchors has a non-roundable flag, merely
    // ignoring that jump changes the *parent* round by O(width), even as
    // the edge shrinks to zero. Fade the missing jump into the parent fillet
    // using arc distance, rather than abruptly adding it at zero length.
    // Authored unrounded joins farther away remain absolutely unchanged.
    const allowedStations=[];
    for(let i=0;i<n;i++)if(rail[i].corner&&(closed||(i>0&&i<n-1)))allowedStations.push(arc[i]);
    if(!allowedStations.length)return false;
    const microReach=Math.min(edge*.16,width*.4);
    const events=[];
    for(let i=0;i<n;i++){
        if(!closed&&(i===0||i===n-1))continue;
        let weight=rail[i].corner?1:0;
        // The auxiliary points sampled *on* an authored spline are not
        // independent newly-born profile corners. Never promote their tiny
        // tessellation kinks into extra fillets.
        if(!weight&&!rail[i].synthetic&&microReach>epsilon){
            const s=arc[i],j=bisect(allowedStations,s);
            const before=allowedStations[(j-1+allowedStations.length)%allowedStations.length];
            const after=allowedStations[j%allowedStations.length];
            const d=closed
                ?Math.min(((s-before+length)%length),((after-s+length)%length))
                :Math.min(j? s-allowedStations[j-1]:Infinity,
                    j<allowedStations.length?allowedStations[j]-s:Infinity);
            if(d<microReach){
                const u=d/microReach;
                // C1 onset and fade: no flag or topology threshold can create
                // a finite change in shape at a phase boundary.
                weight=1-u*u*(3-2*u);
            }
        }
        // Open spiral ends are unroundable by construction. A true interior
        // corner can be born a few nanometres from an open endpoint; its
        // response must fade to ZERO as it collapses into that endpoint,
        // rather than instantly applying a full-size fillet at t>0.
        if(!closed && microReach>epsilon){
            const d=Math.min(arc[i],length-arc[i]);
            if(d<microReach){
                const u=Math.max(0,d/microReach);
                weight*=u*u*(3-2*u);
            }
        }
        if(weight<=0)continue;
        const prev=vel[(i-1+edges)%edges],next=vel[i%edges];
        const jump={x:next.x-prev.x,y:next.y-prev.y};
        if(Math.hypot(jump.x,jump.y)<1e-12)continue;
        events.push({s:arc[i],dv:{x:jump.x*weight,y:jump.y*weight},factor:1});
        // Partial activation of a corner cannot be modelled by multiplying
        // its tangent jump alone: that leaves (1-weight)*jump as a hard cusp.
        // Resolve the missing jump in a smaller, vanishing-support kernel.
        // As weight approaches 0 or 1 the supplementary displacement tends
        // continuously to zero. Preserve the authored sharp join at weight 0.
        if(weight>0 && weight<1){
            let factor=.48*weight*(1-weight); // <= 0.12 of the main width
            if(!closed){
                const endpointDistance=Math.min(arc[i],length-arc[i]);
                factor=Math.min(factor,.45*endpointDistance/width);
            }
            if(factor>1e-8)
                events.push({s:arc[i],dv:{x:jump.x*(1-weight),y:jump.y*(1-weight)},factor});
        }
    }
    if(!events.length)return false;
    const basis=[];
    for(const ev of events){
        for(let k=closed?-1:0;k<=(closed?1:0);k++){
            const s=ev.s+k*length;
            if(s+width<0||s-width>length)continue;
            basis.push({s,dv:ev.dv,factor:ev.factor});

        }
    }
    basis.sort((a,b)=>a.s-b.s);
    const basisStations=basis.map(v=>v.s);
    const calc=(s,side=1,w=width)=>{
        const origin=at(s,side),p=origin.point,d=origin.velocity;
        let dx=0,dy=0,vx=0,vy=0;
        // Only nearby corners contribute; complexity depends on kernel span,
        // not on the total number of profile knots.
        for(let k=bisect(basisStations,s-w);k<basis.length && basis[k].s<s+w;k++){
            const v=basis[k];
            const localWidth=w*v.factor;
            const t=s-v.s,abs=Math.abs(t);
            if(abs>=localWidth)continue;
            const h=localWidth-abs;
            const g=h*h*h/(6*localWidth*localWidth);
            // Near an exact knot, floating-point arc sums can put the query
            // a few ulps to either side of the same vertex. Honour the
            // requested one-sided derivative, not the sign of that roundoff:
            // otherwise a long Bézier handle appears at a phase boundary.
            const derivativeSide=Math.abs(t)<=epsilon?(side<0?1:-1):(t<0?1:-1);
            const gp=derivativeSide*h*h/(2*localWidth*localWidth);
            dx+=g*v.dv.x;dy+=g*v.dv.y;
            vx+=gp*v.dv.x;vy+=gp*v.dv.y;
        }
        return {p,velocity:d,dx,dy,vx:d.x+vx,vy:d.y+vy};
    };
    // Reduce effective kernel WIDTH, not a mixture with a sharp polygon:
    // this keeps every enabled fillet tangent at the radius safety limit.
    // Nearby vertices never cap one another; only the global exterior radius
    // may cause this global, continuous reduction in rounding.
    // Avoid spreading arbitrarily large authored paths as call arguments.
    // Large spiral rails can exceed the engine argument-count limit.
    let originalRadius=0;
    for(const p of pts)originalRadius=Math.max(originalRadius,Math.hypot(p.x,p.y));
    const required=originalRadius*Math.min(1,(1-drop)+.008);
    // A curve's exterior radius is not monotone in smoothing width. The old
    // guard also treated each *inward* tangent jump independently, ignoring
    // the outward jump that cancels it when a newborn edge collapses. Merely
    // crossing the rail merge tolerance could therefore change the guard by
    // tens of units while the real rounded path hardly moved.
    //
    // At each rail station, project the FULL (signed) Bézier displacement on
    // the outward radius. Accumulate only its downward variation across a
    // fixed width grid. This gives a continuous, non-increasing envelope of
    // the radial witness, yet opposite jumps cancel *before* applying the
    // conservative penalty. The global maximum of these envelopes is also
    // monotone: there can be no jumps between disconnected guard roots.
    if(drop===0 && options.skipRadiusSearch!==true)width=Math.min(width,epsilon*2);
    else if(required>epsilon && options.skipRadiusSearch!==true){
        const initialWidth=width;
        // Fast, *conservative* radial witness. At a fixed rail station the
        // triangular cubic response grows monotonically with support width.
        // Therefore the sum of all negative signed contributions bounds the
        // accumulated downward variation used by the full radius guard.
        // If even that pessimistic bound leaves one witness above the target,
        // the full grid search would keep initialWidth unchanged. This does
        // not interpolate, cache, or alter Morph geometry; it only avoids
        // O(stations x nearby corners x samples) work in safe frames.
        let peakIndex=0,peakRadius=-Infinity;
        for(let i=0;i<n;i++){
            const r=Math.hypot(rail[i].x,rail[i].y);
            if(r>peakRadius){peakRadius=r;peakIndex=i;}
        }
        let guardIsProvablyInactive=false;
        if(options.forceFullRadiusGuard!==true && peakRadius>=required && peakRadius>epsilon){
            const station=arc[peakIndex];
            const radialX=rail[peakIndex].x/peakRadius;
            const radialY=rail[peakIndex].y/peakRadius;
            let worstLoss=0;
            for(let j=bisect(basisStations,station-initialWidth);
                j<basis.length && basis[j].s<=station+initialWidth;j++){
                const ev=basis[j];
                const projected=radialX*ev.dv.x+radialY*ev.dv.y;
                if(projected>=0)continue;
                const support=initialWidth*ev.factor;
                const h=support-Math.abs(station-ev.s);
                if(h>0)worstLoss+=(-projected)*h*h*h/(6*support*support);
            }
            // The existing full guard subtracts precisely 4% of the
            // original radius at its final sample. Include this reserve.
            guardIsProvablyInactive=peakRadius-worstLoss-.04*originalRadius>=required+1e-10;
        }
        if(!guardIsProvablyInactive){
        const steps=8;
        const lower=Array(steps+1).fill(0);
        // On dense curves, allocating one object per influencing corner per
        // witness per frame can create millions of short-lived allocations.
        // Reuse primitive work buffers, with the EXACT original iteration
        // and summation order. This changes no radius decision or Bézier.
        const influenceDistance=new Float64Array(basis.length);
        const influenceFactor=new Float64Array(basis.length);
        const influenceProjection=new Float64Array(basis.length);
        // A small monotone reserve ensures a stationary unrounded tip cannot
        // suddenly release the whole width when it crosses the target radius.
        const guardSlope=.04*originalRadius/Math.max(initialWidth,epsilon);
        for(let i=0;i<n;i++){
            const point=rail[i],radius=Math.hypot(point.x,point.y);
            if(radius+1e-12<required || radius<=epsilon)continue;
            const station=arc[i],radialX=point.x/radius,radialY=point.y/radius;
            let influenceCount=0;
            for(let j=bisect(basisStations,station-initialWidth);
                j<basis.length&&basis[j].s<=station+initialWidth;j++){
                const ev=basis[j];
                const projected=radialX*ev.dv.x+radialY*ev.dv.y;
                if(Math.abs(projected)>1e-14){
                    influenceDistance[influenceCount]=Math.abs(station-ev.s);
                    influenceFactor[influenceCount]=ev.factor;
                    influenceProjection[influenceCount]=projected;
                    influenceCount++;
                }
            }
            let previous=radius,loss=0;
            lower[0]=Math.max(lower[0],radius);
            for(let k=1;k<=steps;k++){
                const w=initialWidth*k/steps;
                let current=radius;
                for(let j=0;j<influenceCount;j++){
                    const support=w*influenceFactor[j],h=support-influenceDistance[j];
                    if(h>0)current+=influenceProjection[j]*h*h*h/(6*support*support);
                }
                // Signed contributions are summed BEFORE computing inward
                // variation. Their cancellation survives vanishing mini-edges.
                loss+=Math.max(0,previous-current);
                previous=current;
                lower[k]=Math.max(lower[k],radius-loss);
            }
        }
        for(let k=0;k<=steps;k++)lower[k]-=guardSlope*initialWidth*k/steps;
        if(lower[steps]<required){
            let k=1;
            while(k<steps && lower[k]>=required)k++;
            const before=lower[k-1],after=lower[k];
            const frac=after<before?Math.max(0,Math.min(1,(before-required)/(before-after))):0;
            width=Math.max(epsilon*2,initialWidth*(k-1+frac)/steps);
        }
        } // full signed-variation guard required
    }
    // For a near-zero loss budget, the strict maximum-radius constraint is
    // singular: an arbitrarily small change in which tip is outermost can
    // otherwise activate an entire fillet at once. Give these very strict
    // budgets a width envelope that tends continuously to zero. Above 2%
    // the envelope is inactive; the normal global radius guard still applies.
    if(drop>0 && drop<.02 && options.skipRadiusSearch!==true){
        const u=drop/.02;
        const budgetBlend=u*u*u*u;
        width=Math.max(epsilon*2,Math.min(width,edge*amount*budgetBlend));
    }
    // The piecewise-convolution curve is EXACTLY cubic between these knots.
    // Changing the number of knots cannot change the geometric curve.
    for(const ev of basis){
        const s=ev.s;
        // The periodic basis is selected at the INITIAL kernel width, but
        // the exterior-radius guard may subsequently narrow that width.
        // A copy which no longer overlaps [0,length] must not contribute
        // NEGATIVE or >length stations: those previously created a cubic
        // loop at the beginning/end of a closed Morph or spiral phase.
        const support=width*ev.factor;
        if(s+support<0 || s-support>length)continue;
        const clampStation=t=>Math.max(0,Math.min(length,t));
        knots.push(clampStation(s-support),clampStation(s),clampStation(s+support));
    }
    for(let i=0;i<arc.length;i++)knots.push(arc[i]);
    knots.push(0,length);
    // The compact interior-corner response can extend beyond the first or
    // last authored *open* endpoint. That moved spiral/Morph endpoints by
    // several units at large radii. Undo only the spill at either boundary,
    // using local cubic Hermite corrections whose position AND derivative
    // vanish at the end of their support. Thus the finished curve remains
    // piecewise cubic and C1 at the two new shoulder knots. Closed contours
    // must not be modified: they already use periodic corner responses.
    const shoulder=!closed?Math.min(width,length/3):0;
    const left=!closed?calc(0,1):null;
    const right=!closed?calc(length,-1):null;
    if(shoulder>0)knots.push(shoulder,length-shoulder);
    knots.sort((a,b)=>a-b);
    // Keep *every real rail vertex*, even a newborn span only a few ulps
    // above the merge tolerance. Dropping that tiny knot would connect its
    // outward tangent to the next long cubic: a 1e-8 edge becomes a huge horn.
    const knotTol=Math.max(1e-13,Math.min(epsilon*.25,width*1e-8));
    const times=[];
    for(const s of knots)if(!times.length||s-times.at(-1)>knotTol)times.push(s);
    if(length-times.at(-1)>knotTol)times.push(length);
    // At each knot we need the incoming and outgoing derivatives of the
    // SAME geometric point. Computing them independently scans every active
    // corner kernel twice and, on broad overlapping fillets, dominates the
    // frame time. Share the point/kernel sum, but retain the exact original
    // event order and one-sided signs for BOTH derivatives.
    const valuePair=(s)=>{
        const plus=at(s,1),minus=at(s,-1);
        let dx=0,dy=0,plusX=0,plusY=0,minusX=0,minusY=0;
        for(let k=bisect(basisStations,s-width);k<basis.length && basis[k].s<s+width;k++){
            const v=basis[k];
            const localWidth=width*v.factor;
            const t=s-v.s,abs=Math.abs(t);
            if(abs>=localWidth)continue;
            const h=localWidth-abs;
            const g=h*h*h/(6*localWidth*localWidth);
            const gpPlus=(Math.abs(t)<=epsilon?-1:(t<0?1:-1))*h*h/(2*localWidth*localWidth);
            const gpMinus=(Math.abs(t)<=epsilon?1:(t<0?1:-1))*h*h/(2*localWidth*localWidth);
            dx+=g*v.dv.x;dy+=g*v.dv.y;
            plusX+=gpPlus*v.dv.x;plusY+=gpPlus*v.dv.y;
            minusX+=gpMinus*v.dv.x;minusY+=gpMinus*v.dv.y;
        }
        let x=plus.point.x+dx,y=plus.point.y+dy;
        let xMinus=minus.point.x+dx,yMinus=minus.point.y+dy;
        let vxPlus=plus.velocity.x+plusX,vyPlus=plus.velocity.y+plusY;
        let vxMinus=minus.velocity.x+minusX,vyMinus=minus.velocity.y+minusY;
        // The two evaluations used to apply identical Hermite shoulder
        // corrections. Preserve their arithmetic and exact endpoint anchors.
        if(shoulder>0 && s<shoulder){
            const u=Math.max(0,s/shoulder),u2=u*u,u3=u2*u;
            const h00=2*u3-3*u2+1,h10=u3-2*u2+u;
            const d00=(6*u2-6*u)/shoulder,d10=3*u2-4*u+1;
            x-=left.dx*h00+(left.vx-left.velocity.x)*shoulder*h10;
            xMinus-=left.dx*h00+(left.vx-left.velocity.x)*shoulder*h10;
            y-=left.dy*h00+(left.vy-left.velocity.y)*shoulder*h10;
            yMinus-=left.dy*h00+(left.vy-left.velocity.y)*shoulder*h10;
            const cx=left.dx*d00+(left.vx-left.velocity.x)*d10;
            const cy=left.dy*d00+(left.vy-left.velocity.y)*d10;
            vxPlus-=cx;vyPlus-=cy;vxMinus-=cx;vyMinus-=cy;
        }
        if(shoulder>0 && s>length-shoulder){
            const u=Math.min(1,(s-(length-shoulder))/shoulder),u2=u*u,u3=u2*u;
            const h01=-2*u3+3*u2,h11=u3-u2;
            const d01=(-6*u2+6*u)/shoulder,d11=3*u2-2*u;
            x-=right.dx*h01+(right.vx-right.velocity.x)*shoulder*h11;
            xMinus-=right.dx*h01+(right.vx-right.velocity.x)*shoulder*h11;
            y-=right.dy*h01+(right.vy-right.velocity.y)*shoulder*h11;
            yMinus-=right.dy*h01+(right.vy-right.velocity.y)*shoulder*h11;
            const cx=right.dx*d01+(right.vx-right.velocity.x)*d11;
            const cy=right.dy*d01+(right.vy-right.velocity.y)*d11;
            vxPlus-=cx;vyPlus-=cy;vxMinus-=cx;vyMinus-=cy;
        }
        return {x,y,xMinus,yMinus,vxPlus,vyPlus,vxMinus,vyMinus};
    };
    let previous=valuePair(times[0]);
    ctx.moveTo(previous.x,previous.y);
    for(let i=1;i<times.length;i++){
        const a=times[i-1],b=times[i];
        if(b-a<=knotTol)continue;
        const current=valuePair(b),h=(b-a)/3;
        ctx.bezierCurveTo(previous.x+previous.vxPlus*h,previous.y+previous.vyPlus*h,
            current.xMinus-current.vxMinus*h,current.yMinus-current.vyMinus*h,current.xMinus,current.yMinus);
        previous=current;
    }
    if(closed)ctx.closePath();
    return true;
}
