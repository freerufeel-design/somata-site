'use strict';const {createBrowserHarness}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:130,evalTimeoutMs:35000});try{const data=await h.evaluate(`(()=>{
const mk=(i)=>{const l=createLayer('profile'+i);Object.assign(l,{spiralEnabled:true,spiralOrder:3,profileMode:'spline',N:18,K:5,spiralStep:2.75,spiralStepLinked:false,rounding:145,rotation:17*i,radius:175+i*11,profileNodes:[{x:0,y:0},{x:.14,y:.42},{x:.37,y:-.31},{x:.68,y:.36},{x:1,y:0}]});return l;};
const layers=Array.from({length:15},(_,i)=>mk(i)),out=[];
for(let j=0;j<5;j++){const t=performance.now();for(const l of layers){const p=__spiroPrepareSpiralCarrierProfile(l,{profileNodes:l.profileNodes,roundingFrac:1.45});if(!p?.profilePts?.length)throw Error('empty');}out.push(performance.now()-t);}
return{rounds:out,stats:__spiroSpiralCarrierProfilePrepStatus()};})()`,{timeoutMs:35000});console.log('PROFILE_BENCH '+JSON.stringify(data));}finally{await h.close();}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
