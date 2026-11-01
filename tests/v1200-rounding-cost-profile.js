'use strict';
const fs=require('fs');
const {performance}=require('perf_hooks');
const path=require('node:path').resolve(__dirname,'../js/geometry/unified-fillet.js');
let src=fs.readFileSync(path,'utf8');
const inject=(key,section)=>{if(!src.includes(key))throw Error('missing '+key);src=src.replace(key,section+'\n'+key);};
inject('    const pts=raw||[],count=pts.length;','    __mark("start");');
inject('    const n=rail.length;','    __mark("samples");');
inject('    const length=arc[edges];','    __mark("arclength");');
inject('    const calc=(s,side=1,w=width)=>{','    __mark("events");');
inject('    // For a near-zero loss budget,','    __mark("radius guard");');
inject('    const finalSupport=new Float64Array(basis.length);','    __mark("knots");');
inject('    if(closed)ctx.closePath();','    __mark("cubics");');
let timings={};let prev=performance.now();function mark(s){let now=performance.now();if(s==='start')prev=now;else{(timings[s]??=[]).push(now-prev);prev=now;}}
const controls=(p0,p1,p2,p3)=>({c1:{x:p1.x+(p2.x-p0.x)/6,y:p1.y+(p2.y-p0.y)/6},c2:{x:p2.x-(p3.x-p1.x)/6,y:p2.y-(p3.y-p1.y)/6}});
const draw=new Function('__mark','centripetalSplineBezierControls',src+';return drawUnifiedFilletPath;')(mark,controls);
function med(a){a.sort((a,b)=>a-b);return a[a.length>>1]||0;}
let ncmd=0;const ctx={moveTo(){},bezierCurveTo(){ncmd++},closePath(){}};
function profile(name,n,spline,skip,rounding=1.2,rep=5){
 const points=Array.from({length:n},(_,i)=>{let a=i*2*Math.PI/n,r=name==='circle'?100:name==='wave'?85+22*Math.sin(6*a):i%2?35:100;return {x:r*Math.cos(a),y:r*Math.sin(a)};});
 const flags=points.map(()=>true), opts={baseEdge:70,maxRadiusDrop:30,spline,skipRadiusSearch:skip};
 for(let i=0;i<2;i++)draw(ctx,points,true,rounding,flags,opts);
 timings={};ncmd=0;
 const total=[];
 for(let i=0;i<rep;i++){let start=performance.now();draw(ctx,points,true,rounding,flags,opts);total.push(performance.now()-start);}
 const out={shape:name,n,spline,skip,rounding,ms:+med(total).toFixed(3),beziers:Math.round(ncmd/rep)};
 for(const k of ['samples','arclength','events','radius guard','knots','cubics'])out[k]=+med(timings[k]||[]).toFixed(3);
 console.log(JSON.stringify(out));
}
for(const n of [300,1000,5000])for(const shape of ['circle','wave','saw'])profile(shape,n,false,false,1.2,n===5000?3:5);
for(const shape of ['circle','wave'])for(const skip of [false,true])profile(shape,1000,false,skip,1.2,5);
for(const n of [100,300])for(const shape of ['circle','wave'])profile(shape,n,true,false,1.2,3);
