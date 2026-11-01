'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../js/geometry/unified-fillet.js'),'utf8'));
const L=2*100*Math.sin(Math.PI/4),boundary=L*2e-6;
function trace(points,flags,closed,amount){
 const samples=[];let at=null,first=null;
 const ctx={moveTo(x,y){at={x,y};first=at;samples.push(at);},bezierCurveTo(x1,y1,x2,y2,x,y){
  const s=at;for(let k=1;k<=80;k++){const t=k/80,u=1-t;
   samples.push({x:u*u*u*s.x+3*u*u*t*x1+3*u*t*t*x2+t*t*t*x,
    y:u*u*u*s.y+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y});}
  at={x,y};},closePath(){samples.push(first);}};
 const original=JSON.stringify(points);
 assert(drawUnifiedFilletPath(ctx,points,closed,amount,flags,{layer:{N:4,radius:100,roundingMaxRadiusDrop:30}}));
 assert.equal(JSON.stringify(points),original,'Morph anchors were mutated');
 assert(samples.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)),'invalid Bézier output');
 return samples;
}
function dist(p,a,b){const dx=b.x-a.x,dy=b.y-a.y;const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/Math.max(1e-12,dx*dx+dy*dy)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
function metric(A,B){let max=0;for(const [a,b] of [[A,B],[B,A]])for(let i=0;i<a.length;i+=Math.max(1,Math.floor(a.length/200))){let d=Infinity;for(let k=1;k<b.length;k++)d=Math.min(d,dist(a[i],b[k-1],b[k]));max=Math.max(max,d);}return max;}
let checks=0,worst=0;
const base=[{x:100,y:0},{x:0,y:100},{x:-100,y:0},{x:0,y:-100}];
for(const closed of [true,false])for(const round of [.15,1,1.75,2])for(const [f1,f2] of [[true,true],[true,false],[false,true]]){
 const flags=closed?[true,f1,f2,true,true,true]:[false,f1,f2,true,true,false];
 const make=d=>[base[0],{x:100+d,y:d*.03},{x:100+d*1.3,y:d*.35},...base.slice(1)];
 for(const multiplier of [.995,1,1.005,1.02]){
  const a=trace(make(boundary*multiplier),flags,closed,round);
  const b=trace(make(boundary*(multiplier+0.0001)),flags,closed,round);
  const d=metric(a,b);worst=Math.max(worst,d);checks++;
  assert(d<.03,`mini-profile crossing collapse boundary popped: closed=${closed} r=${round} flags=${f1},${f2} err=${d}`);
 }
}
console.log(`PASS 11.0.11: ${checks} micro-edge collapse threshold transitions (max ${worst.toFixed(6)})`);
