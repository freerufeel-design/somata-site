'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
vm.runInThisContext(fs.readFileSync(require('node:path').join(__dirname,'../js/geometry/unified-fillet.js'),'utf8'));
const lerp=(a,b,t)=>a+(b-a)*t;
function render(points,round,opts={}){
 const commands=[];let cursor=null,begin=null,maxR=0;
 const take=(x,y)=>{assert(Number.isFinite(x)&&Number.isFinite(y),'nonfinite location');maxR=Math.max(maxR,Math.hypot(x,y));};
 const c={
  moveTo(x,y){cursor={x,y};begin={x,y};take(x,y);commands.push(['M',x,y]);},
  lineTo(x,y){take(x,y);cursor={x,y};commands.push(['L',x,y]);},
  bezierCurveTo(x1,y1,x2,y2,x,y){
   for(const v of [x1,y1,x2,y2,x,y])assert(Number.isFinite(v),'nonfinite handle');
   const p=cursor;
   for(let i=0;i<=100;i++){
    const t=i/100,u=1-t;
    take(u*u*u*p.x+3*u*u*t*x1+3*u*t*t*x2+t*t*t*x,
         u*u*u*p.y+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y);
   }
   cursor={x,y};commands.push(['C',x1,y1,x2,y2,x,y]);
  },closePath(){commands.push(['Z']);cursor=begin;}
 };
 const flags=points.map(()=>true),used=drawUnifiedFilletPath(c,points,true,round,flags,{layer:{N:opts.N||Math.max(3,Math.ceil(points.length/2)),radius:opts.radius||100,roundingMaxRadiusDrop:opts.drop??30},...opts});
 return {used,commands,maxR};
}
const circle=(r,n)=>Array.from({length:n},(_,i)=>({x:r*Math.cos(i*2*Math.PI/n),y:r*Math.sin(i*2*Math.PI/n)}));
const sq=circle(100,4),tiny=[{x:100,y:0},{x:100.000001,y:0},{x:100.000002,y:.000001},{x:0,y:100},{x:-100,y:0},{x:0,y:-100}];
const star=Array.from({length:40},(_,i)=>{const a=i*2*Math.PI/40,r=i%2?40:100;return {x:r*Math.cos(a),y:r*Math.sin(a)};});
for(const p of [sq,tiny,star])for(const f of [.01,.02,.2,.5,.99,1,1.00001,1.1,1.5,1.9,1.99999,2]){
 const out=render(p,f);
 assert(out.used,`round not used at ${f}`);
 const original=Math.max(...p.map(v=>Math.hypot(v.x,v.y)));
 assert(out.maxR>=.7*original-1e-3,`excess radius reduction at ${f} ${out.maxR} vs ${original}`);
 assert(out.maxR<original*2,`extraneous horn ${f}: ${out.maxR}`);
 assert(out.commands.length>2);
}
const r0=render(sq,1.99999).maxR,r1=render(sq,2).maxR;
assert(Math.abs(r1-r0)<1,`200% contour jumped: ${r0} -> ${r1}`);
// Exactly 100% must NOT switch to a different full-loop spline. This used
// to displace the square contour by 25 px at the first global contact.
function sampledContour(commands){
 const out=[];let q=null,start=null;
 for(const c of commands){
  if(c[0]==='M'){q={x:c[1],y:c[2]};start=q;out.push(q);}
  else if(c[0]==='L'){q={x:c[1],y:c[2]};out.push(q);}
  else if(c[0]==='C'&&q){
   const p=q;
   for(let k=1;k<=100;k++){
    const t=k/100,u=1-t;
    out.push({x:u*u*u*p.x+3*u*u*t*c[1]+3*u*t*t*c[3]+t*t*t*c[5],
      y:u*u*u*p.y+3*u*u*t*c[2]+3*u*t*t*c[4]+t*t*t*c[6]});
   }
   q={x:c[5],y:c[6]};
  } else if(c[0]==='Z'&&start)out.push(start);
 }
 return out;
}
function contourDistance(a,b){
 const stepA=Math.max(1,Math.floor(a.length/180)),stepB=Math.max(1,Math.floor(b.length/180));
 const one=(x,y,step)=>Math.max(...x.filter((_,i)=>i%step===0)
  .map(p=>Math.min(...y.map(q=>Math.hypot(p.x-q.x,p.y-q.y)))));
 return Math.max(one(a,b,stepA),one(b,a,stepB));
}
for(const n of [3,4,6,8]){
 const p=circle(100,n),before=sampledContour(render(p,.999999,{N:n,drop:90}).commands),
       contact=sampledContour(render(p,1,{N:n,drop:90}).commands),
       after=sampledContour(render(p,1.000001,{N:n,drop:90}).commands);
 assert(contourDistance(before,contact)<2.5,`first full-contact fillet jump n=${n}`);
 assert(contourDistance(contact,after)<2.5,`just-after full-contact fillet jump n=${n}`);
}
// Changing the number and size of new micro-knots must not change the base edge.
const baseLayer={N:4,radius:100};
assert.equal(somataBaseEdge(baseLayer,sq,true),somataBaseEdge(baseLayer,tiny,true));
let maxJump=0,last=0;
for(let k=0;k<=100;k++){
 const e=k/100;
 const p=tiny.map((v,i)=>i===1?{x:100+e*1.2,y:e*1.2}:i===2?{x:100+e*2.4,y:e*3}:v);
 const radius=render(p,.85).maxR;
 if(k)maxJump=Math.max(maxJump,Math.abs(radius-last));
 last=radius;
}
assert(maxJump<3,`newborn mini-profile jumped ${maxJump}`);
// Stable, finite curves on a random stress set, including very close knots.
let seed=1234567;
const rnd=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
for(let j=0;j<180;j++){
 const n=5+Math.floor(rnd()*20),p=[];
 for(let i=0;i<n;i++){
  let r=25+rnd()*125;
  if(i&&rnd()<.2){p.push({...p[i-1],x:p[i-1].x+1e-6*rnd()});continue;}
  const a=i*2*Math.PI/n;
  p.push({x:r*Math.cos(a),y:r*Math.sin(a)});
 }
 for(const f of [.3,1,1.25,1.75,2]){
  const v=render(p,f,{N:7,drop:30});
  const rawR=Math.max(...p.map(q=>Math.hypot(q.x,q.y)));
  assert(v.maxR>=.7*rawR-.05,`unsafe radius j=${j} f=${f}: ${v.maxR} < ${rawR*.7}`);
 }
}
console.log('PASS 11.0.5: overlay, merged mini-profiles, base edge, 200% circle, radius guard and 900 randomized frames');
