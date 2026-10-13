

window.__spiroRegisterModule?.('js/geometry/spline');

        function centripetalSplineBezierControls(p0, p1, p2, p3, tension = 0.5) {
            const q0={x:Number(p0?.x)||0,y:Number(p0?.y)||0};
            const q1={x:Number(p1?.x)||0,y:Number(p1?.y)||0};
            const q2={x:Number(p2?.x)||0,y:Number(p2?.y)||0};
            const q3={x:Number(p3?.x)||0,y:Number(p3?.y)||0};
            const dt=(a,b)=>Math.max(1e-5,Math.sqrt(Math.max(1e-10,Math.hypot(b.x-a.x,b.y-a.y))));
            const d01=dt(q0,q1), d12=dt(q1,q2), d23=dt(q2,q3);
            const d02=d01+d12, d13=d12+d23;
            const tangentScale=Math.max(0,Math.min(2,(Number(tension)||0)/0.5));
            const m1x=d12*((q1.x-q0.x)/d01-(q2.x-q0.x)/d02+(q2.x-q1.x)/d12)*tangentScale;
            const m1y=d12*((q1.y-q0.y)/d01-(q2.y-q0.y)/d02+(q2.y-q1.y)/d12)*tangentScale;
            const m2x=d12*((q2.x-q1.x)/d12-(q3.x-q1.x)/d13+(q3.x-q2.x)/d23)*tangentScale;
            const m2y=d12*((q2.y-q1.y)/d12-(q3.y-q1.y)/d13+(q3.y-q2.y)/d23)*tangentScale;
            let c1={x:q1.x+m1x/3,y:q1.y+m1y/3};
            let c2={x:q2.x-m2x/3,y:q2.y-m2y/3};

            const chord=Math.max(1e-9,Math.hypot(q2.x-q1.x,q2.y-q1.y));
            const maxHandle=chord*1.25;
            const clampHandle=(anchor,c)=>{
                const dx=c.x-anchor.x,dy=c.y-anchor.y,len=Math.hypot(dx,dy);
                return len>maxHandle?{x:anchor.x+dx*maxHandle/len,y:anchor.y+dy*maxHandle/len}:c;
            };
            c1=clampHandle(q1,c1);c2=clampHandle(q2,c2);
            return {c1,c2};
        }

        function cubicBezierPoint(p0,c1,c2,p3,t){
            const u=1-t,u2=u*u,t2=t*t;
            return {
                x:u2*u*p0.x+3*u2*t*c1.x+3*u*t2*c2.x+t2*t*p3.x,
                y:u2*u*p0.y+3*u2*t*c1.y+3*u*t2*c2.y+t2*t*p3.y
            };
        }

        function getCardinalSplinePoints(points, tension = 0.5, numOfSegments = 25) {
            const src=Array.isArray(points)?points.filter(Boolean).map(p=>({x:Number(p.x)||0,y:Number(p.y)||0})):[];
            if(src.length<2)return src;
            const segCount=Math.max(1,Math.round(Number(numOfSegments)||1));
            const res=[];
            for(let i=0;i<src.length-1;i++){
                const p1=src[i],p2=src[i+1];

                const p0=i>0?src[i-1]:{x:2*p1.x-p2.x,y:2*p1.y-p2.y};
                const p3=i+2<src.length?src[i+2]:{x:2*p2.x-p1.x,y:2*p2.y-p1.y};
                const {c1,c2}=centripetalSplineBezierControls(p0,p1,p2,p3,tension);
                for(let j=0;j<=segCount;j++){
                    if(i>0&&j===0)continue;
                    res.push(cubicBezierPoint(p1,c1,c2,p2,j/segCount));
                }
            }
            if(res.length){res[0]={...src[0]};res[res.length-1]={...src[src.length-1]};}
            return res;
        }

        function ramerDouglasPeucker(points, epsilon) {
            if (points.length <= 2) return points;
            let dmax = 0;
            let index = 0;
            const end = points.length - 1;

            for (let i = 1; i < end; i++) {
                const d = perpendicularDistance(points[i], points[0], points[end]);
                if (d > dmax) {
                    index = i;
                    dmax = d;
                }
            }

            if (dmax > epsilon) {
                const recResults1 = ramerDouglasPeucker(points.slice(0, index + 1), epsilon);
                const recResults2 = ramerDouglasPeucker(points.slice(index), epsilon);
                return recResults1.slice(0, recResults1.length - 1).concat(recResults2);
            } else {
                return [points[0], points[end]];
            }
        }

        function perpendicularDistance(p, a, b) {
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
            const num = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x);
            const den = Math.hypot(dx, dy);
            return num / den;
        }

        function findClosestPointOnPath(samplePoints, targetPt) {
            let minDist = Infinity;
            let closestPt = { x: targetPt.x, y: targetPt.y };
            let insertIdx = 0;

            for (let i = 0; i < samplePoints.length - 1; i++) {
                const p1 = samplePoints[i];
                const p2 = samplePoints[i + 1];
                const proj = projectPointOnSegment(targetPt, p1, p2);
                const dist = Math.hypot(targetPt.x - proj.x, targetPt.y - proj.y);
                if (dist < minDist) {
                    minDist = dist;
                    closestPt = proj;
                    insertIdx = i + 1;
                }
            }
            return { point: closestPt, index: insertIdx, distance: minDist };
        }

        function projectPointOnSegment(p, a, b) {
            const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
            if (l2 === 0) return { ...a };
            let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
            t = Math.max(0, Math.min(1, t));
            return {
                x: a.x + t * (b.x - a.x),
                y: a.y + t * (b.y - a.y)
            };
        }

        let isDraggingNode = false;
        let dragNodeIdx = -1;
        let isFreehandDrawing = false;
        let freehandRawPoints = [];

        let isProfilePanning = false;
        let profilePanStart = { x: 0, y: 0 };

