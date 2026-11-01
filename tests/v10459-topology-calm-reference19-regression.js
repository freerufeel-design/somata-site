'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:100000});
 try{
  const data=await h.evaluate(`(()=>{
   const saved={mode:state.morph.mode,speed:state.morph.speedType,trans:state.morph.profileModeTransition,
    pct:state.morph.profileModeTransitionPercent,fourier:state.fourierMode,progress:runtimeState.morph.progress,
    active:runtimeState.morph.active};
   const realRandom=Math.random;
   const cvs=document.createElement('canvas');cvs.width=540;cvs.height=540;
   const native=cvs.getContext('2d');let calls=[];
   const recorded=new Set(['beginPath','moveTo','lineTo','bezierCurveTo','quadraticCurveTo','closePath','stroke','fill','arc']);
   const ctx=new Proxy(native,{get(target,key){const x=target[key];if(typeof x!=='function')return x;
     return (...args)=>{if(recorded.has(key))calls.push(String(key)+':'+args.map(v=>typeof v==='number'?v.toFixed(6):String(v)).join(','));return x.apply(target,args);};},
     set(target,key,val){return Reflect.set(target,key,val,target);}});
   const p=[{x:0,y:0},{x:1,y:.2},{x:1.5,y:-.4},{x:0.3,y:-1},{x:-.9,y:.3},{x:-.5,y:1.3}];
   const q=[{x:.1,y:-.1},{x:1.1,y:-.4},{x:1.8,y:.5},{x:.9,y:1.2},{x:-1,y:.5},{x:-.8,y:-1.3}];
   const hash=v=>{let h=2166136261;for(let i=0;i<v.length;i++)h=Math.imul(h^v.charCodeAt(i),16777619);return(h>>>0).toString(16)};
   const results=[];
   const mk=(nodes,mode,round,render)=>({profileMode:mode,profileNodes:nodes,rounding:round,
     splineRenderMode:render,wholeCurveSpline:true,N:6,K:1,radius:180,rotation:0,
     fill:false,spiralEnabled:false,closedLoop:true,visible:true,opacity:100});
   const paths=ns=>[{closed:true,points:ns.map(p=>({x:p.x*95,y:p.y*95})),cornerFlags:[false,true,false,true,false,false],bridgeRoundFlags:ns.map(()=>false)}];
   try{
    Math.random=()=>.425;state.fourierMode=false;state.morph.speedType='linear';state.morph.profileModeTransition='phase';
    state.morph.profileModeTransitionPercent=65;runtimeState.morph.active=true;runtimeState.morph.progress=.21;
    for(const mode of ['topology','calm'])for(const dirs of [['segments','segments'],['segments','spline'],['spline','segments'],['spline','spline']])
     for(const render of ['smooth','discrete'])for(const round of [0,55,120])for(const t of [0,.01,.22,.5,.77,1]){
     state.morph.mode=mode;
     const a=mk(p,dirs[0],round,render),b=mk(q,dirs[1],round,render),ap=paths(p),bp=paths(q);
     calls=[];drawMorphGeometry(ctx,b,ap,bp,t,1,false,dirs[0],dirs[1]);
     results.push({mode,dirs:dirs.join('-'),render,round,t,trace:hash(calls.join('|')),size:calls.length,
       clock:profileModeTransitionProgress(t)});
    }
   }finally{Math.random=realRandom;state.morph.mode=saved.mode;state.morph.speedType=saved.speed;
     state.morph.profileModeTransition=saved.trans;state.morph.profileModeTransitionPercent=saved.pct;
     state.fourierMode=saved.fourier;runtimeState.morph.active=saved.active;runtimeState.morph.progress=saved.progress;}
   return results;
  })()`,{timeoutMs:100000,label:'legacy topology and calm reference'});
  if(uncaughtExceptions(h.events).length)throw Error(JSON.stringify(uncaughtExceptions(h.events)));
  if(!Array.isArray(data)||data.length!==288)throw Error('unexpected probe length '+data?.length);
  const digest=crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  const expected='cce9ed331f29f5d2194d16b07d371d5c2618369b7af16c6311d843c391051001';
  if(digest!==expected)throw Error('Mismatch with reference Somata 10.4.19.4: '+digest);
  console.log('PASS v10459: 288 topology/calm morphology traces exactly match Somata 10.4.19.4');
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
