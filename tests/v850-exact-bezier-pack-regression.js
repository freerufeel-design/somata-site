'use strict';
// Regression compares the actual retained-Bézier packing function to the
// unmodified v8.4 implementation, when available, and a self-contained
// reference of its original coordinate validation/write loop otherwise.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert');
const perf=require('perf_hooks').performance;
const root=path.join(__dirname,'..');
const file='js/app/geometry-gpu-core.js';
const source=fs.readFileSync(path.join(root,file),'utf8');
const marker='function packBezierSpiralCommands(commands,scratch=null){';
function extract(src){const start=src.indexOf(marker);assert(start>=0,'Exact Spiral GPU packer missing');let i=src.indexOf('{',start),depth=0,end=-1;for(;i<src.length;i++){const c=src[i];if(c==='{')depth++;else if(c==='}'&&!--depth){end=i+1;break;}}assert(end>=0,'Packer braces unbalanced');return src.slice(start,end);}
const optimized=extract(source);
const baselineDir=process.env.SOMATA_BASELINE_ROOT||'';
let previous;
if(baselineDir){previous=extract(fs.readFileSync(path.join(baselineDir,file),'utf8'));}
else{
  // Old v8.4.0 expression, retained as reference for standalone ZIP tests.
  const replacement='const vals=[p0.x,p0.y,c1.x,c1.y,c2.x,c2.y,p3.x,p3.y];if(vals.some(v=>!Number.isFinite(Number(v))))continue;';
  const start=optimized.indexOf('const x0=Number(p0.x)');
  const stop=optimized.indexOf('out[o+8]=baseHw',start);
  assert(start>=0&&stop>start,'v8.5 finite-coordinate fast path missing');
  const old='const o=k*BEZIER_FLOATS_PER_CUBIC;for(let i=0;i<8;i++)out[o+i]=Number(vals[i]);';
  previous=optimized.slice(0,start)+replacement+'\n                        '+old+optimized.slice(stop);
}
const commons=`let bezierOversizeRejects=0,lastError='';const BEZIER_FLOATS_PER_CUBIC=20,device={limits:{maxStorageBufferBindingSize:134217728}};
const parseColor=(s)=>{const x=(String(s).match(/[\\da-f]{2}/gi)||[]).slice(0,3).map(z=>parseInt(z,16)/255);return [x[0]??1,x[1]??1,x[2]??1,1]};
const spiralSmoothStep01=t=>t*t*(3-2*t);`;
function create(code){return new Function('commands','scratch',commons+'\n'+code+'\nreturn packBezierSpiralCommands(commands,scratch);');}
const old=create(previous),fast=create(optimized);
function make(n,variant){const points=[];for(let j=0;j<n;j++){const r=j*0.015,c=Math.cos(r),s=Math.sin(r),x=r*c,y=r*s;const w=variant===2?1:Math.exp(-j/Math.max(1,n)*2.5);points.push({p0:{x,y},c1:{x:x+.10,y:y+.01},c2:{x:x+.2,y:y+.05},p3:{x:x+.3,y:y+.08},widthScale0:w,widthScale1:variant===3?w:Math.exp(-(j+1)/Math.max(1,n)*2.5),alpha0:(j%19)/19,alpha1:(j%23)/23});}
 if(variant===1){points[1].c2.x=NaN;points[3].p0.y=Infinity;points[5].p3.x='-12.5';}
 return [{strokeStyle:'#ab34cd',screenLineWidth:1.5,alpha:.7,bezierSegments:points},{strokeStyle:variant===4?'#113355':'#ab34cd',screenLineWidth:2,alpha:.9,bezierSegments:points.slice(0,Math.min(16,n))}];}
function digest(pack){return crypto.createHash('sha256').update(Buffer.from(pack.data.buffer,pack.data.byteOffset,pack.byteLength)).digest('hex');}
for(const [n,v] of [[1,0],[64,1],[128,2],[4096,3],[768,4]]){
 const cmds=make(n,v),a=old(cmds),b=fast(cmds);
 assert(a&&b&&a.cubicCount===b.cubicCount&&a.byteLength===b.byteLength&&a.blendKind===b.blendKind,`Packing metadata changed for ${n}/${v}`);
 const aa=Buffer.from(a.data.buffer,a.data.byteOffset,a.byteLength),bb=Buffer.from(b.data.buffer,b.data.byteOffset,b.byteLength);
 assert(aa.equals(bb),`Retained exact Bézier Float32 output differs for ${n}/${v}`);
 console.log(`PASS exactBezier ${n}/${v} ${a.cubicCount} cubics ${digest(b).slice(0,14)}`);
}
const benchCommands=make(Number(process.env.CUBICS||8192),3),repeats=Number(process.env.REPEATS||60);
function measure(fn){const times=[];let scratch;for(let j=0;j<5;j++){const t=perf.now();for(let i=0;i<repeats;i++){const p=fn(benchCommands,scratch);scratch=p.data;}times.push(perf.now()-t);}times.sort((a,b)=>a-b);return times[2];}
// Interleave to make the benchmark less dependent on JS compilation/warmup order.
old(benchCommands);fast(benchCommands);const oldMs=measure(old),newMs=measure(fast);
console.log(`BENCH exactBezier pack ${benchCommands[0].bezierSegments.length} cubics x${repeats}: baseline ${oldMs.toFixed(2)}ms candidate ${newMs.toFixed(2)}ms ratio ${(oldMs/newMs).toFixed(2)}x`);
