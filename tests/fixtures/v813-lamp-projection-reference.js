// Frozen mathematical reference from unmodified Somata 8.13.0. Test-only.
        function referenceNearestLampFractionOnPathStable(anchor,path,referenceFraction) {
            const pts=path?.points||[];
            if(pts.length<2 || !Number.isFinite(Number(referenceFraction))) return nearestLampFractionOnPath(anchor,path);
            const table=lampPathTable(path);
            if(table.total<=1e-8) return nearestLampFractionOnPath(anchor,path);
            const ax=Number(anchor?.x)||0, ay=Number(anchor?.y)||0;
            let ref=Number(referenceFraction)||0;
            ref=path?.closed?((ref%1)+1)%1:Math.max(0,Math.min(1,ref));
            let bestScore=Infinity,bestDistance=0,bestPoint={x:pts[0].x,y:pts[0].y};

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

        function referenceNearestLampFractionOnPathSegmentBound(anchor,path,referenceFraction,windowFraction=.1) {
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
            if(!bestPoint)return referenceNearestLampFractionOnPathStable(anchor,path,ref);
            return {fraction:Math.max(0,Math.min(1,bestDistance/table.total)),point:bestPoint};
        }

