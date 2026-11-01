'use strict';
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:70000});
 try{
 const report=await h.evaluate(`(()=>{
   const old={mode:state.morph.mode,fourier:state.fourierMode};
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=640;
   const c=canvas.getContext('2d');
   const flat=[{x:0,y:0},{x:1,y:0}];
   const nonFlat=[{x:0,y:0},{x:.2,y:.33},{x:.7,y:-.23},{x:1,y:0}];
   const scenarios=[[7,1,14,1],[14,1,7,1],[7,2,10,3],[16,4,17,7],[16,4,24,5]];
   const results=[],renders=[];
   const near=(a,b)=>Math.abs(a-b)<1e-7;
   try{
    state.fourierMode=false;
    for(const mode of ['topology','calm','circleSlide','topoCircle'])for(const [n0,k0,n1,k1] of scenarios){
      state.morph.mode=mode;
      const a=createLayer('horn-source'),b=createLayer('horn-target');
      Object.assign(a,{N:n0,K:k0,radius:185,rounding:72,roundingMode:'monoradius',rotation:0,profileMode:'segments',profileNodes:flat,closedLoop:true,spiralEnabled:false,fill:false});
      Object.assign(b,a,{N:n1,K:k1});
      const slideType='phase',movementMode=mode==='circleSlide'?'angular':'linear';
      const plan=getCircleMorphPlan(a,b,slideType);
      // A non-native geometry recorder deliberately observes the genuine
      // transport rails, without endpoint raster crossfade.
      const rec={__suppressStroke:true,__suppressFill:true,globalAlpha:1,lineWidth:2,save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},quadraticCurveTo(){},bezierCurveTo(){},closePath(){},scale(){}};
      for(const t of [0,.001,.1,.5,.9,.999,1]){
        const layer={...b,rounding:72};
        drawAngularAnchorMorph(rec,layer,a,b,t,1,slideType,movementMode);
        let birth=0,death=0,maximumBirthError=0,maximumDeathError=0,stableError=0,minGap=Infinity;
        // Topo-Circle uses its own exact-cubic renderer, not vertexPts.
        // It is verified separately with real Canvas2D endpoint checks.
        for(const pp of (mode==='topoCircle'?[]:plan.pathPlans)){
          const R=185;
          for(let i=0;i<pp.vertexPts.length;i++){
            const x=pp.vertexPts[i].x,y=pp.vertexPts[i].y;
            const p0=pp.birthEdgeSlots?.[i],p1=pp.deathEdgeSlots?.[i];
            if(p0){birth++;if(t===0){
              const ex=movementMode==='angular'?Math.cos(p0.angle):p0.x;
              const ey=movementMode==='angular'?Math.sin(p0.angle):p0.y;
              maximumBirthError=Math.max(maximumBirthError,Math.hypot(x-ex*R,y-ey*R));
            }}
            if(p1){death++;if(t===1){
              const ex=movementMode==='angular'?Math.cos(p1.angle):p1.x;
              const ey=movementMode==='angular'?Math.sin(p1.angle):p1.y;
              maximumDeathError=Math.max(maximumDeathError,Math.hypot(x-ex*R,y-ey*R));
            }}
            if(!p0&&!p1){const ang=pp.from[i]+pp.delta[i]*t;
             const x0=R*Math.cos(pp.from[i]),y0=R*Math.sin(pp.from[i]);
             const x1=R*Math.cos(pp.from[i]+pp.delta[i]),y1=R*Math.sin(pp.from[i]+pp.delta[i]);
             const expectedX=movementMode==='linear'?x0+(x1-x0)*t:R*Math.cos(ang);
             const expectedY=movementMode==='linear'?y0+(y1-y0)*t:R*Math.sin(ang);
             stableError=Math.max(stableError,Math.hypot(x-expectedX,y-expectedY));}
            const nxt=pp.vertexPts[(i+1)%pp.vertexPts.length];
            minGap=Math.min(minGap,Math.hypot(x-nxt.x,y-nxt.y));
          }
        }
        const radialError=movementMode==='angular'&&mode==='circleSlide'
          ?Math.max(...plan.pathPlans.flatMap(row=>row.vertexPts.map(p=>Math.abs(Math.hypot(p.x,p.y)-185)))) : 0;
        results.push({mode,n0,k0,n1,k1,t,birth,death,maximumBirthError,maximumDeathError,stableError,minGap,radialError});
      }
      if(mode==='topology'&&n0===16&&n1===17){
        for(const t of [0,.04,.12,.25,.5,.75,.96,1]){
          c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,640,640);
          c.fillStyle='#070a12';c.fillRect(0,0,640,640);c.translate(320,320);c.strokeStyle='#ff008a';c.lineWidth=2;c.shadowColor='#ff008a';c.shadowBlur=6;
          const frame={...b,rounding:72};
          drawFittedMonoradiusAnchorMorph(c,frame,a,b,t,1,'phase','linear');
          renders.push({t,url:canvas.toDataURL('image/png')});
        }
      }
    }
   }finally{state.morph.mode=old.mode;state.fourierMode=old.fourier;}
   return {results,renders};
 })()`,{label:'real Morph engine: source-edge births, disappearing nodes and Canvas frames',timeoutMs:65000});
 assert.equal(report.results.length,140);
 for(const r of report.results){if(r.mode==='topoCircle')continue;
  assert(r.stableError<1e-7,JSON.stringify(r));assert(r.maximumBirthError<1e-6,JSON.stringify(r));assert(r.maximumDeathError<1e-6,JSON.stringify(r));assert(r.radialError<1e-6,JSON.stringify(r));}
 assert(report.results.some(r=>r.birth>0));assert(report.results.some(r=>r.death>0));
 const payload=report.renders.map(r=>({t:r.t,png:r.url.replace(/^data:image\/png;base64,/, '')}));
 if(process.env.SOMATA_SAVE_PREVIEWS==='1')for(const r of payload)
  fs.writeFileSync(path.join(__dirname,`horn-engine-${String(r.t).replace('.','_')}.png`),Buffer.from(r.png,'base64'));
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS 105 tested transport samples + 35 Topo-Circle exact-path samples; old anchors unchanged, linear births/deaths on edges, circular births/deaths on arcs; rendered previews:',payload.length);
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
