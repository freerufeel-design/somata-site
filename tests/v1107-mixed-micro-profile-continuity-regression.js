'use strict';
// Regression for mixed corner flags at newborn Morph rails. In 11.0.6 the
// first nonzero micro edge created an O(10px) leap in the *rounded* outline.
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../js/geometry/unified-fillet.js'),'utf8'));
const polar=(r,a)=>({x:r*Math.cos(a),y:r*Math.sin(a)});
function render(pts,flags,amount,closed,spline=false){
 const commands=[];let q=null,start=null;const all=[];
 const emit=(p)=>{assert(Number.isFinite(p.x)&&Number.isFinite(p.y));all.push(p);};
 const ctx={moveTo(x,y){q={x,y};start=q;commands.push(['M',x,y]);emit(q);},
 bezierCurveTo(x1,y1,x2,y2,x,y){for(const a of [x1,y1,x2,y2,x,y])assert(Number.isFinite(a));
  const a=q;for(let i=1;i<=64;i++){const t=i/64,u=1-t;emit({x:u*u*u*a.x+3*u*u*t*x1+3*u*t*t*x2+t*t*t*x,y:u*u*u*a.y+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y});}
  q={x,y};commands.push(['C',x1,y1,x2,y2,x,y]);},
 closePath(){if(start)emit(start);commands.push(['Z']);}}
 const options={layer:{N:4,radius:100,roundingMaxRadiusDrop:30},spline};
 if(spline){globalThis.centripetalSplineBezierControls=(p0,p1,p2,p3)=>({c1:{x:p1.x+(p2.x-p0.x)/6,y:p1.y+(p2.y-p0.y)/6},c2:{x:p2.x-(p3.x-p1.x)/6,y:p2.y-(p3.y-p1.y)/6}});}
 assert.equal(drawUnifiedFilletPath(ctx,pts,closed,amount,flags,options),true);
 return {all,commands};
}
function dist(p,a,b){const dx=b.x-a.x,dy=b.y-a.y;const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/Math.max(1e-16,dx*dx+dy*dy)));return Math.hypot(p.x-(a.x+dx*t),p.y-(a.y+dy*t));}
function haus(A,B){const one=(a,b)=>{let max=0;for(let i=0;i<a.length;i+=Math.max(1,Math.floor(a.length/200))){let min=Infinity;for(let j=1;j<b.length;j++)min=Math.min(min,dist(a[i],b[j-1],b[j]));max=Math.max(max,min);}return max;};return Math.max(one(A.all,B.all),one(B.all,A.all));}
const square=[polar(100,0),polar(100,Math.PI/2),polar(100,Math.PI),polar(100,3*Math.PI/2)];
let checks=0,maxClose=0,maxSeam=0,maxSteady=0;
for(const closed of [true,false])for(const round of [.08,.5,1,1.4,2])for(const flags of [
 [true,false,false,true,true,true],[true,false,true,true,true,true],[true,true,false,true,true,true],
 [true,true,true,true,true,true]]){
 const mini=t=>[square[0],{x:100+t,y:.5*t},{x:100+2*t,y:2*t},...square.slice(1)];
 const pointFlags=closed?flags:[false,flags[1],flags[2],flags[3],flags[4],false];
 const reference=render(mini(0),pointFlags,round,closed);
 for(const t of [1e-8,1e-7,1e-6,1e-5,.0001]){
  const moving=render(mini(t),pointFlags,round,closed);
  const e=haus(reference,moving);maxClose=Math.max(maxClose,e);checks++;
  assert(e<.02,`tiny mixed-flag profile popped: closed=${closed} flags=${JSON.stringify(pointFlags)} r=${round} t=${t} error=${e}`);
 }
 if(closed){const rotated=mini(.1).slice(1).concat(mini(.1).slice(0,1));
  const a=render(mini(.1),pointFlags,round,closed),b=render(rotated,pointFlags.slice(1).concat(pointFlags.slice(0,1)),round,closed);
  const e=haus(a,b);maxSeam=Math.max(maxSeam,e);checks++;assert(e<.18,`seam reindex ${e}`);}
}
// Fixed-phase low-amplitude linear translation along a spiral and many small
// teeth, preserving their authored tangents and order.
for(const closed of [false,true])for(const round of [.2,.8,1,1.5,2]){
 const src=Array.from({length:24},(_,i)=>polar(25+i*2.5,4.2*Math.PI*i/23));
 const flags=src.map((_,i)=>i%4!==0);
 const a=render(src,flags,round,closed);
 const move=src.map((p,i)=>({x:p.x+1e-5*Math.sin(i*1.7),y:p.y+1e-5*Math.cos(i*1.1)}));
 const b=render(move,flags,round,closed);const e=haus(a,b);checks++;
 maxSteady=Math.max(maxSteady,e);assert(e<.05,`spiral drift ${e}`);
}
// Spline interpolation count must be independent of *moving* chord lengths.
for(const closed of [false,true]){
 const source=[{x:0,y:0},{x:100,y:40},{x:170,y:-22},{x:240,y:40},{x:340,y:0}];
 const flags=[false,true,true,true,false];
 for(const t of [0,.1,.2,.5,1]){
  const a=render(source.map((p,i)=>({...p,x:p.x+(i%2?t:0)})),flags,1.4,closed,true);
  const b=render(source.map((p,i)=>({...p,x:p.x+(i%2?t+1e-5:0)})),flags,1.4,closed,true);
  const e=haus(a,b);checks++;assert(e<.05,`spline chord threshold jump ${e}`);
 }
}
console.log(`PASS 11.0.7: ${checks} mixed flags, micro-birth, cyclic seams, spline chord counts, open/closed spiral; max micro ${maxClose.toFixed(6)}, seam ${maxSeam.toFixed(6)}, spiral ${maxSteady.toFixed(6)}`);
