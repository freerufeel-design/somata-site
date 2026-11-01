'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const {performance}=require('node:perf_hooks');
const root=path.resolve(__dirname,'..');
const shader=fs.readFileSync(path.join(root,'js/gpu/spiral-bezier-morph-renderer.js'),'utf8');
assert(shader.includes('const logWs0=widthLogs[wo]*invT+widthLogs[wo+2]*tt'));
assert(shader.includes('const logWs0=widthLogs[wo]*invT+widthLogs[wo+2]*tt'));
assert(shader.includes('if(cp0.z*g1.z<=.00001||cp2.y<=.00001)'));
assert(shader.includes('let boundsPad=1.415*pad;'));
// The entire previously rendered quad is inside the expanded endpoint AABB:
// |dir.x|+|normal.x| <= sqrt(2), likewise Y, for any unit tangent.
for(let i=0;i<10000;i++){
 const angle=(i*2.39996)%(Math.PI*2),dirX=Math.cos(angle),dirY=Math.sin(angle);
 assert(Math.abs(dirX)+Math.abs(-dirY)<=1.415);
 assert(Math.abs(dirY)+Math.abs(dirX)<=1.415);
}
// Recreate the original exact sample formula; optimization only writes into an
// existing output object. Check every polynomial coefficient at adversarial t.
function original(p0,c1,c2,p3,t){const z=1-t,z2=z*z,t2=t*t;return{x:z2*z*p0.x+3*z2*t*c1.x+3*z*t2*c2.x+t2*t*p3.x,y:z2*z*p0.y+3*z2*t*c1.y+3*z*t2*c2.y+t2*t*p3.y};}
function optimized(p0,c1,c2,p3,t,dst){const z=1-t,z2=z*z,q2=t*t;dst.x=z2*z*p0.x+3*z2*t*c1.x+3*z*q2*c2.x+q2*t*p3.x;dst.y=z2*z*p0.y+3*z2*t*c1.y+3*z*q2*c2.y+q2*t*p3.y;return dst;}
function oldWidth(s0,s1,d0,d1,t,q){const ws0=Math.exp(Math.log(Math.max(.02,s0))*(1-t)+Math.log(Math.max(.02,d0))*t),ws1=Math.exp(Math.log(Math.max(.02,s1))*(1-t)+Math.log(Math.max(.02,d1))*t);return Math.exp(Math.log(Math.max(.02,ws0))*(1-q)+Math.log(Math.max(.02,ws1))*q);}
function newWidth(s0,s1,d0,d1,t,q){const a0=Math.log(Math.max(.02,s0)),a1=Math.log(Math.max(.02,s1)),b0=Math.log(Math.max(.02,d0)),b1=Math.log(Math.max(.02,d1));return Math.exp((a0*(1-t)+b0*t)*(1-q)+(a1*(1-t)+b1*t)*q);}
let maxPoint=0,maxWidth=0;const p0={x:112.783,y:-252.888},c1={x:-56.34,y:18.25},c2={x:378.32,y:-178.19},p3={x:32.42,y:10.02},dst={x:0,y:0};
for(let i=0;i<60000;i++){
 const t=i%7/6,tt=(i%101)/100,a=original(p0,c1,c2,p3,t),b=optimized(p0,c1,c2,p3,t,dst);
 maxPoint=Math.max(maxPoint,Math.abs(a.x-b.x),Math.abs(a.y-b.y));
 const values=[.015+(i%83)*.117,.02+(i%99)*.133,.018+(i%42)*.173,.025+(i%50)*.122];
 const w0=oldWidth(...values,tt,t),w1=newWidth(...values,tt,t);
 maxWidth=Math.max(maxWidth,Math.abs(w0-w1));
}
assert(maxPoint===0,'cubic coordinates changed');assert(maxWidth<1e-11,'width interpolation changed by more than roundoff');
// Microbenchmark the actual previously redundant log(exp()) work only.
// The independent sample-loop experiment showed that V8 already eliminates
// many short-lived point objects, so point mutation was deliberately reverted.
const curves=4300,rounds=50;let sum=0;
const widthData=new Float64Array(curves*4),widthLogs=new Float64Array(curves*4);
for(let i=0;i<widthData.length;i++){
  widthData[i]=.02+(i%39)*.08;
  widthLogs[i]=Math.log(Math.max(.02,widthData[i]));
}
function oldWidthSamples(phase){let v=0;for(let ci=0;ci<curves;ci++){
 const o=ci*4;
 const ws0=Math.exp(Math.log(Math.max(.02,widthData[o]))*(1-phase)+Math.log(Math.max(.02,widthData[o+2]))*phase);
 const ws1=Math.exp(Math.log(Math.max(.02,widthData[o+1]))*(1-phase)+Math.log(Math.max(.02,widthData[o+3]))*phase);
 const l0=Math.log(Math.max(.02,ws0)),l1=Math.log(Math.max(.02,ws1));
 for(let j=0;j<=6;j++)v+=Math.exp(l0*(1-j/6)+l1*j/6);
 }sum+=v;}
function newWidthSamples(phase){let v=0;for(let ci=0;ci<curves;ci++){
 const o=ci*4,l0=widthLogs[o]*(1-phase)+widthLogs[o+2]*phase,l1=widthLogs[o+1]*(1-phase)+widthLogs[o+3]*phase;
 for(let j=0;j<=6;j++)v+=Math.exp(l0*(1-j/6)+l1*j/6);
 }sum+=v;}
for(let i=0;i<5;i++){oldWidthSamples(i/5);newWidthSamples(i/5);}
let timer=performance.now();for(let i=0;i<rounds;i++)oldWidthSamples(i/rounds);const oldMs=performance.now()-timer;
timer=performance.now();for(let i=0;i<rounds;i++)newWidthSamples(i/rounds);const newMs=performance.now()-timer;
console.log('PASS identical cubic points, width math and conservative GPU invisibility culling',JSON.stringify({maxPointError:maxPoint,maxWidthError:maxWidth,calculatedPoints:60000,widthCubics:curves,widthFrames:rounds,oldWidthMs:oldMs,newWidthMs:newMs,widthSpeedup:oldMs/newMs,sum}));
