'use strict';
// Test lives outside the product UI. It checks that rendered frames continue
// changing near phase ends, instead of substituting or holding Static frames.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const root=path.resolve(__dirname,'..');
const geom=fs.readFileSync(path.join(root,'js/geometry/morph.js'),'utf8');
const runtime=fs.readFileSync(path.join(root,'js/app/ui-project-runtime.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert(!geom.includes('canonicalEndpointPair'),'Static overlay is still present');
assert(!geom.includes('const boundaryWidth=0.025'),'Raster endpoint fade is still present');
assert(!runtime.includes('firstVisiblePhaseFramePending'),'First-frame time forcing is still present');
assert(!html.includes('adjacent-phase-visible-frames.js'),'Diagnostic toolbar is loaded');
const source=String.raw`(()=>{
  const oldMode=state.morph.mode,oldFourier=state.fourierMode;
  const base=createLayer('moving-rail-no-hold');
  Object.assign(base,{N:7,K:2,radius:205,rotation:5,rounding:145,
    spiralEnabled:false,spiralOrder:0,profileMode:'spline',fill:false,
    profileNodes:[{x:0,y:0},{x:.3,y:.21},{x:.63,y:-.18},{x:1,y:0}]});
  const target={...base,N:11,K:4,rotation:25,profileNodes:base.profileNodes.map(p=>({...p}))};
  const cvs=document.createElement('canvas');cvs.width=cvs.height=600;
  const native=cvs.getContext('2d');
  const ctx=createGeometryGLRecordingContext(native);
  const phases=[.90,.94,.96,.98,.995,.999,1,0,.005,.02,.04,.08];
  const captures=[];
  function capture(t){
    native.setTransform(1,0,0,1,0,0);native.clearRect(0,0,600,600);
    ctx.__resetForBaseContext(native);ctx.lineWidth=1;ctx.globalAlpha=1;
    ctx.__suppressFill=true;ctx.__suppressStroke=false;
    MorphRendering.drawCircleSlideMorph(ctx,base,base,target,t,1);
    if(ctx.unsupported)throw Error('Unsupported GPU recorder operation');
    ctx.__finishFrame();
    let count=0,sum=0,sumsq=0,signature='';
    for(const cmd of ctx.commands)for(const sp of cmd.subpaths||[])
      for(const p of sp.points||[]){count++;sum+=p.x*.7+p.y*.3;sumsq+=p.x*p.x+p.y*p.y;
        if(count<24)signature+=Math.round(p.x*10000)+','+Math.round(p.y*10000)+';';}
    if(count<100)throw Error('Empty geometry at '+t+': '+count);
    return {t,count,sum,sumsq,signature};
  }
  try{
    state.morph.mode='circleSlide';state.fourierMode=false;
    for(const t of phases)captures.push(capture(t));
    return captures;
  }finally{state.morph.mode=oldMode;state.fourierMode=oldFourier;}
})()`;
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:130,evalTimeoutMs:20000});
  try{
    const frames=await h.evaluate(source,{label:'live GPU recorder, no hidden phase holds'});
    const end=frames.filter(f=>f.t>=.9),begin=frames.filter(f=>f.t<=.08);
    const changes=arr=>arr.slice(1).map((f,i)=>({from:arr[i].t,to:f.t,
      changed:f.signature!==arr[i].signature||Math.abs(f.sum-arr[i].sum)>1e-8||Math.abs(f.sumsq-arr[i].sumsq)>1e-8}));
    const e=changes(end),b=changes(begin);
    assert(e.every(x=>x.changed),'One or more of the ending positions is deliberately held: '+JSON.stringify(e));
    assert(b.every(x=>x.changed),'One or more of the starting positions is deliberately held: '+JSON.stringify(b));
    assert.deepEqual(uncaughtExceptions(h.events),[]);
    console.log('PASS no artificial held GPU geometry in sampled end/start positions',JSON.stringify({end:e,start:b}));
  }finally{await h.close()}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
