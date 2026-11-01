'use strict';
// Compare the logged fingerprints with untouched Somata 10.4.19.29.
// No direct dependence on a previous ZIP at runtime.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:140,evalTimeoutMs:85000});
 try{
  const v=await h.evaluate(`(()=>{
    const original={mode:state.morph.mode,speed:state.morph.speedType,fourier:state.fourierMode,
     transition:state.morph.profileModeTransition,pct:state.morph.profileModeTransitionPercent};
    const modes=['topology','calm','fade','light'];
    const P=[{x:0,y:0},{x:.22,y:.3},{x:.47,y:-.22},{x:.72,y:.2},{x:1,y:0}];
    const Q=[{x:0,y:0},{x:.2,y:-.31},{x:.49,y:.3},{x:.7,y:-.25},{x:1,y:0}];
    const results={};
    try{
     state.fourierMode=false;state.morph.speedType='linear';
     state.morph.profileModeTransition='phase';state.morph.profileModeTransitionPercent=100;
     for(const morphMode of modes){state.morph.mode=morphMode;const all=[];
      for(const mm of [['segments','segments'],['segments','spline'],['spline','segments']])
       for(const rounding of [0,55,120])for(const movement of ['angular','linear'])
       for(const t of [0,.2,.57,1]){
        const a=createLayer('ref-a'),b=createLayer('ref-b');
        Object.assign(a,{N:7,K:2,radius:150,rotation:11,rounding,fill:false,
         closedLoop:true,spiralEnabled:false,profileMode:mm[0],profileNodes:P.map(p=>({...p}))});
        Object.assign(b,{N:9,K:3,radius:135,rotation:37,rounding,fill:false,
         closedLoop:true,spiralEnabled:false,profileMode:mm[1],profileNodes:Q.map(p=>({...p}))});
        const coords=[];const stack=[];
        const ctx={globalAlpha:1,__suppressStroke:true,__suppressFill:true,
         save(){stack.push(this.globalAlpha);},restore(){this.globalAlpha=stack.pop();},
         beginPath(){},moveTo(x,y){coords.push(x,y);},lineTo(x,y){coords.push(x,y);},
         bezierCurveTo(...xy){coords.push(...xy);},quadraticCurveTo(...xy){coords.push(...xy);},
         closePath(){},stroke(){},fill(){}};
        drawAngularAnchorMorph(ctx,b,a,b,t,1,'phase',movement);
        let hash=2166136261;for(const n of coords){const s=Number(n).toFixed(5);
         for(let i=0;i<s.length;i++)hash=Math.imul(hash^s.charCodeAt(i),16777619)>>>0;
         hash=Math.imul(hash^59,16777619)>>>0;
        }
        all.push(String(hash>>>0)+':'+coords.length);
       }
      let hash=2166136261;for(const v of all.join('|'))hash=Math.imul(hash^v.charCodeAt(0),16777619)>>>0;
      results[morphMode]={cases:all.length,signature:String(hash>>>0),clock:mixedProfileGeometryClock(.25,'segments','spline'),samples:all.slice(0,3)};
     }
    }finally{state.morph.mode=original.mode;state.morph.speedType=original.speed;
     state.fourierMode=original.fourier;state.morph.profileModeTransition=original.transition;
     state.morph.profileModeTransitionPercent=original.pct;}
    return results;
   })()`,{timeoutMs:85000,label:'Compare 10.4.19.29 legacy path fingerprints'});
  for(const mode of ['topology','calm','fade','light']){
   assert.equal(v[mode].cases,72);
   assert.equal(v[mode].signature,"2672024027","morph command sequence deviated from 10.4.19.29 in "+mode);
   assert(Math.abs(v[mode].clock-.15625)<1e-9);
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10419.32: four 10.4.19.29 legacy modes × 72 geometry cases match untouched Somata 10.4.19.29; fingerprints '+JSON.stringify(Object.fromEntries(Object.entries(v).map(([k,r])=>[k,r.signature]))));
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL old-mode signatures',err.stack||err);process.exitCode=1;});
