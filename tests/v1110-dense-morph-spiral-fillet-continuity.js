'use strict';
// Dense rails formerly switched the visible fillet family at 1601 vertices.
// Check count continuity and preserved geometry, not just a successful draw.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../js/geometry/unified-fillet.js'),'utf8'));
const lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
function draw(points,flags,closed,round){
 const commands=[];let q=null,first=null;
 const ctx={moveTo(x,y){q={x,y};first=q;commands.push(['M',x,y]);},
 bezierCurveTo(x1,y1,x2,y2,x,y){for(const v of [x1,y1,x2,y2,x,y])assert(Number.isFinite(v));q={x,y};commands.push(['C',x1,y1,x2,y2,x,y]);},
 closePath(){commands.push(['Z']);q=first;}};
 assert.equal(drawUnifiedFilletPath(ctx,points,closed,round,flags,{layer:{N:4,radius:100,roundingMaxRadiusDrop:30}}),true,
     `dense ${closed?'closed':'open'} rail fell back at ${points.length}`);
 const pts=[];let pen=null,start=null,maxR=0;
 const emit=p=>{pts.push(p);maxR=Math.max(maxR,Math.hypot(p.x,p.y));};
 for(const c of commands){
  if(c[0]==='M'){pen={x:c[1],y:c[2]};start=pen;emit(pen);}
  else if(c[0]==='C'){
   const a=pen;for(let j=1;j<=3;j++){
    const t=j/3,u=1-t;
    emit({x:u*u*u*a.x+3*u*u*t*c[1]+3*u*t*t*c[3]+t*t*t*c[5],
          y:u*u*u*a.y+3*u*u*t*c[2]+3*u*t*t*c[4]+t*t*t*c[6]});
   }
   pen={x:c[5],y:c[6]};
  }else if(c[0]==='Z'&&start)emit(start);
 }
 const cumulative=[0];for(let i=1;i<pts.length;i++)cumulative.push(cumulative[i-1]+Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y));
 const total=cumulative.at(-1);
 const at=t=>{const s=t*total;let l=0,r=cumulative.length-1;while(l<r){let m=(l+r)>>1;if(cumulative[m]<s)l=m+1;else r=m;}
  if(l===0)return pts[0];const a=cumulative[l-1],b=cumulative[l],u=(s-a)/Math.max(1e-12,b-a);return lerp(pts[l-1],pts[l],u);};
 return {maxR,pts,at,count:commands.length,total};
}
const corners=[{x:100,y:100},{x:-100,y:100},{x:-100,y:-100},{x:100,y:-100}];
// Split each base edge into 400 distinct samples; one extra point within an
// existing straight span must not trigger another geometry algorithm.
const makeSquare=(extra=0)=>{
 const pts=[],flags=[];
 for(let i=0;i<4;i++)for(let k=0;k<400;k++){
  const u=k/400;pts.push(lerp(corners[i],corners[(i+1)%4],u));flags.push(k===0);
 }
 if(extra){pts.splice(150,0,lerp(pts[149],pts[150],.5));flags.splice(150,0,false);}
 return {pts,flags};
};
const spiral=(count)=>{
 const pts=Array.from({length:count},(_,i)=>{const t=i/(count-1),a=t*Math.PI*4.3,r=15+95*t;return{x:r*Math.cos(a),y:r*Math.sin(a)};});
 return {pts,flags:pts.map((_,i)=>i>0&&i<count-1)};
};
let checks=0,maxDenseChange=0;
for(const round of [.1,.5,1,1.3,1.8,2]){
 const a=makeSquare(),b=makeSquare(1),x=draw(a.pts,a.flags,true,round),y=draw(b.pts,b.flags,true,round);
 let error=0;for(let k=0;k<=1000;k++){
  const p=x.at(k/1000),q=y.at(k/1000);error=Math.max(error,Math.hypot(p.x-q.x,p.y-q.y));
 }
 maxDenseChange=Math.max(maxDenseChange,error);
 assert(error<.08,`additional collinear knot moved the rounded square (${round}): ${error}`);
 checks++;
}
for(const count of [1598,1599,1600,1601,1602,1800,2500,5000])for(const closed of [false,true]){
 const {pts,flags}=spiral(count),out=draw(pts,flags,closed,1.4);
 const sourceR=Math.max(...pts.map(p=>Math.hypot(p.x,p.y)));
 assert(out.maxR>=sourceR*.69-1,`outer radius collapsed: ${count}, ${closed}`);
 assert(out.maxR<sourceR*1.4+1,`spike on dense spiral: ${count}, ${closed}`);
 checks++;
}
console.log(`PASS 11.0.10: ${checks} dense fillet checks, knot-count boundary 1600/1601, open/closed spirals, max collinear drift ${maxDenseChange.toFixed(6)}`);
