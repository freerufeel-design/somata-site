'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:90000});
 try{
  const result=await h.evaluate(`(()=>{
    const old={mode:state.morph.mode,fourier:state.fourierMode};
    const results=[];let asymmetric=null;
    const record=()=>{
      const paths=[];let current=null,pen=null;
      const rec={__suppressStroke:true,__suppressFill:true,globalAlpha:1,lineWidth:1,
        save(){},restore(){},beginPath(){current=[];paths.push(current);pen=null;},
        moveTo(x,y){pen={x,y};current.push({type:'M',p:{x,y}});},
        lineTo(x,y){pen={x,y};current.push({type:'L',p:{x,y}});},
        quadraticCurveTo(x,y,u,v){current.push({type:'Q',c:{x,y},p:{x:u,y:v}});pen={x:u,y:v};},
        bezierCurveTo(x,y,u,v,w,z){current.push({type:'C',c1:{x,y},c2:{x:u,y:v},p:{x:w,y:z}});pen={x:w,y:z};},
        closePath(){current.push({type:'Z'});},stroke(){},fill(){},scale(){},translate(){},rotate(){}};
      return {rec,paths};
    };
    const seamStats=(paths)=>{
      let count=0,sharp=0,maxAngle=0,points=[];
      for(const path of paths){const curves=[];let last=null;
        for(const op of path){if(op.type==='M'||op.type==='L'){last=op.p;continue;}
          if(op.type==='C'){curves.push({p0:last,c1:op.c1,c2:op.c2,p3:op.p});points.push(op.p);last=op.p;}}
        for(let i=1;i<curves.length;i++){
          const left=curves[i-1],right=curves[i];
          const ax=left.p3.x-left.c2.x,ay=left.p3.y-left.c2.y;
          const bx=right.c1.x-right.p0.x,by=right.c1.y-right.p0.y;
          const al=Math.hypot(ax,ay),bl=Math.hypot(bx,by);
          if(al<1e-8||bl<1e-8)continue;
          const cos=Math.max(-1,Math.min(1,(ax*bx+ay*by)/(al*bl)));
          const deg=Math.acos(cos)*180/Math.PI;
          count++;maxAngle=Math.max(maxAngle,deg);if(deg>30)sharp++;
        }
      }
      return {count,sharp,maxAngle,points};
    };
    try{
      state.fourierMode=false;state.morph.mode='topoCircle';
      for(const [n0,k0,n1,k1] of [[8,3,12,5],[9,2,12,5],[7,2,10,3],[16,4,17,7]]){
        const a=createLayer('horn-a'),b=createLayer('horn-b');
        Object.assign(a,{N:n0,K:k0,radius:220,rounding:72,roundingMode:'monoradius',profileMode:'segments',profileNodes:[{x:0,y:0},{x:1,y:0}],closedLoop:true,spiralEnabled:false,fill:false});
        Object.assign(b,a,{N:n1,K:k1});
        for(const t of [.1,.3,.5,.7,.9]){
          const original=stabilizeMorphCubicSeamTangents;
          const before=record();
          try{stabilizeMorphCubicSeamTangents=()=>{};
            drawExactPolygonSplineProfileMorph(before.rec,b,a,b,t,1,'linear');
          }finally{stabilizeMorphCubicSeamTangents=original;}
          const after=record();drawExactPolygonSplineProfileMorph(after.rec,b,a,b,t,1,'linear');
          const source=seamStats(before.paths),corrected=seamStats(after.paths);
          const match=source.points.length===corrected.points.length&&
            source.points.every((p,i)=>Math.hypot(p.x-corrected.points[i].x,p.y-corrected.points[i].y)<1e-6);
          results.push({n0,k0,n1,k1,t,before:source.sharp,after:corrected.sharp,
            beforeMax:source.maxAngle,afterMax:corrected.maxAngle,match});
        }
      }
      // An asymmetric, near-degenerate edge must not force the longer
      // shoulder of an authored corner to shrink to the tiny edge length.
      const polygon=[{x:0,y:0},{x:100,y:0},{x:100.1,y:0},{x:110,y:100},{x:0,y:100}];
      const marks=polygon.map(()=>true);
      const base=record();base.rec.beginPath();roundPolylineForDraw(base.rec,polygon,true,.8,marks);
      const fixed=record();fixed.rec.beginPath();roundPolylineForDraw(fixed.rec,polygon,true,.8,marks,null,true);
      const seek=path=>path.findIndex(cmd=>cmd.type==='Q'&&Math.hypot(cmd.c.x-100,cmd.c.y)<1e-6);
      const oldIndex=seek(base.paths[0]),newIndex=seek(fixed.paths[0]);
      const left=path=>path[seek(path)-1].p;
      asymmetric={oldIndex,newIndex,oldIn:Math.hypot(left(base.paths[0]).x-100,left(base.paths[0]).y),
        newIn:Math.hypot(left(fixed.paths[0]).x-100,left(fixed.paths[0]).y)};
    }finally{state.morph.mode=old.mode;state.fourierMode=old.fourier;}
    return {results,asymmetric};
  })()`,{label:'real browser - fillet shoulders and cubic seams',timeoutMs:75000});
  assert.equal(result.results.length,20);
  for(const row of result.results){assert(row.match,JSON.stringify(row));assert(row.after<=row.before,JSON.stringify(row));
    assert(row.afterMax<30+1e-6,JSON.stringify(row));}
  assert(result.results.some(r=>r.before>0));
  // Both static and live paths now follow the same global-profile budget.
  // The flag is retained for API compatibility, not a smaller static cut.
  assert(result.asymmetric.oldIn>10,JSON.stringify(result.asymmetric));
  assert(Math.abs(result.asymmetric.newIn-result.asymmetric.oldIn)<1e-6,JSON.stringify(result.asymmetric));
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 20 Topo-Circle live curves: 0 new sharp tangent seams; unchanged interpolated anchor endpoints; 1 near-zero-edge fillet radius preservation. Largest old tangent angle:',Math.round(Math.max(...result.results.map(r=>r.beforeMax))));
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
