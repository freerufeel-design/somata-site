'use strict';
// Deterministic numeric contract for the Geometry Circles hot path. No GPU is
// necessary, and no temporary snapshots or logs are written by this test.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const vm=require('node:vm');
const source=fs.readFileSync(process.env.SOMATA_CIRCLES_SOURCE||path.resolve(__dirname,'../js/render/geometry-circles-pass.js'),'utf8');
const context={window:{}};
vm.createContext(context);
vm.runInContext(source,context,{filename:'geometry-circles-pass.js'});
const compute=context.window.SomataGeometryCircles.compute;
assert.equal(typeof compute,'function');
let seed=0x42891823;
function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
const pathological=[0,-0,1,-1,0.001,-1e-12,99.5,1e9,1e150,Infinity,-Infinity,NaN,null,'3.75',undefined];
const val=()=>random()<.16?pathological[Math.floor(random()*pathological.length)]:(random()-.5)*500;
const cases=[
 [],
 [{points:[]}],
 [{points:[{x:5,y:0}]}],
 [{points:[{x:5,y:0},{x:5,y:0}],closed:true,cornerFlags:[1,1]}],
 [{points:[{x:0,y:5},{x:5,y:0},{x:0,y:-5},{x:-5,y:0}],closed:true,cornerFlags:[1,1,1,1]}],
 [{points:[{x:1e200,y:0},{x:1e200,y:1e200},{x:0,y:0}],closed:true}],
 [{points:[null,{}, {x:NaN,y:Infinity}, {x:'7',y:'-7'}],closed:false}]
];
for(let i=0;i<160;i++){
 const paths=[];
 for(let j=0,n=Math.floor(random()*6);j<n;j++){
  const points=[];const flags=[];
  for(let k=0,m=Math.floor(random()*90);k<m;k++){
   points.push(random()<.04?null:{x:val(),y:val()});
   flags.push(random()<.25?1:0);
  }
  paths.push({points,cornerFlags:flags,closed:random()<.5});
 }
 cases.push(paths);
}
const snapshots=[];
for(const paths of cases)for(let flags=0;flags<16;flags++){
 const cfg={circumscribed:Boolean(flags&1),inscribed:Boolean(flags&2),median:Boolean(flags&4),keyPoints:Boolean(flags&8)};
 const value=compute(paths,cfg);
 snapshots.push(value.map(c=>[c.kind,c.x,c.y,c.r]));
}
const data=JSON.stringify(snapshots);
const hash=crypto.createHash('sha256').update(data).digest('hex');
if(process.env.SOMATA_PARITY_SNAPSHOT==='1')console.log('SNAPSHOT:'+hash+' bytes='+Buffer.byteLength(data));
assert.equal(hash,'f58dadcdabb9d2e9bd29b4fd5af07d397302dbebdd125c178947c34a841e541e','Geometry Circles output changed relative to Somata 10.4.17');
// A pathological number of isolated points used to crash the legacy
// Math.min(...all.map(...)) fallback through argument-list exhaustion.
if(process.env.SOMATA_CIRCLES_SOURCE===undefined){
 const isolated=Array.from({length:160000},(_,i)=>({points:[{x:i+1,y:0}]}));
 const circles=compute(isolated,{circumscribed:true,inscribed:true,median:true,keyPoints:false});
 assert.equal(circles.length,3);
 assert.equal(circles[0].r,160000);
 assert.equal(circles[1].r,1);
 assert.equal(circles[2].r,80000.5);
}
console.log('PASS Somata 10.4.18 Geometry Circles parity and large-profile safety');
