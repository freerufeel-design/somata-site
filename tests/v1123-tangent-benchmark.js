'use strict';
// Measures only geometric construction (not browser frame rate).
const fs=require('node:fs'),path=require('node:path');
const {performance}=require('node:perf_hooks');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js/geometry/spline.js'),'utf8');
const spline=new Function('window',source+'\nreturn centripetalSplineBezierControls;')({__spiroRegisterModule(){}});
const load=(filename)=>new Function('centripetalSplineBezierControls',fs.readFileSync(filename,'utf8')+'\nreturn drawUnifiedFilletPath;')(spline);
const old=load(path.join(__dirname,'fixtures/v1123-unified-fillet-1122.js'));
const current=load(path.join(root,'js/geometry/unified-fillet.js'));
const ctx={moveTo(){},bezierCurveTo(){},closePath(){}};
function pathPoints(n,kind){return Array.from({length:n},(_,i)=>{
 const a=i/n*2*Math.PI,r=kind==='circle'?100:kind==='wave'?85+25*Math.sin(6*a):i%2?22:100;
 return {x:r*Math.cos(a),y:r*Math.sin(a)};
});}
function median(values){return values.sort((a,b)=>a-b)[values.length>>1];}
function measure(fn,points,splineMode){const flags=points.map(()=>true),opts={baseEdge:100,maxRadiusDrop:30,spline:splineMode,wholeCurveSpline:splineMode};
 for(let k=0;k<3;k++)fn(ctx,points,true,1.7,flags,opts);
 const out=[];for(let k=0;k<13;k++){let t=performance.now();fn(ctx,points,true,1.7,flags,opts);out.push(performance.now()-t)}
 return median(out);
}
console.log('profile | knots | spline | 11.0.22 ms | 11.0.23 ms | speedup');
for(const [kind,n,spline] of [['circle',600,true],['wave',300,true],['saw',600,true],['circle',2000,false],['wave',2000,false],['circle',5000,false],['wave',5000,false]]){
 const pts=pathPoints(n,kind),a=measure(old,pts,spline),b=measure(current,pts,spline);
 console.log(`${kind} | ${n} | ${spline} | ${a.toFixed(3)} | ${b.toFixed(3)} | ${(a/b).toFixed(2)}x`);
}
