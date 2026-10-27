'use strict';
// Exact order and topology contract for FrameContour's one-pass join assembly.
// Uses the unmodified 10.4.18 output as a fixed, deterministic oracle.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const filename=process.env.SOMATA_FRAME_CONTOUR_SOURCE||path.join(__dirname,'../js/geometry/frame-contour.js');
const code=fs.readFileSync(filename,'utf8');
const begin=code.indexOf('    function samePoint(a,b)');
const end=code.indexOf('    function multiply(a,b)',begin);
assert(begin>=0&&end>begin,'FrameContour joining functions must remain present');
const context=vm.createContext({});
vm.runInContext('const JOIN_EPS=1e-3; const stats={joins:0,closed:0,open:0};\n'+code.slice(begin,end)+'\nthis.join=buildScreenPaths;',context,{filename});
const join=context.join;
let seed=0x19F0BEEF;
function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
function shuffle(a){for(let j=a.length-1;j>0;j--){const i=Math.floor(random()*(j+1));[a[j],a[i]]=[a[i],a[j]];}return a;}
function buildCase(n){
 const contours=[];let x=0,y=0;
 for(let i=0;i<n;i++){
  if(random()<.22){x=Math.floor(random()*300)*10;y=Math.floor(random()*300)*10;}
  const pts=[{x,y,__profileCorner:true,widthScale:'1.5'}];
  const count=2+Math.floor(random()*12);
  for(let j=1;j<count;j++){
   x+=1+Math.floor(random()*4);y+=Math.floor(random()*3)-1;
   pts.push({x,y,__profileKeyCorner:random()<.17,widthScale:random()<.3?undefined:1.5});
  }
  // Endpoint fuzz around the 1e-3 join tolerance and around bucket edges.
  if(random()<.30){
   const endpoint=random()<.5?pts[0]:pts[pts.length-1];
   const delta=[-.00101,-.00099,0,.00099,.00101][Math.floor(random()*5)];
   endpoint.x+=delta;endpoint.y-=delta;
  }
  if(random()<.05)pts.push({...pts[0]});
  if(random()<.04)pts.push({x:Infinity,y:0});
  if(random()<.35)pts.reverse();
  contours.push({id:i,points:pts,closed:random()<.07});
 }
 return shuffle(contours);
}
const inputs=[[],[{id:10,points:[{x:1,y:2}]}],
 [{id:11,closed:true,points:[{x:0,y:0},{x:1,y:0},{x:0,y:1},{x:0,y:0}]}],
 [{id:0,points:[{x:1,y:0},{x:2,y:0}]},{id:1,points:[{x:0,y:0},{x:1,y:0}]},{id:2,points:[{x:2,y:0},{x:3,y:0}]}]
];
for(let n=0;n<440;n++)inputs.push(buildCase(Math.floor(random()*75)));
const snapshots=inputs.map(contours=>join({contours}).map(p=>({closed:p.closed,source:p.source.map(s=>s.id),points:p.points})));
const hash=crypto.createHash('sha256').update(JSON.stringify(snapshots)).digest('hex');
if(process.env.SOMATA_PARITY_SNAPSHOT==='1')console.log('SNAPSHOT '+hash+' cases='+inputs.length);
assert.equal(hash,'0434df8abcc024937f775583e0a144f61f06d11000009b9ea8420918f89e08e8','FrameContour points, source order or closed flags differ from 10.4.18');
if(!process.env.SOMATA_FRAME_CONTOUR_SOURCE){
 // A long chain may be built from the head. It must not cause an argument-spread
 // RangeError or quadratic copying of an already assembled point buffer.
 const contours=[];
 for(let i=0;i<2500;i++){
  const points=[];
  for(let j=0;j<40;j++)points.push({x:(2500-i)*39+j,y:0});
  contours.push({id:i,points});
 }
 const assembled=join({contours});
 assert.equal(assembled.length,1);
 assert.equal(assembled[0].points.length,2500*39+1);
 assert.equal(assembled[0].source.length,2500);
}
console.log('PASS Somata 10.4.19 FrameContour assembly parity and large-chain safety');
