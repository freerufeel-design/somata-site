'use strict';
// Phase-boundary reproduction: switching the starting vertex is NOT a new
// geometry. A display fillet must be invariant to cyclic reindexing.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const sandbox=vm.createContext({Math,Number});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/geometry/spline-corner-mode.js'),'utf8'),sandbox);
function render(points,percentage){
 const rows=[],ctx={moveTo:(...p)=>rows.push(['M',...p]),lineTo:(...p)=>rows.push(['L',...p]),bezierCurveTo:(...p)=>rows.push(['C',...p]),closePath:()=>rows.push(['Z'])};
 assert(sandbox.somataDrawSplineCornerMode(ctx,points,true,percentage/100,{layer:{roundingShape:'hybrid',N:8,radius:150}}));
 return rows;
}
function shape(n,kind){return Array.from({length:n},(_,i)=>{
 const theta=i*2*Math.PI/n;
 const r=kind===0?150:kind===1?(i%2?45:145):kind===2?75+65*Math.sin(i*1.414+2)*Math.sin(5*theta):kind===3?75+65*Math.sin(i*1.414+3)*Math.sin(5*theta):75+65*Math.sin(i*1.414+4)*Math.sin(5*theta);
 return {x:r*Math.cos(theta),y:r*Math.sin(theta)};
});}
function compareCyclic(a,b,shift){
 const A=a.filter(row=>row[0]==='C'),B=b.filter(row=>row[0]==='C');
 assert.equal(A.length,B.length);
 // At exactly 200%, a well-sampled profile is allowed the 16-cubic
 // fast path. It must be independent of index in that case.
 if(A.length===16 && A.length!==shift.size && shift.value===200){return compareFixed(A,B);}
 let worst=0;
 for(let i=0;i<A.length;i++)for(let j=1;j<7;j++){
  const x=A[(i+shift.start)%A.length][j],y=B[i][j];
  worst=Math.max(worst,Math.abs(x-y));
 }
 return worst;
}
function compareFixed(A,B){let worst=0;for(let i=0;i<A.length;i++)for(let j=1;j<7;j++)worst=Math.max(worst,Math.abs(A[i][j]-B[i][j]));return worst;}
let cases=0,maxError=0;
for(const n of [5,8,11,24,80,160])for(let kind=0;kind<5;kind++){
 const points=shape(n,kind);
 for(const percentage of [1,10,50,100,120,150,175,199,200]){
  const A=render(points,percentage);
  for(const step of [1,Math.floor(n/3)]){
   const B=render(points.slice(step).concat(points.slice(0,step)),percentage);
   const error=compareCyclic(A,B,{start:step,size:n,value:percentage});
   assert(error<1e-6,`phase seam shifted ${step} original vertices: n=${n} kind=${kind} rounded=${percentage}% error=${error}`);
   maxError=Math.max(maxError,error);cases++;
  }
 }
}
// An actual neighbouring frame may also move vertices by a tiny amount.
// The index change must not amplify that motion into a shape teleport.
let neighbours=0,maxNear=0;
for(const n of [5,11,24,160])for(const kind of [1,2,4])for(const percentage of [10,75,120,150,175,199,200]){
 const pts=shape(n,kind),dx=.000001,dy=-.000001;
 const A=render(pts,percentage),moved=pts.map(p=>({x:p.x+dx,y:p.y+dy}));
 const k=Math.floor(n/3),B=render(moved.slice(k).concat(moved.slice(0,k)),percentage);
 const error=compareCyclic(A,B,{start:k,size:n,value:percentage});
 assert(error<.005,`tiny frame displacement amplified near phase seam: ${n}/${kind}/${percentage}: ${error}`);
 maxNear=Math.max(maxNear,error);neighbours++;
}
console.log('PASS 12.6.2 closed Morph index/phase seam',JSON.stringify({cases,neighbours,maxError,maxNear}));
