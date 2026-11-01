'use strict';
const assert=require('node:assert/strict');const fs=require('fs'),vm=require('vm'),path=require('path');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../js/geometry/unified-fillet.js'),'utf8'));
let seed=0xbabe671;function rnd(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;}
const mix=(a,b,t)=>a+(b-a)*t;
function draw(points,flags,closed,round,drop=30){const chunks=[];let curr,start;const sample=p=>{if(!Number.isFinite(p.x+p.y))throw Error('nonfinite');};const ctx={moveTo(x,y){curr={x,y};start=curr;chunks.push(curr);},bezierCurveTo(x1,y1,x2,y2,x,y){const p=curr;for(let j=1;j<=3;j++){const t=j/3,u=1-t;const v={x:u*u*u*p.x+3*u*u*t*x1+3*u*t*t*x2+t*t*t*x,y:u*u*u*p.y+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y};sample(v);chunks.push(v);}curr={x,y};},closePath(){chunks.push(start)}};const ok=drawUnifiedFilletPath(ctx,points,closed,round,flags,{layer:{N:6,radius:100,roundingMaxRadiusDrop:drop}});if(!ok)return null;const arcs=[0];for(let i=1;i<chunks.length;i++)arcs.push(arcs.at(-1)+Math.hypot(chunks[i].x-chunks[i-1].x,chunks[i].y-chunks[i-1].y));const len=arcs.at(-1);const sampleAt=t=>{let lo=1,hi=arcs.length-1;const s=t*len;while(lo<hi){const m=(lo+hi)>>1;if(arcs[m]<s)lo=m+1;else hi=m;}const i=lo,a=arcs[i-1],b=arcs[i],u=(s-a)/Math.max(1e-12,b-a);return {x:mix(chunks[i-1].x,chunks[i].x,u),y:mix(chunks[i-1].y,chunks[i].y,u)}};return {len,sampleAt};}
function shape(n,closed,variant){let p=Array.from({length:n},(_,i)=>{let a=i*2*Math.PI/n,r=15+80*rnd();if(variant===1)r=i%2?8:130;if(variant===2)r=120;if(variant===3)r=50+i*8;return{x:r*Math.cos(a)+5*(rnd()-.5),y:r*Math.sin(a)+5*(rnd()-.5)}});if(!closed&&variant===3)p=p.map((q,i)=>({x:35+i*3,y:35*Math.sin(i*.9)}));let flags=p.map((_,i)=>rnd()>.15);if(!flags.some(Boolean))flags[0]=true;return {p,flags};}
let max=0,over=0,bad=null,checks=0;
for(let cas=0;cas<4000;cas++){
 const n=4+Math.floor(rnd()*25),closed=rnd()>.4,variant=cas%4,{p,flags}=shape(n,closed,variant);
 if(cas%3===0){const i=Math.floor(rnd()*(n-1))+1;p[i]={x:p[i-1].x+1e-8*(rnd()-.5),y:p[i-1].y+1e-8*(rnd()-.5)};}
 const round=[.02,.4,.9,1,1.000001,1.5,2][Math.floor(rnd()*7)],drop=[0,5,15,30,60][Math.floor(rnd()*5)];
 const v=p.map((q,i)=>({x:q.x+(rnd()-.5)*1e-5,y:q.y+(rnd()-.5)*1e-5}));
 const a=draw(p,flags,closed,round,drop),b=draw(v,flags,closed,round,drop);if(!a||!b)continue;
 let error=0;for(let k=0;k<=100;k++){const q=a.sampleAt(k/100),r=b.sampleAt(k/100);error=Math.max(error,Math.hypot(q.x-r.x,q.y-r.y));}
 if(error>max){max=error;bad={cas,n,closed,variant,round,drop,error,p,flags,v};}
 assert(error<.025,`phase-safety regression case=${cas}, round=${round}, drop=${drop}, error=${error}`); checks++;
}
console.log(`PASS 11.0.11: ${checks} close-phase high-radius and mixed mini-edge comparisons, max ${max.toFixed(6)} geometry units`);
