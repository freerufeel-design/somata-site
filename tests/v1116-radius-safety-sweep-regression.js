const fs=require('fs'),vm=require('vm');const assert=require('node:assert/strict'),path=require('node:path');vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../js/geometry/unified-fillet.js'),'utf8'));
let seed=5673,rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32};
let bad=[],total=0;
for(let k=0;k<1000;k++){
 let n=4+Math.floor(rng()*13),closed=rng()>.5,shape=Math.floor(rng()*4),pts=Array.from({length:n},(_,i)=>{
  let a=2*Math.PI*i/(closed?n:n-1),r=(shape===1&&i%2?15:35)+rng()*75;
  if(shape===2){a*=1.8;r=15+90*i/n}if(shape===3){a=2*Math.PI*i/(closed?n:n-1);r=60+(rng()-.5)*70}
  return {x:r*Math.cos(a),y:r*Math.sin(a)};
 });
 let flags=pts.map((_,i)=>closed||i>0&&i<n-1?rng()>.25:false);
 if(!flags.some(Boolean))flags[Math.floor(n/2)]=true;
 let originalR=Math.max(...pts.map(q=>Math.hypot(q.x,q.y)));
 let p=null,radius=0;const original=JSON.stringify(pts);
 const upd=(x,y)=>{let rr=Math.hypot(x,y);if(rr>radius)radius=rr};
 const ctx={moveTo(x,y){p={x,y};upd(x,y)},bezierCurveTo(a,b,c,d,x,y){for(let j=1;j<=35;j++){let t=j/35,u=1-t;upd(u*u*u*p.x+3*u*u*t*a+3*u*t*t*c+t*t*t*x,u*u*u*p.y+3*u*u*t*b+3*u*t*t*d+t*t*t*y)}p={x,y}},closePath(){}};
 let drop=30,amount=.1+rng()*1.9;
 if(!drawUnifiedFilletPath(ctx,pts,closed,amount,flags,{baseEdge:100,maxRadiusDrop:drop}))continue;
 assert.equal(JSON.stringify(pts),original,'fillet modified Morph anchor positions');
 let floor=originalR*.7;
 if(radius<floor-.2){bad.push({k,originalR,radius,loss:(originalR-radius)/originalR,pts,flags,closed,amount});if(bad.length>10)break}
 total++;
}
assert.equal(bad.length,0,`outer radius budget violated: ${JSON.stringify(bad[0])}`);
assert(total>=950,'insufficient generated profiles');
console.log(`PASS 11.0.16: ${total} randomized exterior-radius budget and input-immutability checks`);
