'use strict';
// Compare the precise arc-length lookup against the unchanged 8.7.0 source.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const optimized=fs.readFileSync(path.join(__dirname,'../js/gpu/spiral-bezier-morph-renderer.js'),'utf8');
// The previous algorithm is embedded, so the release test also works standalone.
const baselineBlock=`function railLocationAtFraction(map,f){const target=clamp(f,0,1)*map.total;let i=0;while(i<map.entries.length-1&&target>map.entries[i].end+1e-9)i++;const e=map.entries[i],local=(target-e.start)/Math.max(1e-9,e.end-e.start);return{index:i,t:localTAtArcFraction(e,local)};}`;
const beforeFile=process.env.SOMATA_BASELINE_ROOT?fs.readFileSync(path.join(process.env.SOMATA_BASELINE_ROOT,'js/gpu/spiral-bezier-morph-renderer.js'),'utf8'):baselineBlock;
function extract(source,name){
 const at=source.indexOf('function '+name+'(');assert(at>=0,'missing '+name);
 const open=source.indexOf('{',at);let level=0;
 for(let i=open;i<source.length;i++){if(source[i]==='{')level++;else if(source[i]==='}'&&!--level)return source.slice(at,i+1);}
 throw Error('Unclosed '+name);
}
const helpers=['localTAtArcFraction'].map(x=>extract(optimized,x)).join('\n');
const prelude='const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));\n'+helpers+'\n';
const make=source=>new Function(prelude+extract(source,'railLocationAtFraction')+'\nreturn railLocationAtFraction;')();
const before=make(beforeFile),after=make(optimized);
function mapFor(n,kind){
 let t=0;const entries=[];
 for(let i=0;i<n;i++){
  const gap=kind===0?1:kind===1?Math.pow(1.015,i):1e-7+(i%17)*1e-4;
  const start=t;t+=gap;
  const steps=12,total=gap;const ts=new Float32Array(steps+1),ls=new Float32Array(steps+1);
  for(let j=1;j<=steps;j++){ts[j]=j/steps;ls[j]=(j/steps)*total;}
  entries.push({start,end:t,lut:{ts,ls,total}});
 }
 return{entries,total:t};
}
function compare(m,f,desc){
 const a=before(m,f),b=after(m,f);
 assert.equal(a.index,b.index,desc+' index');
 assert(Object.is(a.t,b.t),desc+': t differs '+String(a.t)+' '+String(b.t));
}
for(const n of [1,2,7,97,513,2048])for(let kind=0;kind<3;kind++){
 const m=mapFor(n,kind);
 for(let i=0;i<=100;i++)compare(m,i/100,`uniform ${n}/${kind}/${i}`);
 for(let i=0;i<n;i++)for(const off of [-1e-8,-1e-10,0,1e-10,1e-8])compare(m,(m.entries[i].end+off)/m.total,`boundary ${n}/${kind}/${i}/${off}`);
 for(const f of [-1,0,0.001,0.5,0.999999999,1,2,NaN])compare(m,f,`edge ${n}/${kind}/${f}`);
}
console.log('PASS 8.8 exact index and interpolation across varied arc maps and boundary tolerances');
const m=mapFor(4096,0),queries=Array.from({length:8192},(_,i)=>i/8191),runs=9;
const timed=(fn)=>{let s=0;const start=performance.now();for(const q of queries)s+=fn(m,q).index;return {ms:performance.now()-start,s};};
for(let i=0;i<3;i++){timed(before);timed(after);}
const samples=[];
for(let i=0;i<runs;i++){
 let a,b;if(i%2===0){a=timed(before);b=timed(after);}else{b=timed(after);a=timed(before);}assert.equal(a.s,b.s);samples.push([a.ms,b.ms]);
}
const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
const old=median(samples.map(x=>x[0])),cur=median(samples.map(x=>x[1]));
console.log('ARC_LOOKUP_BENCH '+JSON.stringify({segments:4096,queries:8192,baselineMs:+old.toFixed(3),candidateMs:+cur.toFixed(3),speedup:+(old/cur).toFixed(2)}));
