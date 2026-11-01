'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:50,evalTimeoutMs:90000});
 try{
  const results=await h.evaluate(`(()=>{
    const mk=()=>{
      const cmds=[];
      const c={save(){},restore(){},beginPath(){},moveTo(x,y){cmds.push(['M',x,y]);},
        lineTo(x,y){cmds.push(['L',x,y]);},
        bezierCurveTo(a,b,c,d,x,y){cmds.push(['C',a,b,c,d,x,y]);},
        quadraticCurveTo(a,b,x,y){cmds.push(['Q',a,b,x,y]);},closePath(){cmds.push(['Z']);}};
      return {c,cmds};
    };
    const oldMode=state.morph.mode,oldFourier=state.fourierMode;
    const out=[];
    try{
      state.fourierMode=false;
      for(const mode of ['topology','calm'])for(const N of [8,11])for(const K of [2,3]){
        if(K>N/2)continue;
        state.morph.mode=mode;
        for(const complex of [false,true]){
          const layer=createLayer('spline regression');
          Object.assign(layer,{N,K,radius:205,rounding:80,roundingMode:'standard',profileMode:'spline',
            profileNodes:complex?[{x:0,y:0},{x:.17,y:.13},{x:.45,y:-.09},{x:.72,y:.18},{x:1,y:0}]:[{x:0,y:0},{x:1,y:0}],
            closedLoop:true,fill:false,spiralEnabled:false});
          const paths=buildOrbitPolylines(layer);
          for(const path of paths){
            const at=[];
            for(const blend of [0,.25,.5,.75,1]){
              const {c,cmds}=mk();drawMorphPathQuality(c,path.points,path.closed,.8,'spline',blend,true,'smooth',path.cornerFlags,path.bridgeRoundFlags,false);
              const all=cmds.filter(cmd=>cmd.length>1).flatMap(cmd=>cmd.slice(1));
              const radius=all.length?Math.max(...Array.from({length:all.length/2},(_,i)=>Math.hypot(all[2*i],all[2*i+1]))):0;
              at.push({blend,cmds,cubics:cmds.filter(x=>x[0]==='C').length,radius,finite:all.every(Number.isFinite)});
            }
            const {c,cmds}=mk();splinePathForDraw(c,path.points,path.closed,.8,path.cornerFlags,path.bridgeRoundFlags,false);
            out.push({mode,N,K,complex,at,staticCommands:cmds});
          }
        }
      }
    }finally{state.morph.mode=oldMode;state.fourierMode=oldFourier;}
    return out;
  })()`,{label:'spline curve continuity in actual Canvas2D engine',timeoutMs:85000});
  assert(results.length>=16);
  let checked=0,shapeEvolves=0;
  for(const r of results){
   for(const at of r.at){
    assert(at.finite,JSON.stringify({mode:r.mode,N:r.N,K:r.K,blend:at.blend}));
    assert(at.cubics>0,JSON.stringify({mode:r.mode,N:r.N,K:r.K,blend:at.blend}));
    assert(at.radius>45,JSON.stringify({mode:r.mode,N:r.N,K:r.K,blend:at.blend,radius:at.radius}));
   }
   const end=r.at[r.at.length-1].cmds;
   assert.deepEqual(end,r.staticCommands,`rounded spline must reach exact Static at blend=1: ${r.mode},${r.N}/${r.K}`);
   if(JSON.stringify(r.at[0].cmds)!==JSON.stringify(r.at[4].cmds))shapeEvolves++;
   checked++;
  }
  assert(shapeEvolves>=8,'non-flat spline handles must still interpolate');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log(`PASS ${checked} browser spline profile paths x 5 blend positions; rounded cubic joins, no collapsed stars, exact spline endpoint, ${shapeEvolves} visibly distinct handle transitions`);
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL',err.stack||err);process.exitCode=1;});
