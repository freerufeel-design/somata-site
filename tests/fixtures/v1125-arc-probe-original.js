// Exact 11.0.25 corner-probe implementation for regression comparisons.
function originalLiveMorphCornerFlags(points, closed, cornerFlags=[], bridgeRoundFlags=[], filletLayer=null) {
            const n=points?.length||0;
            if(n<3)return cornerFlags||[];
            const source=Array.isArray(cornerFlags)?cornerFlags:[];
            let result=null;
            // A fixed distance threshold for selecting the first distinct
            // neighbour made newborn Morph edges change their tangent in a
            // single frame. Probe a short, *continuous arc distance* on each
            // side instead: passing a rail vertex changes the probe point
            // continuously, even when a micro-profile grows through zero.
            // The scale comes from the original polygon, not from its newly
            // subdivided mini-edges. No Morph anchors are moved or reindexed.
            let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
            const edgeCount=closed?n:n-1,stations=[0];
            for(let i=0;i<n;i++){
                const p=points[i];
                if(Number.isFinite(p?.x)&&Number.isFinite(p?.y)){
                    minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);
                    maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);
                }
                if(i<edgeCount){
                    const q=points[(i+1)%n];
                    stations.push(stations[i]+(p&&q?Math.hypot(q.x-p.x,q.y-p.y):0));
                }
            }
            const total=stations[edgeCount];
            const baseRadius=Number(filletLayer?.radius)*Number(filletLayer?.radiusMultiplier??1);
            const sides=Math.round(Number(filletLayer?.N));
            const baseEdge=Number.isFinite(baseRadius)&&baseRadius>0&&sides>=3
                ? 2*baseRadius*Math.sin(Math.PI/sides) : Math.hypot(maxX-minX,maxY-minY);
            const probeLength=Math.max(1e-8,Math.min(.04*baseEdge,.15*total));
            // Arc-length lookups keep this O(n log n), even if thousands of
            // almost coincident points are born together in a spiral.
            // Position is continuous when a probe crosses a rail vertex.
            const probe=(index,step)=>{
                if(!(total>1e-12))return null;
                let target=stations[index]+step*probeLength;
                if(closed)target=((target%total)+total)%total;
                else target=Math.max(0,Math.min(total,target));
                let lo=0,hi=edgeCount;
                while(lo<hi){const m=(lo+hi)>>1;if(stations[m]<target)lo=m+1;else hi=m;}
                const j=Math.min(edgeCount-1,Math.max(0,lo-1));
                const a=points[j],b=points[(j+1)%n];
                if(!a||!b)return null;
                const span=stations[j+1]-stations[j];
                const u=span>1e-14?Math.max(0,Math.min(1,(target-stations[j])/span)):0;
                return {x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u};
            };
            const onset=15*Math.PI/180, full=30*Math.PI/180;
            const first=closed?0:1,last=closed?n:n-1;
            for(let i=first;i<last;i++){
                if(source[i]===true||bridgeRoundFlags?.[i]===false)continue;
                const p=points[i];
                if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;
                const before=probe(i,-1),after=probe(i,1);
                if(!before||!after)continue;
                const ax=p.x-before.x,ay=p.y-before.y;
                const bx=after.x-p.x,by=after.y-p.y;
                const al=Math.hypot(ax,ay),bl=Math.hypot(bx,by);
                if(al*bl>1e-16){
                    const angle=Math.atan2(Math.abs(ax*by-ay*bx),ax*bx+ay*by);
                    const u=Math.max(0,Math.min(1,(angle-onset)/(full-onset)));
                    if(u>0){
                        if(!result){result=Array.from({length:n},(_,j)=>source[j]===true?true:
                            (typeof source[j]==='number'&&Number.isFinite(source[j])?source[j]:false));}
                        result[i]=Math.max(Number(result[i])||0,u*u*(3-2*u));
                    }
                }
            }
            return result||source;
        }
module.exports=originalLiveMorphCornerFlags;
