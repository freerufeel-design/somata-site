'use strict';
const assert=require('node:assert/strict');const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:65000});try{
 const data=await h.evaluate(`(()=>{const layer=createLayer('zero-ramp');Object.assign(layer,{N:5,radius:170,roundingSmoothSplines:true});
 const pts=[{x:-160,y:-30},{x:-90,y:95},{x:-8,y:-5},{x:47,y:100},{x:160,y:-60}];const flags=[false,true,true,true,false];
 const render=(round,whole)=>{let current=null;const p=[];const rec={
 moveTo(x,y){current={x,y};p.push(current)},lineTo(x,y){current={x,y};p.push(current)},closePath(){},
 bezierCurveTo(x1,y1,x2,y2,x,y){if(!current){this.moveTo(x,y);return;}const a=current;for(let i=1;i<=16;i++){const t=i/16,u=1-t;p.push({x:u*u*u*a.x+3*u*u*t*x1+3*u*t*t*x2+t*t*t*x,y:u*u*u*a.y+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y});}current={x,y};},
 quadraticCurveTo(x1,y1,x,y){if(!current){this.moveTo(x,y);return;}const a=current;for(let i=1;i<=16;i++){const t=i/16,u=1-t;p.push({x:u*u*a.x+2*u*t*x1+t*t*x,y:u*u*a.y+2*u*t*y1+t*t*y});}current={x,y};}};
 splinePathForDraw(rec,pts,false,round,flags,[],whole,1,0,{...layer,wholeCurveSpline:whole});return p;};
 const d=(v,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,s=Math.max(0,Math.min(1,((v.x-a.x)*dx+(v.y-a.y)*dy)/Math.max(1e-10,dx*dx+dy*dy)));return Math.hypot(v.x-a.x-s*dx,v.y-a.y-s*dy);};
 const haus=(A,B)=>{const one=(x,y)=>{let max=0;for(let i=0;i<x.length;i+=Math.max(1,Math.floor(x.length/220))){let v=Infinity;for(let j=1;j<y.length;j++)v=Math.min(v,d(x[i],y[j-1],y[j]));max=Math.max(max,v);}return max;};return Math.max(one(A,B),one(B,A));};
 const levels=[0,.000009,.000011,.0001,.005,.01,.03,.05999,.06001];const data=[];
 for(const whole of [false,true]){const shapes=levels.map(t=>render(t,whole));const steps=[];for(let i=1;i<shapes.length;i++)steps.push({from:levels[i-1],to:levels[i],distance:haus(shapes[i-1],shapes[i])});data.push({whole,steps});}
 return data;})()`,{label:'11.0.8 zero-to-spline fillet continuity',timeoutMs:60000});
 for(const r of data){
  const gate=r.steps.find(v=>v.from===.000009);const first=r.steps.find(v=>v.from===0),last=r.steps.at(-1);
  assert(gate.distance<1,`original spline-to-fillet switching ${JSON.stringify({r:r.whole,gate})}`);
  assert(first.distance<1,`nonzero rounding pop ${JSON.stringify({r:r.whole,first})}`);
  assert(last.distance<1,`fade completion pop ${JSON.stringify({r:r.whole,last})}`);
 }
 assert.deepEqual(uncaughtExceptions(h.events),[]);console.log('PASS 11.0.8: low-round spline curves remain geometrically continuous, '+JSON.stringify(data));
 }finally{await h.close();}})().catch(e=>{console.error('FAIL low-round spline',e.stack||e);process.exitCode=1});
