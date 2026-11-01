'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:100000});
 try{
  const result=await h.evaluate(`(()=>{
   const old={mode:state.morph.mode,speed:state.morph.speedType,profileModeTransition:state.morph.profileModeTransition,
    percent:state.morph.profileModeTransitionPercent,fourier:state.fourierMode};
   const out=[];
   const P=[{x:0,y:0},{x:.17,y:.31},{x:.52,y:-.33},{x:.82,y:.22},{x:1,y:0}];
   const Q=[{x:0,y:.11},{x:.23,y:-.22},{x:.49,y:.38},{x:.77,y:-.19},{x:1,y:-.05}];
   const R=[{x:0,y:0},{x:.2,y:.27},{x:.55,y:-.35},{x:.75,y:.26},{x:1,y:0}];
   const c=document.createElement('canvas');c.width=550;c.height=550;const native=c.getContext('2d');
   let cmds=[];
   const recordCalls=new Set(['beginPath','moveTo','lineTo','bezierCurveTo','quadraticCurveTo','arc','ellipse','closePath','stroke','fill','rect']);
   const ctx=new Proxy(native,{get(target,p){const v=target[p]; if(typeof v!=='function')return v;
    return (...args)=>{if(recordCalls.has(p))cmds.push(p+':'+args.map(n=>typeof n==='number'?(Math.round(n*1e5)/1e5):String(n)).join(','));return v.apply(target,args);};},set(target,p,v){return Reflect.set(target,p,v,target);}});
   const hash=ss=>{let h=2166136261;for(let i=0;i<ss.length;i++)h=Math.imul(h^ss.charCodeAt(i),16777619);return(h>>>0).toString(16).padStart(8,'0');};
   const mk=(id,m,n,k,round,nodes)=>{const l=createLayer(id);Object.assign(l,{N:n,K:k,
    radius:185,rotation:0,rounding:round,opacity:100,closedLoop:true,fill:false,
    profileMode:m,wholeCurveSpline:false,profileNodes:nodes.map(p=>({...p})),
    spiralEnabled:false,chaosStar:false});return l;};
   try{
    state.morph.mode='circleSlide';state.fourierMode=false;state.morph.speedType='linear';
    state.morph.profileModeTransition='phase';state.morph.profileModeTransitionPercent=70;
    for(const dir of [['segments','spline'],['spline','segments'],['spline','spline'],['segments','segments']])
     for(const changeNK of [false,true])for(const movement of ['angular','linear'])
      for(const round of [0,55,120]){
       const a=mk('a',dir[0],7,2,round,P),b=mk('b',dir[1],changeNK?10:7,changeNK?3:2,round,Q);
       for(const t of [0,.001,.05,.2,.5,.8,.999,1]){
        cmds=[];drawAngularAnchorMorph(ctx,b,a,b,t,1,'phase',movement);
        const txt=cmds.join('|');out.push({dir:dir.join('-'),changeNK,movement,round,t,h:hash(txt),count:cmds.length});
       }
      }
   }finally{Object.assign(state.morph,{mode:old.mode,speedType:old.speed,profileModeTransition:old.profileModeTransition,profileModeTransitionPercent:old.percent});state.fourierMode=old.fourier;}
   return out;
  })()`,{label:'Circle Slide trace fingerprint comparison',timeoutMs:100000});
  if(!Array.isArray(result)||result.length!==384)throw Error('bad count '+result?.length);
  const reference=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'fixtures/v10458-circle-27-reference.json'),'utf8'));
  // Original geometry transport and spline/unrounded rendering must remain
  // exactly the 10.4.19.27 reference. Only rounded segment rendering can vary.
  const isFillet=row=>row.dir==='segments-segments'&&row.round>0;
  const oldRows=result.filter(row=>!isFillet(row));
  const mismatch=result.filter((row,i)=>!isFillet(row)&&
    (row.h!==reference[i]?.h||row.count!==reference[i]?.count));
  if(mismatch.length)throw Error(`unchanged Circle Slide geometry differs from 10.4.19.27 ${mismatch.length}: ${JSON.stringify(mismatch.slice(0,3))}`);
  const changed=result.filter(isFillet);
  const roundedHash=crypto.createHash('sha256').update(JSON.stringify(changed)).digest('hex');
  if(process.env.SOMATA_RECORD_ROUND==='1')console.log('REFERENCE ROUND',roundedHash);
  else if(roundedHash!=='67b215cd6bcb047960b7cc3f2e6bcf9ecbca2760d06226fb292f2c7b377a7c49')throw Error('fillet-only path changed: '+roundedHash);
  if(oldRows.length!==320||changed.length!==64)throw Error('bad reference partition');
  console.log('PASS v10458 Circle Slide: 320 unchanged reference traces + 64 fillet-only traces');
  if(uncaughtExceptions(h.events).length)throw Error('browser exceptions: '+uncaughtExceptions(h.events).join(' | '));
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL circle probe',err.stack||err);process.exitCode=1;});
