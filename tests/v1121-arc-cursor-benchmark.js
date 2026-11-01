'use strict';
// Geometric build time only, not UI FPS: warm runs, exact same inputs for both kernels.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const spline=new Function('window',fs.readFileSync(path.join(__dirname,'../js/geometry/spline.js'),'utf8')+
 '\nreturn centripetalSplineBezierControls;')({__spiroRegisterModule(){}});
const load=file=>new Function('centripetalSplineBezierControls',fs.readFileSync(file,'utf8')+'\nreturn drawUnifiedFilletPath;')(spline);
const before=load(path.join(__dirname,'fixtures/v1121-unified-fillet-1120.js'));
const after=load(path.join(__dirname,'../js/geometry/unified-fillet.js'));
const ctx={moveTo(){},bezierCurveTo(){},closePath(){}};
const make=(n,kind)=>Array.from({length:n},(_,i)=>{
 const a=i*2*Math.PI/n,r=kind==='wave'?85+25*Math.sin(6*a):kind==='saw'?(i%2?22:100):100;
 return {x:r*Math.cos(a),y:r*Math.sin(a)};
});
function median(a){a.sort((x,y)=>x-y);return a[Math.floor(a.length/2)]}
function bench(fn,pts,splineMode){const flags=pts.map(()=>true),opts={baseEdge:100,maxRadiusDrop:30,
 spline:splineMode,wholeCurveSpline:splineMode};
 for(let i=0;i<5;i++)assert(fn(ctx,pts,true,1.7,flags,opts));
 const results=[];for(let i=0;i<17;i++){const t=performance.now();fn(ctx,pts,true,1.7,flags,opts);results.push(performance.now()-t)}
 return median(results);
}
console.log('Profile | knots | spline | 11.0.20 ms | 11.0.21 ms | speedup');
for(const [kind,n,splineMode] of [['wave',300,true],['saw',600,true],['circle',600,true],['wave',2000,false],['circle',2000,false],['saw',2000,false]]){
 const pts=make(n,kind),a=bench(before,pts,splineMode),b=bench(after,pts,splineMode);
 console.log(`${kind} | ${n} | ${splineMode} | ${a.toFixed(3)} | ${b.toFixed(3)} | ${(a/b).toFixed(2)}x`);
}
