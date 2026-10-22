// 8.15: block pruning must preserve 8.14 Web attachment position and ordering.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const body=fs.readFileSync(path.join(__dirname,'../js/app/lamp-audio-core.js'),'utf8');
const start=body.indexOf('        const webProjectionBlockCache=new WeakMap();');
const end=body.indexOf('        function pointAtWrappedWebDistance(',start);
assert(start>=0&&end>start);
const runtime={active:true,frameId:1};
const fast=vm.runInNewContext(`${body.slice(start,end)};nearestWebDistanceOnTable`,{frameGeometryRuntime:runtime,webDrawScratch:{nearest:{}},WeakMap,Math,Number,Infinity});
// Exact former 8.14 implementation. A regression fixture, not a second production implementation.
function reference(table,x,y,out={}){
 const px=Number(x)||0,py=Number(y)||0,segs=table?.segs||[];
 let bestSq=Infinity,bestDistance=0,bestX=px,bestY=py;
 const prune=segs.length>=48;
 for(const seg of segs){
  const ax=seg.a.x,ay=seg.a.y,bx=seg.b.x,by=seg.b.y;
  if(prune&&bestSq<Infinity){
   const minX=ax<bx?ax:bx,maxX=ax>bx?ax:bx,minY=ay<by?ay:by,maxY=ay>by?ay:by;
   const gapX=px<minX?minX-px:(px>maxX?px-maxX:0),gapY=py<minY?minY-py:(py>maxY?py-maxY:0);
   if(gapX*gapX+gapY*gapY>bestSq)continue;
  }
  const vx=bx-ax,vy=by-ay,den=vx*vx+vy*vy;
  const u=den>1e-12?Math.max(0,Math.min(1,((px-ax)*vx+(py-ay)*vy)/den)):0;
  const qx=ax+vx*u,qy=ay+vy*u,dx=qx-px,dy=qy-py,sq=dx*dx+dy*dy;
  if(sq<bestSq){bestSq=sq;bestDistance=seg.start+seg.len*u;bestX=qx;bestY=qy;}
 }
 out.distance=bestDistance;out.x=bestX;out.y=bestY;out.sq=bestSq;return out;
}
let seed=153;function rand(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
function make(n,mode='spiral'){
 const segs=[];let total=0;
 for(let i=0;i<n;i++){
  const angle=i*.037,angle2=(i+1)*.037;
  const radius=mode==='spiral'?25+i*.036:120;
  const a={x:Math.cos(angle)*radius,y:Math.sin(angle)*radius};
  const b={x:Math.cos(angle2)*radius,y:Math.sin(angle2)*radius};
  const len=Math.hypot(b.x-a.x,b.y-a.y);
  segs.push({a,b,start:total,len});total+=len;
 }
 return{segs,total};
}
let assertions=0;
for(const n of [0,1,2,32,47,48,128,191,192,193,1024,4096]){
 const t=make(n);
 if(n>64){t.segs[2].b=t.segs[2].a;t.segs[3].a=t.segs[3].b;}
 for(let i=0;i<150;i++){
  const x=(rand()-.5)*800,y=(rand()-.5)*800;
  const a=reference(t,x,y,{}),b=fast(t,x,y,{});
  for(const k of ['sq','distance','x','y']){assert.equal(b[k],a[k],`n=${n}, i=${i}, ${k}`);assertions++;}
 }
 // Same table owner reuses its arrays across frame boundaries.
 if(n>=192){runtime.frameId++;for(let j=0;j<t.segs.length;j++){const p=t.segs[j];p.a.x+=1.7;p.b.x+=1.7;}}
 for(let i=0;i<16;i++){
  const x=(rand()-.5)*800,y=(rand()-.5)*800;
  const a=reference(t,x,y,{}),b=fast(t,x,y,{});
  for(const k of ['sq','distance','x','y']){assert.equal(b[k],a[k],`mutated n=${n}, ${k}`);assertions++;}
 }
}
const referenceVM=vm.runInNewContext('('+reference.toString()+')',{Math,Number,Infinity});
// If a pooled path table is rebuilt twice within one frame, the geometry
// revision invalidates cached group bounds before the next query.
const recycled=make(1024);recycled._webProjectionRevision=1;
for(let i=0;i<8;i++)fast(recycled,i*10,120,{});
recycled.segs[450].a.x=0;recycled.segs[450].a.y=0;
recycled.segs[450].b.x=1;recycled.segs[450].b.y=1;
recycled._webProjectionRevision++;
for(let i=0;i<24;i++){
 const x=i*.05,y=i*.031,a=reference(recycled,x,y,{}),b=fast(recycled,x,y,{});
 for(const k of ['sq','distance','x','y']){assert.equal(b[k],a[k],`same-frame revision ${i} ${k}`);assertions++;}
}
const dense=make(4096),anchors=Array.from({length:220},()=>[(rand()-.5)*300,(rand()-.5)*300]);
function run(fn){const start=performance.now();let checksum=0;for(let r=0;r<4;r++)for(const [x,y] of anchors){const o=fn(dense,x,y,{});checksum+=o.sq+o.distance;}return{ms:performance.now()-start,checksum};}
for(let i=0;i<2;i++){run(referenceVM);run(fast);}
const samples=[];for(let i=0;i<5;i++){const old=run(referenceVM),next=run(fast);assert.equal(old.checksum,next.checksum);samples.push({base:old.ms,candidate:next.ms});}
const median=(a)=>a.slice().sort((x,y)=>x-y)[2];
console.log('PASS v8.15 Web block projection numeric parity',assertions,'assertions; baseMs',median(samples.map(s=>s.base)).toFixed(2),'newMs',median(samples.map(s=>s.candidate)).toFixed(2));
(async()=>{
 const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:200,evalTimeoutMs:30000});
 try{
  const r=await h.evaluate(`(()=>{
    const baseline=${reference.toString()};
    let seed=1001;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const make=(n,kind)=>{const segs=[];let total=0;for(let i=0;i<n;i++){
      const u=i*.027,v=(i+1)*.027,r=kind==='spiral'?50+i*.033:110;
      const a={x:Math.cos(u)*r,y:Math.sin(u)*r},b={x:Math.cos(v)*r,y:Math.sin(v)*r};
      const len=Math.hypot(b.x-a.x,b.y-a.y);segs.push({a,b,start:total,len});total+=len;
    }return{segs,total};};
    const oldActive=frameGeometryRuntime.active;frameGeometryRuntime.active=true;
    const trials=[];
    try{for(const n of [256,1024,4096]){
      const table=make(n,'spiral'),anchors=Array.from({length:220},()=>[(rnd()-.5)*320,(rnd()-.5)*320]);
      const bench=fn=>{const t0=performance.now();let acc=0;for(let rep=0;rep<6;rep++)for(const [x,y] of anchors){const z=fn(table,x,y,{});acc+=z.sq+z.distance;}return{ms:performance.now()-t0,acc};};
      for(let i=0;i<2;i++){bench(baseline);bench(nearestWebDistanceOnTable);}const before=[],after=[];
      for(let i=0;i<5;i++){const b=bench(baseline),a=bench(nearestWebDistanceOnTable);if(b.acc!==a.acc)throw Error('Web pixel-anchor mismatch');before.push(b.ms);after.push(a.ms);}
      before.sort((a,b)=>a-b);after.sort((a,b)=>a-b);trials.push({segments:n,baseMs:before[2],newMs:after[2]});
    }}finally{frameGeometryRuntime.active=oldActive;}
    return{trials,boot:window.__spiroAppBootComplete===true};
  })()`,{timeoutMs:27000,label:'v815 nearest Web Chromium'});
  assert(r.boot);assert(uncaughtExceptions(h.events).length===0,'browser exceptions');
  console.log('CHROMIUM Web v815',JSON.stringify(r.trials));
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL Web browser',err.stack||err);process.exitCode=1;});
