'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:35,evalTimeoutMs:25000});
 try{
 const out=await h.evaluate(`(()=>{
 const makeRecorder=()=>{const cmds=[];const ctx={globalAlpha:1,lineWidth:1,save(){},restore(){},beginPath(){},stroke(){},fill(){},scale(){},moveTo(...v){cmds.push(['M',...v]);},lineTo(...v){cmds.push(['L',...v]);},quadraticCurveTo(...v){cmds.push(['Q',...v]);},bezierCurveTo(...v){cmds.push(['C',...v]);},closePath(){cmds.push(['Z']);}};return {ctx,cmds};};
 const sample=(cmds)=>{const pts=[];let current=null;
  for(const c of cmds){if(c[0]==='M'){current={x:c[1],y:c[2]};pts.push(current);continue;}
   if(!current)continue;
   let p;if(c[0]==='L')p={x:c[1],y:c[2]};else if(c[0]==='Q')p={x:c[3],y:c[4]};else if(c[0]==='C')p={x:c[5],y:c[6]};else continue;
   const a=current;
   for(let j=1;j<=80;j++){const t=j/80,u=1-t;let x,y;
    if(c[0]==='L'){x=a.x+(p.x-a.x)*t;y=a.y+(p.y-a.y)*t;}
    else if(c[0]==='Q'){x=u*u*a.x+2*u*t*c[1]+t*t*p.x;y=u*u*a.y+2*u*t*c[2]+t*t*p.y;}
    else {x=u*u*u*a.x+3*u*u*t*c[1]+3*u*t*t*c[3]+t*t*t*p.x;y=u*u*u*a.y+3*u*u*t*c[2]+3*u*t*t*c[4]+t*t*t*p.y;}
    pts.push({x,y});
   }current=p;
  }
  let max=0,nonzero=0;
  for(let i=2;i<pts.length;i++){const a=[pts[i-1].x-pts[i-2].x,pts[i-1].y-pts[i-2].y];const b=[pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y];const la=Math.hypot(...a),lb=Math.hypot(...b);if(la<1e-8||lb<1e-8)continue;max=Math.max(max,Math.acos(Math.max(-1,Math.min(1,(a[0]*b[0]+a[1]*b[1])/la/lb)))*180/Math.PI);nonzero++;}
  return {max,nonzero,length:pts.length};
 };
 const pts=[{x:-100,y:0},{x:0,y:0},{x:-100,y:0}];
 const test=(fn)=>{const {ctx,cmds}=makeRecorder();fn(ctx);return {commands:cmds.map(c=>c[0]).join(''),...sample(cmds),finite:cmds.every(c=>c.slice(1).every(Number.isFinite))};};
 const direct=test(ctx=>roundPolylineForDraw(ctx,pts,false,.59,[false,true,false]));
 const live=test(ctx=>drawMorphPathQuality(ctx,pts,false,.59,'segments',0,false,'smooth',[],[],false,0,true));
 const layer=createLayer('transient hairpin');Object.assign(layer,{rounding:59,roundingMode:'standard',profileMode:'segments',fill:false});
 const stable=test(ctx=>drawPreparedMorphGeometry(ctx,layer,[{points:pts,closed:false,cornerFlags:[],bridgeRoundFlags:[],_stableRoundedSplineRail:true}],.5,1,'segments','segments'));
 const zero=test(ctx=>drawMorphPathQuality(ctx,pts,false,0,'segments',0,false,'smooth',[],[],false,0,true));
 const blocked=test(ctx=>drawMorphPathQuality(ctx,pts,false,.59,'segments',0,false,'smooth',[],[null,false,null],false,0,true));
 // Lost endpoint corner maps must not turn a live topology Morph into a
 // sharp raw rail.  We test the genuine morph interpolation and draw path.
 const a=[{x:-110,y:0},{x:0,y:0},{x:-100,y:0},{x:30,y:80},{x:-120,y:20}];
 const b=[{x:-120,y:5},{x:15,y:0},{x:-115,y:-5},{x:20,y:100},{x:-100,y:35}];
 const source=[{points:a,closed:false,cornerFlags:[],bridgeRoundFlags:[]}];
 const target=[{points:b,closed:false,cornerFlags:[],bridgeRoundFlags:[]}];
 const originalMode=state.morph.mode;state.morph.mode='topology';
 let recovered=[];
 try {for(const t of [.2,.5,.8]){
  const {ctx,cmds}=makeRecorder();drawMorphGeometry(ctx,layer,source,target,t,1,false,'segments','segments');
  recovered.push({t,commands:cmds.map(c=>c[0]).join(''),finite:cmds.every(c=>c.slice(1).every(Number.isFinite))});
 }}finally{state.morph.mode=originalMode;}
 return {direct,live,stable,zero,blocked,recovered};
 })()`,{timeoutMs:21000,label:'hairpin cusp continuity in frame renderers'});
 console.log(JSON.stringify(out));
 for(const k of ['direct','live','stable']){
  assert(out[k].finite&&out[k].commands.includes('C'),k+' should use a smooth two-cubic U-turn: '+JSON.stringify(out[k]));
  assert(out[k].max<35,k+' has an abrupt cusp after rounding: '+JSON.stringify(out[k]));
 }
 assert(out.recovered.every(x=>x.finite&&/[QC]/.test(x.commands)),'transient geometry must regain its corner fillets: '+JSON.stringify(out.recovered));
 assert(!out.zero.commands.includes('C')&&!out.zero.commands.includes('Q'),'rounding=0 must not alter the rail');
 assert(!out.blocked.commands.includes('C')&&!out.blocked.commands.includes('Q'),'explicitly blocked bridge must remain unrounded');
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS live / canonical / already-rounded Morph rails suppress a full reversal cusp while honoring zero and blocked joints');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
