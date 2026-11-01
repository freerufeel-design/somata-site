'use strict';
// The newly introduced DRAW-ONLY corner weights must preserve the fillet's
// own C1/G1 joins and the original open endpoints; never move Morph anchors.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../js/geometry/unified-fillet.js'),'utf8'));
let total=0,joins=0,maxAngle=0,maxEnd=0;
for(const closed of [false,true])for(const spline of [false,true])for(const weight of [0.000001,.0001,.01,.1,.35,.7,.99,.999999,1])for(const rounding of [.1,.5,1,1.5,2]){
 const points=[{x:0,y:0},{x:90,y:0},{x:140,y:65},{x:205,y:5},{x:270,y:20},{x:310,y:80}];
 const original=JSON.stringify(points),flags=points.map((_,i)=> i===1||i===3 ? weight : true);
 const calls=[],ctx={moveTo(...c){calls.push(['M',...c]);},bezierCurveTo(...c){calls.push(['C',...c]);},closePath(){calls.push(['Z']);}};
 const valid=drawUnifiedFilletPath(ctx,points,closed,rounding,flags,{baseEdge:110,maxRadiusDrop:30,spline});
 assert(valid);assert.equal(JSON.stringify(points),original);
 const cs=calls.filter(c=>c[0]==='C');assert(cs.length>0);
 if(!closed){const m=calls[0],last=cs.at(-1),err=Math.max(Math.hypot(m[1]-points[0].x,m[2]-points[0].y),Math.hypot(last[5]-points.at(-1).x,last[6]-points.at(-1).y));maxEnd=Math.max(maxEnd,err);assert(err<1e-7);}
 for(let i=1;i<cs.length;i++){
  const a=cs[i-1],b=cs[i],vx=a[5]-a[3],vy=a[6]-a[4],wx=b[1]-a[5],wy=b[2]-a[6];
  if(Math.hypot(vx,vy)*Math.hypot(wx,wy)>1e-15){const angle=Math.abs(Math.atan2(vx*wy-vy*wx,vx*wx+vy*wy))*180/Math.PI;maxAngle=Math.max(maxAngle,angle);joins++;assert(angle<.01,`G1 kink ${angle}, closed=${closed}, spline=${spline}, weight=${weight}`);}
 }
 if(closed){
  const first=cs[0],last=cs.at(-1),anchor=calls[0];
  const dx=last[5]-last[3],dy=last[6]-last[4];
  const ex=first[1]-anchor[1],ey=first[2]-anchor[2];
  if(Math.hypot(dx,dy)*Math.hypot(ex,ey)>1e-15){
    const angle=Math.abs(Math.atan2(dx*ey-dy*ex,dx*ex+dy*ey))*180/Math.PI;
    maxAngle=Math.max(maxAngle,angle);joins++;assert(angle<.01,`Closed seam G1 kink ${angle}, weight=${weight}`);
  }
 }
 total++;
}
console.log(`PASS 11.0.24 fractional corner weights: ${total} cases, ${joins} G1 joins, max angle ${maxAngle.toExponential(2)} deg, max endpoint shift ${maxEnd.toExponential(2)}`);
