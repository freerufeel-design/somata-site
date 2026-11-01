'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const cx=vm.createContext({Math,Number});vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/geometry/spline-corner-mode.js'),'utf8'),cx);
const P=[[100,0],[90,80],[35,150],[-55,110],[-120,20],[-80,-90],[10,-160],[100,-70]];
const Q=[[100,0],[65,-90],[-45,-125],[-145,-40],[-105,85],[0,130],[105,65],[75,-15]];
const pts=t=>P.map((p,i)=>({x:p[0]*(1-t)+Q[i][0]*t,y:p[1]*(1-t)+Q[i][1]*t}));
const area=poly=>poly.reduce((a,p,i)=>{const q=poly[(i+1)%poly.length];return a+p.x*q.y-p.y*q.x},0);
let low=0,high=1;const originalPositive=area(pts(0))>0;
for(let i=0;i<60;i++){const m=(low+high)/2;if((area(pts(m))>0)===originalPositive)low=m;else high=m;}
const midpoint=(low+high)/2;
const draw=(t,strength,guard)=>{
 const rows=[],rec={moveTo:(...r)=>rows.push(['M',...r]),bezierCurveTo:(...r)=>rows.push(['C',...r]),lineTo:(...r)=>rows.push(['L',...r]),closePath:()=>rows.push(['Z'])};
 cx.somataDrawSplineCornerMode(rec,pts(t),true,strength,{layer:{roundingShape:'hybrid',roundingMaxRadiusDrop:guard}});return rows;
};
let maxDelta=0,pairs=0;
for(const strength of [.01,.15,.5,1,1.001,1.25,1.5,1.75,1.999999,2]){
 const a=draw(midpoint-1e-7,strength,0),b=draw(midpoint+1e-7,strength,0);
 assert.equal(a.length,b.length,'no topology changes when signed polygon area changes');
 for(let i=0;i<a.length;i++){
  assert.equal(a[i][0],b[i][0]);
  for(let j=1;j<a[i].length;j++)if(typeof a[i][j]==='number')maxDelta=Math.max(maxDelta,Math.abs(a[i][j]-b[i][j]));
 }
 assert.deepEqual(draw(midpoint+.03,strength,0),draw(midpoint+.03,strength,90),'old exterior radius guard must have no effect in radial mode');
 pairs++;
}
assert(maxDelta<.001,`phase teleport around vanishing signed area: ${maxDelta}`);
console.log('PASS reversal-safe circular target',JSON.stringify({signedAreaNegative:area(pts(midpoint+1e-7)),signedAreaPositive:area(pts(midpoint-1e-7)),maxFrameDelta:maxDelta,pairs}));
