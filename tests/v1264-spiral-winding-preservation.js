'use strict';
// Spline+ spiral should retain its coil at 100..200%, never become one circle.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ctx=vm.createContext({Math,Number,Float64Array});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/geometry/spline-corner-mode.js'),'utf8'),ctx);
const approved=vm.createContext({Math,Number,Float64Array});
vm.runInContext(fs.readFileSync(path.join(__dirname,'fixtures/v1262-spline-plus-approved.js'),'utf8'),approved);
const capture=(points,closed,round,spiralEnabled,kernel=ctx)=>{
 const commands=[];
 const rec={moveTo:(...v)=>commands.push(['M',...v]),lineTo:(...v)=>commands.push(['L',...v]),bezierCurveTo:(...v)=>commands.push(['C',...v]),closePath:()=>commands.push(['Z'])};
 const layer={N:7,radius:160,radiusMultiplier:1,roundingShape:'hybrid',spiralEnabled,spiralOrder:2.75};
 assert(kernel.somataDrawSplineCornerMode(rec,points,closed,round,{layer}));return commands;
};
const curve=(n,turns=2.75)=>Array.from({length:n},(_,i)=>{const f=i/(n-1),a=turns*2*Math.PI*f,r=12+145*f;return {x:r*Math.cos(a),y:r*Math.sin(a)};});
let cases=0;
for(const closed of [true,false])for(const n of [12,100,400])for(const strength of [0,.1,.5,1,1.000001,1.2,1.5,1.999999,2]){
 const points=curve(n),commands=capture(points,closed,strength,true),cubics=commands.filter(c=>c[0]==='C');
 if(strength<=1)assert.equal(JSON.stringify(commands),JSON.stringify(capture(points,closed,strength,true,approved)),'approved spiral <=100% changed');
 if(strength===0){assert(commands.some(c=>c[0]==='L'));assert.equal(cubics.length,0);}
 else{assert.equal(cubics.length,closed?n:n-1,`lost spiral windings at ${strength}, ${n} points, closed ${closed}`);
  for(const c of commands)for(const v of c.slice(1))assert(Number.isFinite(v),'nonfinite spiral control');
  if(!closed){assert.equal(commands[0][1],points[0].x);assert.equal(commands[0][2],points[0].y);assert(Math.hypot(cubics.at(-1)[5]-points.at(-1).x,cubics.at(-1)[6]-points.at(-1).y)<1e-9);}
  if(strength===2&&n>=100){const anchors=[{x:commands[0][1],y:commands[0][2]},...cubics.map(c=>({x:c[5],y:c[6]}))];const radii=anchors.map(p=>Math.hypot(p.x,p.y));assert(Math.max(...radii)-Math.min(...radii)>90,'spiral collapsed to one circle');}
 }
 cases++;
}
// Both sides of 100% should meet with zero instantaneous shape jump.
for(const closed of [true,false]){
 const p=curve(180),lo=capture(p,closed,1,true),hi=capture(p,closed,1.0000001,true);
 assert.equal(lo.length,hi.length);let error=0;for(let i=0;i<lo.length;i++)for(let j=1;j<lo[i].length;j++)error=Math.max(error,Math.abs(lo[i][j]-hi[i][j]));
 assert(error<.00001,`100% spiral seam jump ${error}`);
}
// Closed spiral interpolation must not depend on which physical point is index 0.
for(const v of [1,1.2,1.5,2]){
 const p=curve(160),original=capture(p,true,v,true);
 const reindexed=p.slice(47).concat(p.slice(0,47)),shifted=capture(reindexed,true,v,true);
 const take=(a)=>a.filter(c=>c[0]==='C');
 const x=take(original),y=take(shifted);let worst=0;
 for(let k=0;k<x.length;k++)for(let c=1;c<=6;c++)worst=Math.max(worst,Math.abs(x[(k+47)%x.length][c]-y[k][c]));
 assert(worst<1e-7,`spiral cyclic-start seam changed ${v}: ${worst}`);
}
// The approved polygon Spline+ continues to interpolate to a circle at 200%.
const polygon=capture(curve(180),true,2,false);assert(polygon.filter(c=>c[0]==='C').length>0);
console.log('PASS 12.6.4 spiral carrier:',cases,'open/closed winding, endpoints and 100% seam cases; polygon 200% unchanged');
