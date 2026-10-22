// Somata 8.13.0: exact Web anchor projection + large-contour performance.
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
function source(p){const s=fs.readFileSync(p,'utf8');const start=s.includes('        const webProjectionBlockCache=new WeakMap();')?s.indexOf('        const webProjectionBlockCache=new WeakMap();'):s.indexOf('        function nearestWebDistanceOnTable('),end=s.indexOf('        function pointAtWrappedWebDistance(',start);assert(start>=0&&end>start);return s.slice(start,end).trim();}
function extract(p){const c=vm.createContext({webDrawScratch:{nearest:{}},frameGeometryRuntime:{active:true,frameId:1},Math,Number,Infinity});return vm.runInContext(`${source(p)};nearestWebDistanceOnTable`,c);}
const candidate=extract(path.join(__dirname,'../js/app/lamp-audio-core.js'));
const basePath=process.env.SOMATA_COMPARE_BASE||path.join(__dirname,'../../Somata_8.12.0/js/app/lamp-audio-core.js');
let baseline;
if(fs.existsSync(basePath))baseline=extract(basePath);
else{
 // Snapshot of 8.12.0, compiled in the same VM as the candidate.
 const original=`function nearestWebDistanceOnTable(table,x,y,out={}){const px=Number(x)||0,py=Number(y)||0;let bestSq=Infinity,bestDistance=0,bestX=px,bestY=py;for(const seg of table?.segs||[]){const vx=seg.b.x-seg.a.x,vy=seg.b.y-seg.a.y,den=vx*vx+vy*vy;const u=den>1e-12?Math.max(0,Math.min(1,((px-seg.a.x)*vx+(py-seg.a.y)*vy)/den)):0;const qx=seg.a.x+vx*u,qy=seg.a.y+vy*u,dx=qx-px,dy=qy-py,sq=dx*dx+dy*dy;if(sq<bestSq){bestSq=sq;bestDistance=seg.start+seg.len*u;bestX=qx;bestY=qy;}}out.distance=bestDistance;out.x=bestX;out.y=bestY;out.sq=bestSq;return out;}`;
 baseline=vm.runInNewContext(`${original};nearestWebDistanceOnTable`,{Math,Number,Infinity});
}
let seed=18912345;function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
function createSegments(n){const segs=[];let last={x:170,y:0},distance=0;for(let i=0;i<n;i++){const a=last,b={x:Math.cos((i+1)*Math.PI*2/Math.max(1,n))*170,y:Math.sin((i+1)*Math.PI*2/Math.max(1,n))*155};const len=Math.hypot(b.x-a.x,b.y-a.y);segs.push({a,b,start:distance,len});distance+=len;last=b;}return {segs,total:distance};}
for(const n of [0,1,2,47,48,49,128,1024,4096]){
 const table=createSegments(n);if(n>=48){table.segs[7].b=table.segs[7].a;}
 for(let i=0;i<120;i++){
  const x=(random()-.5)*580,y=(random()-.5)*580,expected=baseline(table,x,y,{}),got=candidate(table,x,y,{});
  for(const key of ['distance','x','y','sq'])assert.equal(got[key],expected[key],`${n} segments sample ${i} ${key}`);
 }
}
// Repeat on thousands of sampled segments and Web corners, the high-density case.
const dense=createSegments(4096),queries=Array.from({length:220},()=>[(random()-.5)*340,(random()-.5)*340]);
function bench(fn){const t0=performance.now();let total=0;for(let r=0;r<3;r++)for(const [x,y] of queries)total+=fn(dense,x,y,{}).sq;return{ms:performance.now()-t0,total};}
for(let i=0;i<2;i++){bench(candidate);bench(baseline);}const before=[bench(baseline),bench(baseline),bench(baseline)],after=[bench(candidate),bench(candidate),bench(candidate)];const med=a=>a.map(x=>x.ms).sort((x,y)=>x-y)[1];assert.equal(before[0].total,after[0].total);
console.log(`PASS Web nearest point exact; 0/1/47/48/49/128/1024/4096 segments; CPU baseline ${med(before).toFixed(1)}ms new ${med(after).toFixed(1)}ms`);
