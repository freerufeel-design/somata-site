'use strict';
// Partial fillet activation must not leave a visible cusp on a rounded corner.
// The source rails and the open-endpoint anchors must remain untouched.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
vm.runInThisContext(fs.readFileSync(process.env.SOMATA_FILLET_SOURCE || path.join(__dirname,'../js/geometry/unified-fillet.js'),'utf8'));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function trace(points,closed,round,skipRadiusSearch){
  const commands=[];const ctx={moveTo(x,y){commands.push(['M',x,y]);},bezierCurveTo(...v){assert(v.every(Number.isFinite),'NaN/Infinity');commands.push(['C',...v]);},closePath(){commands.push(['Z']);}};
  const flags=points.map((_,i)=>closed|| (i>0&&i<points.length-1));
  const old=JSON.stringify(points);
  assert(drawUnifiedFilletPath(ctx,points,closed,round,flags,{baseEdge:100,maxRadiusDrop:30,skipRadiusSearch}));
  assert.equal(JSON.stringify(points),old,'source Morph anchors were mutated');
  if(!closed){
    const start={x:commands[0][1],y:commands[0][2]},last=commands.filter(c=>c[0]==='C').at(-1);
    assert(dist(start,points[0])<1e-7,'open start moved');
    assert(dist({x:last[5],y:last[6]},points.at(-1))<1e-7,'open end moved');
  }
  let maxAngle=0,joins=0;
  for(let i=2;i<commands.length;i++){
    let a=commands[i-1],b=commands[i];if(a[0]!=='C'||b[0]!=='C')continue;
    const v={x:a[5]-a[3],y:a[6]-a[4]},w={x:b[1]-a[5],y:b[2]-a[6]};
    const len1=Math.hypot(v.x,v.y),len2=Math.hypot(w.x,w.y);
    if(len1<1e-9||len2<1e-9)continue;
    const angle=Math.abs(Math.atan2(v.x*w.y-v.y*w.x,v.x*w.x+v.y*w.y))*180/Math.PI;
    maxAngle=Math.max(maxAngle,angle);joins++;
    assert(angle<.005,`visible kink ${angle.toFixed(3)} degrees at cubic join ${i} round=${round} closed=${closed}`);
  }
  return {maxAngle,joins,commands};
}
let checks=0,totalJoins=0,max=0;
const openProfiles=[];
for(const near of [2,4,6,10,16,24]){
  openProfiles.push([{x:0,y:0},{x:near,y:0},{x:near,y:40},{x:60,y:50}]);
  openProfiles.push([{x:0,y:0},{x:near,y:5},{x:near+3,y:-15},{x:60,y:30},{x:60+near,y:31}]);
}
for(const n of [6,10,16]){
 const spiral=Array.from({length:n},(_,i)=>{const t=i/(n-1),a=2.3*Math.PI*t;return {x:(2+55*t)*Math.cos(a),y:(2+55*t)*Math.sin(a)};});
 openProfiles.push(spiral);
}
for(const points of openProfiles)for(const round of [.25,.5,1,1.5,2])for(const skipRadiusSearch of [false,true]){
 const r=trace(points,false,round,skipRadiusSearch);max=Math.max(max,r.maxAngle);totalJoins+=r.joins;checks++;
}
for(const count of [4,5,9,15]){
 const points=Array.from({length:count},(_,i)=>{const a=2*Math.PI*i/count,r=i%2?30:80;return{x:r*Math.cos(a),y:r*Math.sin(a)}});
 for(const round of [.25,1,2])for(const skipRadiusSearch of [false,true]){
  const r=trace(points,true,round,skipRadiusSearch);max=Math.max(max,r.maxAngle);totalJoins+=r.joins;checks++;
 }
}
console.log(`PASS 11.0.14 tangent continuity: ${checks} curves, ${totalJoins} verified cubic joins, maximum deviation ${max.toExponential(2)} degrees`);
