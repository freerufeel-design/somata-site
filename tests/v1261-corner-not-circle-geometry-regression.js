'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {performance}=require('node:perf_hooks');
const cx=vm.createContext({Math,Number});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/geometry/spline-corner-mode.js'),'utf8'),cx);
function draw(pts,closed,value,layer={}){
 const rows=[],rec={moveTo:(...x)=>rows.push(['M',...x]),lineTo:(...x)=>rows.push(['L',...x]),bezierCurveTo:(...x)=>rows.push(['C',...x]),closePath:()=>rows.push(['Z'])};
 assert(cx.somataDrawSplineCornerMode(rec,pts,closed,value,{layer:{roundingShape:'hybrid',N:9,radius:165,roundingMaxRadiusDrop:0,...layer}}));
 return rows;
}
function star(teeth=9,outer=165,inner=48,phase=0){return Array.from({length:teeth*2},(_,i)=>{let a=phase+i*Math.PI/teeth,r=i%2?inner:outer;return{x:r*Math.cos(a),y:r*Math.sin(a)}});}
function circleError(rows,centerR){const cubics=rows.filter(r=>r[0]==='C');const knots=cubics.map(r=>({x:r[5],y:r[6]}));return Math.max(...knots.map(p=>Math.abs(Math.hypot(p.x,p.y)-centerR)))/centerR;}
function maxChange(rowsA,rowsB){assert.equal(rowsA.length,rowsB.length);let delta=0;for(let i=0;i<rowsA.length;i++){const a=rowsA[i],b=rowsB[i];assert.equal(a[0],b[0]);for(let j=1;j<a.length;j++)delta=Math.max(delta,Math.abs(a[j]-b[j]));}return delta;}
let shapes=0,joints=0,seams=0,frames=0,finite=0;
for(const closed of [true,false])for(const n of [3,4,7,9,18,48,128,512])for(const k of [.33,.65,1.1]){
 const pts=star(n,165,165*k,.2);
 const zero=draw(pts,closed,0);
 assert.equal(zero.filter(c=>c[0]==='L').length,pts.length-1);assert(!zero.some(c=>c[0]==='C'));
 const before100=draw(pts,closed,1-1e-6),at100=draw(pts,closed,1),after100=draw(pts,closed,1+1e-6);
 assert(maxChange(before100,at100)<.05);assert(maxChange(at100,after100)<.05);seams+=2;
 for(const value of [.000001,.025,.1,.25,.5,.75,1,1.1,1.5,1.75,1.999999,2]){
  const rows=draw(pts,closed,value);const cubics=rows.filter(c=>c[0]==='C');
  assert.equal(cubics.length,closed?pts.length:pts.length-1);
  assert(rows.slice(1).every(c=>c.slice(1).every(Number.isFinite)));finite+=cubics.length;
  // C0 and G1: both handles at a knot have the same forward direction.
  for(let i=1;i<cubics.length;i++){
   const prev=cubics[i-1],next=cubics[i],p={x:prev[5],y:prev[6]};
   const ax=p.x-prev[3],ay=p.y-prev[4],bx=next[1]-p.x,by=next[2]-p.y;
   const scale=Math.hypot(ax,ay)*Math.hypot(bx,by);
   if(scale>1e-15){assert((ax*bx+ay*by)/scale>.99999999,`G1 n${n} v${value} at${i}`);joints++;}
  }
  if(closed){const prev=cubics.at(-1),next=cubics[0],p={x:prev[5],y:prev[6]};
   const ax=p.x-prev[3],ay=p.y-prev[4],bx=next[1]-p.x,by=next[2]-p.y;
   const scale=Math.hypot(ax,ay)*Math.hypot(bx,by);
   if(scale>1e-15){assert((ax*bx+ay*by)/scale>.99999999);joints++;}
  }
  // No dependence on legacy exterior-radius clipping in new radial/corner mode.
  assert.deepEqual(rows,draw(pts,closed,value,{roundingMaxRadiusDrop:90}));
  shapes++;
 }
 // Continuous across tiny changes in actual source points during Morph phase.
 for(let f=0;f<40;f++){
  const p=pts.map((a,i)=>({x:a.x+(i%3===0?1:-.5)*f*1e-5,y:a.y+(i%5===0?-1:.5)*f*1e-5}));
  const q=pts.map((a,i)=>({x:a.x+(i%3===0?1:-.5)*(f+1e-5)*1e-5,y:a.y+(i%5===0?-1:.5)*(f+1e-5)*1e-5}));
  for(const v of [.1,.5,1,1.5,1.99]){assert(maxChange(draw(p,closed,v),draw(q,closed,v))<.005);frames++;}
 }
}
// Regression: the original 12.6 projected to a circle already at 100%.
// The replacement must NOT be a circle at 100%, and it must never use circle
// radial interpolation before the exact 100% boundary.
const sharp=star(9,165,48,-Math.PI/2);
const r100=draw(sharp,true,1),r125=draw(sharp,true,1.25),r200=draw(sharp,true,2);
assert(circleError(r100,165)>.08,`at 100% still needs original silhouette, err ${circleError(r100,165)}`);
assert(circleError(r125,165)<circleError(r100,165),'125% must start converging to circle');
assert(circleError(r200,165)<2e-12,'200% must be circle at knots');
assert.notDeepEqual(draw(sharp,true,.5),r100);
assert.notDeepEqual(draw(sharp,true,.25),draw(sharp,true,.5));
const open=draw(sharp,false,2);assert.equal(open.some(c=>c[0]==='Z'),false);
const t=[];const dense=star(1500,165,90);for(let i=0;i<18;i++){const start=performance.now();draw(dense,true,1);if(i>=4)t.push(performance.now()-start)}t.sort((a,b)=>a-b);
console.log('PASS true contour-space rounding',JSON.stringify({shapes,joints,seams,frames,finite,starRadialError100:circleError(r100,165),starRadialError125:circleError(r125,165),starRadialError200:circleError(r200,165),medianMs3000:t[Math.floor(t.length/2)]}));
