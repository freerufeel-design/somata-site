'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:90000});
 try{
  const rows=await h.evaluate(`(()=>{
   const results=[];
   const cross=(a,b,p)=>(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
   const inTri=(p,a,b,v)=>{
    const sign=Math.sign(cross(a,b,v));
    return sign===0||[cross(a,b,p),cross(b,v,p),cross(v,a,p)].every(x=>x*sign>=-1e-5);
   };
   const evalCase=(a,b,vertex,fromTang,toTang,cut)=>{
    const out=[];
    for(const seam of [0,0.32,1]){
     const cmds=[];
     const ctx={lineTo(x,y){cmds.push(['L',x,y]);},bezierCurveTo(...v){cmds.push(['C',...v]);}};
     appendLocalSplineFillet(ctx,{point:a,tangent:fromTang},{point:b,tangent:toTang},cut,seam,vertex);
     const cmd=cmds[0];
     if(cmd[0]==='C'){
      const c1={x:cmd[1],y:cmd[2]},c2={x:cmd[3],y:cmd[4]};
      for(const p of [c1,c2])if(!inTri(p,a,b,vertex))throw Error('fillet escaped source triangle '+JSON.stringify({a,b,vertex,p,cmd}));
      for(let i=0;i<=100;i++){
       const t=i/100,u=1-t;
       const p={x:u*u*u*a.x+3*u*u*t*c1.x+3*u*t*t*c2.x+t*t*t*b.x,
        y:u*u*u*a.y+3*u*u*t*c1.y+3*u*t*t*c2.y+t*t*t*b.y};
       if(!inTri(p,a,b,vertex))throw Error('rendered cubic ear '+JSON.stringify({a,b,vertex,p}));
      }
     }
     out.push(cmd);
    }
    if(JSON.stringify(out[0])!==JSON.stringify(out[1])||JSON.stringify(out[1])!==JSON.stringify(out[2]))
     throw Error('Static and Morph have separate fillet tangent rules');
    return out[0][0];
   };
   for(let ang=12;ang<=175;ang+=7)for(const twist of [-2,-1,0,1,2]){
    const angle=ang*Math.PI/180;
    const a={x:-42,y:0},vertex={x:0,y:0},b={x:42*Math.cos(angle),y:42*Math.sin(angle)};
    const from={x:Math.cos(twist),y:Math.sin(twist)};
    const to={x:Math.cos(angle+twist),y:Math.sin(angle+twist)};
    results.push(evalCase(a,b,vertex,from,to,23));
   }
   // Sweep a tangent continuously across both sides of the allowed wedge.
   // A discrete fallback to another control direction makes a visibly abrupt
   // phase pop despite identical anchor transport.
   let prev=null,maxControlMotion=0;
   for(let deg=-180;deg<=180;deg+=0.5){
    const ang=deg*Math.PI/180,rec=[];
    appendLocalSplineFillet({lineTo(){},bezierCurveTo(...v){rec.push(v);}},
     {point:{x:-40,y:0},tangent:{x:Math.cos(ang),y:Math.sin(ang)}},
     {point:{x:0,y:40},tangent:{x:0,y:1}},28,1,{x:0,y:0});
    const now=rec[0];if(!now)throw Error('fillet vanished while sweeping tangent');
    if(prev)maxControlMotion=Math.max(maxControlMotion,
     Math.hypot(now[0]-prev[0],now[1]-prev[1]));
    prev=now;
   }
   if(maxControlMotion>0.45)throw Error('bounded fillet control jumps during live Morph: '+maxControlMotion);
   // A real screenshot-like star, the 10th standard profile in Spline mode.
   // Inspect both the ordinary static geometry and animated rendering of the
   // SAME authored shape: no animated shoulder should choose a different
   // formula when vertex motion is zero.
   const p10=[[0,0],[.33,.4],[.33,0],[.66,.4],[.66,0],[1,0]].map(([x,y])=>({x,y}));
   const cases=[],savedMode=state.morph.mode;
   try{for(const mode of ['circleSlide','topology','calm']){
    state.morph.mode=mode;
    for(const [N,K] of [[8,1],[8,2],[8,3],[10,3],[12,5]]){
     const layer=createLayer('no ears');Object.assign(layer,{N,K,radius:270,rotation:440.1,rounding:72,
      profileMode:'spline',splineRenderMode:'smooth',profileNodes:p10,closedLoop:true,fill:false});
     const paths=buildOrbitPolylines(layer);
     const all=[];
     for(const path of paths){
      const make=()=>{const cmds=[];const c={save(){},restore(){},beginPath(){},stroke(){},fill(){},scale(){},
       moveTo(...v){cmds.push(['M',...v]);},lineTo(...v){cmds.push(['L',...v]);},
       quadraticCurveTo(...v){cmds.push(['Q',...v]);},bezierCurveTo(...v){cmds.push(['C',...v]);},closePath(){cmds.push(['Z']);}};return{c,cmds};};
      const staticCtx=make();splinePathForDraw(staticCtx.c,path.points,path.closed,.72,path.cornerFlags,path.bridgeRoundFlags,false);
      const morphCtx=make();drawMorphPathQuality(morphCtx.c,path.points,path.closed,.72,'spline',1,false,'smooth',path.cornerFlags,path.bridgeRoundFlags,false,1,false);
      const a=JSON.stringify(staticCtx.cmds),b=JSON.stringify(morphCtx.cmds);
      if(a!==b)throw Error('different static/morph fillet at same geometry '+mode+' N'+N+' K'+K);
      if(!staticCtx.cmds.some(c=>c[0]==='C'))throw Error('spline corners lost all curves');
      if(!staticCtx.cmds.every(c=>c.slice(1).every(Number.isFinite)))throw Error('nonfinite fillet');
      all.push(staticCtx.cmds.length);
     }
     cases.push({mode,N,K,paths:paths.length,commands:all.reduce((x,y)=>x+y,0)});
    }
   }}finally{state.morph.mode=savedMode;}
   // Prior hairpin "caps" used to draw two offset cubics in the absence of
   // any authored side lobe. The safe join must be a quadratic in its wedge.
   const cap=[];const ctx={moveTo(){},lineTo(){cap.push('L');},quadraticCurveTo(){cap.push('Q');},bezierCurveTo(){cap.push('C');},closePath(){}};
   roundPolylineForDraw(ctx,[{x:-100,y:0},{x:0,y:0},{x:-100,y:9}],false,.82,[false,true,false]);
   if(cap.includes('C'))throw Error('U-cap reintroduced artificial sideways ear');
   return {cubicFixtures:results.length,cases,cap,maxControlMotion};
  })()`,{timeoutMs:85000,label:'bounded spline fillet and screenshot preset geometric sweep'});
  assert.equal(rows.cubicFixtures,120);
  assert.equal(rows.cases.length,15);
  assert(!rows.cap.includes('C'));
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 11.0.4:',rows.cubicFixtures,'bounded cubic fixtures and',rows.cases.length,'real 10th-standard-profile static/dynamic geometries; no artificial 180-degree ears');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL bounded rounding',e.stack||e);process.exitCode=1});
